import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';

import { parseShowtimes, type ApiShowtimes } from '../sdk/cineplex.ts';
import type { Ctx } from '../sdk/types.ts';
import { validateResult } from '../sdk/validate.ts';
import main from './index.ts';

const data = JSON.parse(
  fs.readFileSync(new URL('fixtures/showtimes.json', import.meta.url), 'utf8'),
) as ApiShowtimes;

function fakeCtx(key: string | undefined) {
  const sent: { url: string; headers?: Record<string, string> }[] = [];
  const ctx: Ctx = {
    http: {
      async text(url, options) {
        sent.push({ url, headers: options?.headers });
        return JSON.stringify(data);
      },
      async json(url, options) {
        return JSON.parse(await this.text(url, options));
      },
    },
    store: { get: () => undefined, set: () => {} },
    mode: 'foreground',
    log: () => {},
    progress: () => {},
    deadline: Date.now() + 60_000,
    key: (name) => (name === 'cineplex' ? key : undefined),
  };
  return { ctx, sent };
}

describe('cineplex (SilverCity Victoria)', () => {
  test('films and showtimes, with seats, sold out, formats and ticket links', () => {
    const { films, showtimes } = parseShowtimes(data);
    assert.ok(films.length > 5);
    const fighter = films.find((f) => f.title === 'Street Fighter')!;
    assert.deepEqual(fighter.meta?.slice(-1), ['119 min']);
    assert.match(fighter.image!, /_768_1024\.jpg$/);
    assert.equal(fighter.imageAspect, 0.75);
    const imax = showtimes.find((s) => s.note === 'IMAX')!;
    assert.match(imax.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/);
    assert.equal(typeof imax.seatsLeft, 'number');
    assert.match(imax.bookUrl!, /^https:\/\/apis\.cineplex\.com\/prod\/ticketing\//);
    // Plain showings carry no format note.
    assert.ok(showtimes.some((s) => s.note === undefined));
  });

  test('sends the key from Settings, and returns a valid result', async () => {
    const { ctx, sent } = fakeCtx('test-key-123');
    const { result, dropped } = validateResult(await main(ctx));
    assert.deepEqual(dropped, []);
    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /locationId=1417/);
    assert.equal(sent[0].headers?.['Ocp-Apim-Subscription-Key'], 'test-key-123');
    assert.ok(result.showtimes.length > 20);
  });

  test('without a key: a clear error, and no request', async () => {
    const { ctx, sent } = fakeCtx(undefined);
    await assert.rejects(main(ctx), /Needs a Cineplex key/);
    assert.equal(sent.length, 0);
  });
});
