import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import type { Ctx } from '../sdk/types.ts';
import { validateResult } from '../sdk/validate.ts';
import main from './index.ts';

const fixture = (name: string) =>
  fs.readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8');

test('capitol6: the shared CinemaHosting reader works on its site', async () => {
  const saved = new Set(['Sense_and_Sensibility', 'Avengers_Doomsday']);
  const requested: string[] = [];
  const ctx: Ctx = {
    http: {
      async text(url) {
        requested.push(url);
        if (url === 'https://www.capitol6.ca/') return fixture('home.html');
        const slug = url.split('/movie/')[1];
        if (saved.has(slug)) return fixture(`movie-${slug}.html`);
        throw new Error('www.capitol6.ca returned 404');
      },
      async json(url) {
        return JSON.parse(await this.text(url));
      },
    },
    store: { get: () => undefined, set: () => {} },
    mode: 'foreground',
    log: () => {},
    progress: () => {},
    deadline: Date.now() + 60_000,
    key: () => undefined,
  };
  const { result, dropped } = validateResult(await main(ctx));
  assert.deepEqual(dropped, []);
  // Every film on the homepage is tried; the two saved pages come back with showtimes.
  assert.equal(requested.length, 1 + 15);
  assert.deepEqual(result.films.map((f) => f.key).sort(), [
    'Avengers_Doomsday',
    'Sense_and_Sensibility',
  ]);
  const sense = result.showtimes.filter((s) => s.filmKey === 'Sense_and_Sensibility');
  assert.ok(sense.length >= 3);
  assert.ok(sense.every((s) => s.bookUrl?.startsWith('https://app.formovietickets.com/')));
});
