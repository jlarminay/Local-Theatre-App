import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { textOf, textsOf } from './html.ts';
import { makeHttp } from './http.ts';
import { checkManifest } from './manifest.ts';
import { validateResult } from './validate.ts';

const manifest = {
  id: 'demo',
  name: 'Demo',
  shortName: 'DEM',
  color: '#123abc',
  version: '1.0.0',
  apiVersion: 1,
  homepage: 'https://www.example.com/',
  domains: ['www.example.com'],
};

describe('sdk: manifest', () => {
  test('accepts a valid manifest', () => {
    assert.equal(checkManifest(manifest, 'demo').id, 'demo');
  });

  test('a dev-only "_" folder holds the id without the underscore', () => {
    assert.equal(checkManifest(manifest, '_demo').id, 'demo');
    assert.throws(() => checkManifest({ ...manifest, id: '_demo' }, '_demo'), /"id" must be/);
  });

  test('lists every problem at once', () => {
    const error = (() => {
      try {
        checkManifest(
          { ...manifest, id: 'other', color: 'red', apiVersion: 2, domains: [] },
          'demo',
        );
      } catch (err) {
        return (err as Error).message;
      }
    })();
    assert.match(error!, /folder is "demo"/);
    assert.match(error!, /"color"/);
    assert.match(error!, /"apiVersion"/);
    assert.match(error!, /"domains"/);
  });
});

describe('sdk: http', () => {
  test('refuses hosts not in domains, and non-2xx responses', async () => {
    const http = makeHttp(checkManifest(manifest, 'demo'), async (url) => ({
      status: url.endsWith('/missing') ? 404 : 200,
      text: '{"ok":true}',
    }));
    assert.deepEqual(await http.json('https://www.example.com/a'), { ok: true });
    await assert.rejects(http.text('https://evil.example.org/'), /isn't in the manifest/);
    await assert.rejects(http.text('https://www.example.com/missing'), /returned 404/);
  });
});

describe('sdk: html', () => {
  test('textOf behaves like textContent', () => {
    assert.equal(textOf('<span>A&nbsp;&#8211; <b>b</b>\n c&rsquo;s</span>'), 'A – b c’s');
  });

  test('textsOf skips empty elements', () => {
    assert.deepEqual(textsOf('<p>one</p><p class="x">&nbsp;</p><P>two</P>', 'p'), ['one', 'two']);
  });
});

describe('sdk: validateResult', () => {
  const film = { key: '1', title: 'A Film' };
  const showtime = { filmKey: '1', start: '2026-10-23T19:30:00' };

  test('drops bad entries, keeps the rest, sorts showtimes', () => {
    const { result, dropped } = validateResult({
      films: [film, { key: '2' }, film],
      showtimes: [
        { ...showtime, start: '2026-10-24T19:30:00' },
        showtime,
        { filmKey: '9', start: '2026-10-23T19:30:00' },
        { filmKey: '1', start: '2026-10-23 19:30' },
      ],
    });
    assert.equal(result.films.length, 1);
    assert.deepEqual(
      result.showtimes.map((s) => s.start),
      ['2026-10-23T19:30:00', '2026-10-24T19:30:00'],
    );
    assert.equal(dropped.length, 4);
  });

  test('an empty lineup is fine; all-invalid is an error', () => {
    assert.deepEqual(validateResult({ films: [], showtimes: [] }).dropped, []);
    assert.throws(() => validateResult({ films: [{ key: 1 }], showtimes: [] }), /Every entry/);
    assert.throws(() => validateResult(null), /must return/);
  });
});
