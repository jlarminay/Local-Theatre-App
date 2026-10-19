import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';

import type { Ctx } from '../sdk/types.ts';
import { validateResult } from '../sdk/validate.ts';
import main, { filmKey, parseEventPage } from './index.ts';

const fixture = (name: string) =>
  fs.readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const eventsJson = fixture('events.json');
const winterHtml = fixture('event-winter-of-the-crow.html');
const rockyHtml = fixture('event-rocky-horror.html');

/** Serves the fixtures; event pages without one fail like a 404. */
function fakeCtx(
  mode: Ctx['mode'],
  stored: Record<string, unknown> = {},
  api: (url: string) => string = () => eventsJson,
) {
  const requested: string[] = [];
  const logs: unknown[][] = [];
  const ctx: Ctx = {
    http: {
      async text(url) {
        requested.push(url);
        if (url.includes('/wp-json/tribe/events/')) return api(url);
        if (url.includes('/calendar/winter-of-the-crow/')) return winterHtml;
        if (url.includes('/calendar/the-rocky-horror-picture-show')) return rockyHtml;
        throw new Error(`www.cinecenta.com returned 404`);
      },
      async json(url) {
        return JSON.parse(await this.text(url));
      },
    },
    store: {
      get: (key) => stored[key] as never,
      set: (key, value) => void (stored[key] = value),
    },
    mode,
    log: (...parts) => void logs.push(parts),
    progress: () => {},
    deadline: Date.now() + 60_000,
  };
  return { ctx, requested, logs, stored };
}

describe('cinecenta: event pages', () => {
  test('meta from the labelled fields; synopsis without review quotes; door sales', () => {
    const details = parseEventPage(winterHtml);
    assert.deepEqual(details.meta, [
      'Sean Cisterna',
      'Poland UK',
      '2026',
      '115 min',
      'PG',
      'English & Polish',
    ]);
    assert.match(details.synopsis![0], /Cold War thriller/);
    assert.match(details.synopsis![0], /found\. -Film Threat$/);
    assert.ok(!details.synopsis!.some((p) => p.includes('Variety')));
    assert.equal(details.synopsis!.at(-1), 'Cast: Lesley Mannville');
    assert.equal(details.atTheDoor, true);
    assert.equal(details.bookUrl, undefined);
  });

  test('an online ticket link when the event sells them', () => {
    const details = parseEventPage(rockyHtml);
    assert.match(details.bookUrl!, /^https:\/\/www\.eventbrite\.ca\//);
    assert.equal(details.atTheDoor, false);
  });

  test('a page without the expected sections gives empty details, not an error', () => {
    assert.deepEqual(parseEventPage('<html></html>'), {
      meta: [],
      synopsis: [],
      bookUrl: undefined,
      atTheDoor: false,
    });
  });
});

describe('cinecenta: main()', () => {
  test('groups showings into films by title, with images and ticket info', async () => {
    const { ctx, logs } = fakeCtx('foreground');
    const { result, dropped } = validateResult(await main(ctx));
    assert.deepEqual(dropped, []);
    assert.equal(result.showtimes.length, JSON.parse(eventsJson).events.length);
    const keys = result.films.map((film) => film.key);
    assert.equal(new Set(keys).size, keys.length);

    const winter = result.films.find((film) => film.key === 'winter-of-the-crow')!;
    assert.equal(winter.title, 'Winter of the Crow');
    assert.ok(winter.image && Math.abs(winter.imageAspect! - 16 / 9) < 0.01);
    // Only the same-shaped sizes, smallest first; no square or banner crops.
    assert.deepEqual(
      winter.imageSrcset!.split(', ').map((entry) => entry.split(' ')[1]),
      ['300w', '705w', '768w', '1030w', '1200w'],
    );
    const winterShows = result.showtimes.filter((s) => s.filmKey === 'winter-of-the-crow');
    assert.ok(winterShows.every((s) => s.note === 'Tickets at the door' && !s.bookUrl));

    const rocky = result.showtimes.filter((s) => s.filmKey === 'the-rocky-horror-picture-show');
    assert.ok(rocky.length && rocky.every((s) => s.bookUrl?.includes('eventbrite')));

    // Films whose page failed are marked for later; fetched ones aren't.
    assert.equal(result.films.find((f) => f.key === 'the-thing')?.detailsPending, true);
    assert.equal(winter.detailsPending, undefined);

    // Titles are decoded, and films whose page failed still appear.
    assert.ok(result.films.some((film) => film.title === 'The Room – Presented by Greg Sestero'));
    assert.equal(logs.length, result.films.length - 2);
  });

  test('background: details from the store; only films without details are fetched', async () => {
    const first = fakeCtx('foreground');
    await main(first.ctx);
    const { ctx, requested } = fakeCtx('background', first.stored);
    const { result } = validateResult(await main(ctx));
    assert.ok(result.films.find((film) => film.key === 'winter-of-the-crow')!.synopsis?.length);
    // The two films with fixtures are cached, so only the others' pages are tried again.
    const pages = requested.filter((url) => url.includes('/calendar/'));
    assert.equal(pages.length, result.films.length - 2);
    assert.ok(!pages.some((url) => url.includes('winter-of-the-crow')));
  });

  test('background: no page requests once every film has details', async () => {
    const first = fakeCtx('foreground');
    await main(first.ctx);
    const cache = first.stored.details as Record<string, unknown>;
    // Pretend every film's page was read.
    const films = (await main(fakeCtx('background', {}).ctx)).films;
    for (const film of films) cache[film.key] ??= { at: Date.now(), details: { atTheDoor: true } };
    const { ctx, requested } = fakeCtx('background', first.stored);
    await main(ctx);
    assert.equal(requested.length, 1);
  });

  test('details older than a few days are fetched again', async () => {
    const first = fakeCtx('foreground');
    await main(first.ctx);
    const cache = first.stored.details as Record<string, { at: number }>;
    cache['winter-of-the-crow'].at = Date.now() - 4 * 86_400_000;
    const { ctx, requested } = fakeCtx('foreground', first.stored);
    await main(ctx);
    assert.ok(requested.some((url) => url.includes('/calendar/winter-of-the-crow/')));
    assert.ok(!requested.some((url) => url.includes('/calendar/the-rocky-horror-picture-show')));
  });

  test('follows the API’s next page', async () => {
    const events = JSON.parse(eventsJson).events;
    const half = Math.ceil(events.length / 2);
    const next = 'https://www.cinecenta.com/wp-json/tribe/events/v1/events?page=2';
    const { ctx } = fakeCtx('background', {}, (url) =>
      JSON.stringify(
        url === next
          ? { events: events.slice(half) }
          : { events: events.slice(0, half), next_rest_url: next },
      ),
    );
    assert.equal((await main(ctx)).showtimes.length, events.length);
  });

  test('film keys are stable slugs', () => {
    assert.equal(
      filmKey('The Room – Presented by Greg Sestero'),
      'the-room-presented-by-greg-sestero',
    );
    assert.equal(filmKey('Don’t Forget the Oatmeal'), 'dont-forget-the-oatmeal');
    assert.equal(filmKey('Q&A'), 'q-and-a');
  });
});
