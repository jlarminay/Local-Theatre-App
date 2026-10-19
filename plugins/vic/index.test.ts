import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';

import type { Ctx } from '../sdk/types.ts';
import { validateResult } from '../sdk/validate.ts';
import main, { parseCalendar, parseProduct } from './index.ts';

const fixture = (name: string) =>
  fs.readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const calendarHtml = fixture('calendar.html');
const productsJson = fixture('products.json');

function fakeCtx(mode: Ctx['mode'], stored: Record<string, unknown> = {}, failDetails = false) {
  const requested: string[] = [];
  const logs: unknown[][] = [];
  const ctx: Ctx = {
    http: {
      async text(url) {
        requested.push(url);
        if (url.includes('monthly-calendar')) return calendarHtml;
        if (url.includes('/wc/store/') && !failDetails) return productsJson;
        throw new Error(`503 for ${url}`);
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
    key: () => undefined,
  };
  return { ctx, requested, logs, stored };
}

describe('vic: calendar', () => {
  test('finds every showing, with local start times and numeric film keys', () => {
    const events = parseCalendar(calendarHtml);
    assert.ok(events.length > 10);
    for (const event of events) {
      assert.match(event.filmKey, /^\d+$/);
      assert.match(event.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
      assert.ok(event.title && !event.title.includes('&#'));
    }
  });

  test('fails clearly when the page layout changes', () => {
    assert.throws(() => parseCalendar('<html></html>'), /Calendar data not found/);
  });
});

describe('vic: film details', () => {
  const products = JSON.parse(productsJson);

  test('splits meta, drops boilerplate paragraphs and decodes entities', () => {
    const details = parseProduct(products.find((p: { id: number }) => p.id === 385113));
    assert.equal(details.title, 'Winter of the Crow');
    assert.deepEqual(details.meta, ['PG', 'Drama', '2025', '112 min']);
    assert.equal(details.synopsis?.length, 1);
    assert.match(details.synopsis![0], /student’s murder/);
    assert.deepEqual(details.flags, []);
    assert.equal(details.imageAspect, 1);
    assert.ok(details.image?.startsWith('https://'));
  });

  test('uses the description heading when the product name is cut short', () => {
    const details = parseProduct({
      id: 1,
      name: 'Toronto Godspell…',
      permalink: 'https://x/',
      description: '<h1>Toronto Godspell: The Musical</h1><p>A synopsis.</p>',
      images: [],
    });
    assert.equal(details.title, 'Toronto Godspell: The Musical');
    assert.equal(details.image, undefined);
  });

  test('flags membership-only screenings', () => {
    const details = parseProduct({
      id: 1,
      name: 'Members Night',
      permalink: 'https://x/',
      description: '<p>A film.</p><p>A membership will need to be purchased.</p>',
      images: [],
    });
    assert.deepEqual(details.flags, ['Membership required']);
    assert.deepEqual(details.synopsis, ['A film.']);
  });
});

describe('vic: main()', () => {
  test('foreground: calendar + details, valid result, details stored', async () => {
    const { ctx, requested, stored } = fakeCtx('foreground');
    const { result, dropped } = validateResult(await main(ctx));
    assert.deepEqual(dropped, []);
    assert.equal(requested.length, 2);
    assert.equal(result.showtimes.length, parseCalendar(calendarHtml).length);
    const withDetails = result.films.filter((film) => film.synopsis?.length);
    assert.ok(withDetails.length >= 10);
    assert.equal(Object.keys(stored.details as object).length, withDetails.length);
  });

  test('background: no details request, cached details still returned', async () => {
    const first = fakeCtx('foreground');
    await main(first.ctx);
    const { ctx, requested } = fakeCtx('background', first.stored);
    const { result } = validateResult(await main(ctx));
    assert.equal(requested.length, 1);
    assert.ok(result.films.filter((film) => film.synopsis?.length).length >= 10);
  });

  test('details request failing falls back to the cache instead of failing', async () => {
    const first = fakeCtx('foreground');
    await main(first.ctx);
    const { ctx, logs } = fakeCtx('foreground', first.stored, true);
    const { result } = validateResult(await main(ctx));
    assert.equal(logs.length, 1);
    assert.ok(result.films.filter((film) => film.synopsis?.length).length >= 10);
  });
});
