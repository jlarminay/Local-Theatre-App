import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';

import { parseDate, parseFilmList, parseFilmPage, parseTime } from '../sdk/cinemahosting.ts';
import type { Ctx } from '../sdk/types.ts';
import { validateResult } from '../sdk/validate.ts';
import main from './index.ts';

const fixture = (name: string) =>
  fs.readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const homeHtml = fixture('home.html');
const page = (slug: string) => fixture(`movie-${slug}.html`);
// The fixtures were saved on 2026-10-18.
const SAVED = new Date(2026, 9, 18);

describe('roxy: parsing', () => {
  test('the homepage lists every film, now showing and coming soon', () => {
    const films = parseFilmList(homeHtml);
    assert.equal(films.length, 7);
    assert.ok(films.some((f) => f.slug === 'Fatherland' && f.title === 'Fatherland'));
    assert.ok(films.some((f) => f.title === '(19+) Talent Show Social at The Roxy'));
    assert.ok(!films.some((f) => f.slug === 'releaseDate'));
  });

  test('dates get the year that makes them upcoming; times are 24-hour', () => {
    assert.equal(parseDate('Oct 19', SAVED), '2026-10-19');
    assert.equal(parseDate('Dec 28', SAVED), '2026-12-28');
    assert.equal(parseDate('Jan 9', SAVED), '2027-01-09');
    // Recently past stays this year (it's filtered out as past anyway); long past is next year.
    assert.equal(parseDate('Sept 3', SAVED), '2026-09-03');
    assert.equal(parseDate('Aug 3', SAVED), '2027-08-03');
    assert.equal(parseDate('nonsense', SAVED), null);
    assert.equal(parseTime('7:00p'), '19:00');
    assert.equal(parseTime('11:30a'), '11:30');
    assert.equal(parseTime('12:15p'), '12:15');
    assert.equal(parseTime('12:05a'), '00:05');
  });

  test('a film page: details, and several times on one day', () => {
    const film = parseFilmPage(page('Fatherland'), SAVED);
    assert.deepEqual(film.meta, ['Paweł Pawlikowski', '82 min']);
    assert.equal(film.director, 'Paweł Pawlikowski');
    assert.match(film.synopsis![0], /Thomas Mann/);
    assert.match(film.synopsis!.at(-1)!, /^Cast: Sandra Hüller/);
    assert.match(film.image!, /^https:\/\/img\.cnmhstng\.com\/images\//);
    const oct30 = film.showtimes.filter((s) => s.start.startsWith('2026-10-30'));
    assert.deepEqual(
      oct30.map((s) => s.start),
      ['2026-10-30T17:10:00', '2026-10-30T19:15:00'],
    );
    assert.ok(
      film.showtimes.every((s) => s.bookUrl?.startsWith('https://app.formovietickets.com/')),
    );
  });

  test('rating from the icons; a January date rolls into next year', () => {
    assert.deepEqual(
      parseFilmPage(page('Spirited_Away__Studio_Ghibli_Fest_Subtitled'), SAVED).meta,
      ['Hayao Miyazaki', '140 min', 'G'],
    );
    const relics = parseFilmPage(page('Relics_An_Early_Pink_Floyd_Experience'), SAVED);
    assert.deepEqual(
      relics.showtimes.map((s) => s.start),
      ['2027-01-09T19:00:00'],
    );
  });

  test('an event with no cast or director is just its description', () => {
    const event = parseFilmPage(page('19_Talent_Show_Social_at_The_Roxy'), SAVED);
    assert.deepEqual(event.meta, []);
    assert.ok(event.synopsis!.length > 0);
    assert.ok(!event.synopsis!.some((p) => p.startsWith('Cast:')));
  });
});

describe('roxy: main()', () => {
  test('reads the list and each film’s page; a missing page is logged, not fatal', async () => {
    const logs: unknown[][] = [];
    const saved = new Set([
      'Fatherland',
      'Spirited_Away__Studio_Ghibli_Fest_Subtitled',
      '19_Talent_Show_Social_at_The_Roxy',
      'Relics_An_Early_Pink_Floyd_Experience',
    ]);
    const ctx: Ctx = {
      http: {
        async text(url) {
          if (url === 'https://www.roxyvictoria.ca/') return homeHtml;
          const slug = url.split('/movie/')[1];
          if (saved.has(slug)) return page(slug);
          throw new Error('www.roxyvictoria.ca returned 404');
        },
        async json(url) {
          return JSON.parse(await this.text(url));
        },
      },
      store: { get: () => undefined, set: () => {} },
      mode: 'background',
      log: (...parts) => void logs.push(parts),
      progress: () => {},
      deadline: Date.now() + 60_000,
    };
    const { result, dropped } = validateResult(await main(ctx));
    assert.deepEqual(dropped, []);
    assert.equal(result.films.length, saved.size);
    assert.equal(logs.length, 7 - saved.size);
    assert.ok(result.showtimes.length >= 10);
  });
});
