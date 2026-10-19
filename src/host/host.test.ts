import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { Main, Manifest, ScrapeResult } from '../../plugins/sdk/types.ts';
import { checkDue } from './checks.ts';
import { createHost, recordSeen, type Kv, type Plugin } from './host.ts';

function manifest(id: string, extra: Partial<Manifest> = {}): Manifest {
  return {
    id,
    name: id.toUpperCase(),
    shortName: id.slice(0, 3).toUpperCase(),
    color: '#123456',
    version: '1.0.0',
    apiVersion: 1,
    homepage: `https://${id}.example/`,
    domains: [`${id}.example`],
    ...extra,
  };
}

const lineup = (...titles: string[]): ScrapeResult => ({
  films: titles.map((title, i) => ({ key: String(i + 1), title })),
  showtimes: titles.map((_, i) => ({
    filmKey: String(i + 1),
    start: `2026-11-0${i + 1}T19:00:00`,
  })),
});

function memoryKv(): Kv & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
}

const get = async () => ({ status: 200, text: '' });
const plugin = (id: string, main: Main, extra?: Partial<Manifest>): Plugin => ({
  manifest: manifest(id, extra),
  main,
});

describe('host', () => {
  test('runs enabled plugins in order and prefixes keys', async () => {
    const order: string[] = [];
    const kv = memoryKv();
    const host = createHost({
      kv,
      get,
      plugins: [
        plugin('aaa', async () => (order.push('aaa'), lineup('One'))),
        plugin('bbb', async () => (order.push('bbb'), lineup('Two'))),
      ],
    });
    host.setEnabled(['bbb', 'aaa']);
    const { state } = await host.refresh('foreground');
    assert.deepEqual(order, ['bbb', 'aaa']);
    assert.deepEqual(
      state.theatres.map((t) => t.manifest.id),
      ['bbb', 'aaa'],
    );
    assert.equal(state.theatres[0].films[0].key, 'bbb:1');
    assert.equal(state.theatres[0].films[0].theatre, 'bbb');
    assert.equal(state.theatres[0].showtimes[0].filmKey, 'bbb:1');
  });

  test('a failing plugin keeps its last good result and does not stop the others', async () => {
    let fail = false;
    const kv = memoryKv();
    const plugins = [
      plugin('aaa', async () => {
        if (fail) throw new Error('site down');
        return lineup('One');
      }),
      plugin('bbb', async () => lineup('Two')),
    ];
    await createHost({ kv, get, plugins }).refresh('foreground');
    fail = true;
    const { state, runs } = await createHost({ kv, get, plugins }).refresh('foreground');
    assert.equal(runs.aaa.ok, false);
    assert.equal(runs.aaa.error, 'site down');
    assert.equal(runs.bbb.ok, true);
    const aaa = state.theatres.find((t) => t.manifest.id === 'aaa')!;
    assert.equal(aaa.films.length, 1);
    assert.equal(aaa.lastRun?.ok, false);
  });

  test('reports progress: waiting, running with steps, done/failed', async () => {
    const seen: string[] = [];
    const host = createHost({
      kv: memoryKv(),
      get,
      plugins: [
        plugin('aaa', async (ctx) => {
          ctx.progress('Fetching', 1, 2);
          return lineup('One');
        }),
        plugin('bbb', async () => {
          throw new Error('down');
        }),
      ],
    });
    await host.refresh('foreground', (p) =>
      seen.push(
        p.theatres
          .map((t) => `${t.id}:${t.state}${t.step ? `(${t.step} ${t.done}/${t.total})` : ''}`)
          .join(' ') + (p.finishedAt ? ' ✓' : ''),
      ),
    );
    assert.deepEqual(seen, [
      'aaa:waiting bbb:waiting',
      'aaa:running bbb:waiting',
      'aaa:running(Fetching 1/2) bbb:waiting',
      'aaa:done bbb:waiting',
      'aaa:done bbb:running',
      'aaa:done bbb:failed',
      'aaa:done bbb:failed ✓',
    ]);
  });

  test('keeps each theatre’s steps, a per-plugin timeout, and a deadline in ctx', async () => {
    let last: import('./host.ts').RefreshProgress | undefined;
    let deadline = 0;
    const host = createHost({
      kv: memoryKv(),
      get,
      plugins: [
        plugin(
          'aaa',
          async (ctx) => {
            deadline = ctx.deadline;
            ctx.progress('Reading', 0, 2);
            ctx.progress('Reading', 1, 2); // same step: no new line
            ctx.log('page 2 failed');
            ctx.progress('Read film B', 2, 2);
            return lineup('One');
          },
          { timeoutSeconds: 120 },
        ),
      ],
    });
    const before = Date.now();
    await host.refresh('foreground', (p) => (last = p));
    assert.deepEqual(
      last!.theatres[0].steps.map((s) => s.text),
      ['Reading', 'page 2 failed', 'Read film B', 'Done · 1 films'],
    );
    assert.ok(deadline >= before + 119_000 && deadline <= Date.now() + 120_000);
  });

  test('plugin keys: only declared ones are readable; hints never show the key', async () => {
    const seen: (string | undefined)[] = [];
    const host = createHost({
      kv: memoryKv(),
      get,
      plugins: [
        plugin(
          'aaa',
          async (ctx) => {
            seen.push(ctx.key('cineplex'), ctx.key('other'));
            return lineup('One');
          },
          { keys: [{ name: 'cineplex', label: 'Cineplex key' }] },
        ),
      ],
    });
    assert.deepEqual(host.keyHints(), {});
    host.setKey('cineplex', '  abcdef123  ');
    host.setKey('other', 'secret');
    assert.deepEqual(host.keyHints(), { cineplex: '…123' });
    await host.refresh('foreground');
    assert.deepEqual(seen, ['abcdef123', undefined]);
    host.setKey('cineplex', null);
    assert.deepEqual(host.keyHints(), {});
  });

  test('a plugin that hangs times out', async () => {
    const host = createHost({
      kv: memoryKv(),
      get,
      timeoutMs: 20,
      plugins: [plugin('slow', () => new Promise(() => {}))],
    });
    const { runs } = await host.refresh('foreground');
    assert.match(runs.slow.error!, /took over/);
  });

  test('enabledByDefault, disabling, and forgetting deleted plugins', async () => {
    const kv = memoryKv();
    const on = plugin('on', async () => lineup('A'));
    const off = plugin('off', async () => lineup('B'), { enabledByDefault: false });
    const host = createHost({ kv, get, plugins: [on, off] });
    assert.deepEqual(host.enabledIds(), ['on']);
    await host.refresh('foreground');
    assert.ok(kv.data.has('result:on'));
    assert.ok(!kv.data.has('result:off'));

    host.setEnabled([]);
    assert.deepEqual((await host.refresh('foreground')).runs, {});

    // "on" folder deleted, a new one added.
    const later = createHost({ kv, get, plugins: [off, plugin('new', async () => lineup('C'))] });
    assert.ok(!kv.data.has('result:on'));
    assert.deepEqual(later.enabledIds(), ['new']);
  });

  test('plugin storage persists between runs; clear() forgets it', async () => {
    const kv = memoryKv();
    const plugins = [
      plugin('aaa', async (ctx) => {
        ctx.store.set('runs', (ctx.store.get<number>('runs') ?? 0) + 1);
        return lineup(`Run ${ctx.store.get('runs')}`);
      }),
    ];
    await createHost({ kv, get, plugins }).refresh('foreground');
    const second = await createHost({ kv, get, plugins }).refresh('background');
    assert.equal(second.state.theatres[0].films[0].title, 'Run 2');
    const host = createHost({ kv, get, plugins });
    host.clear();
    assert.equal(host.state().theatres[0].films.length, 0);
    assert.equal((await host.refresh('foreground')).state.theatres[0].films[0].title, 'Run 1');
  });

  test('new films are reported once; a theatre’s first run is a silent baseline', async () => {
    const kv = memoryKv();
    let titles = ['One'];
    const plugins = [plugin('aaa', async () => lineup(...titles))];
    assert.deepEqual((await createHost({ kv, get, plugins }).refresh('background')).added, []);
    titles = ['One', 'Two'];
    const second = await createHost({ kv, get, plugins }).refresh('background');
    assert.deepEqual(
      second.added.map((f) => f.title),
      ['Two'],
    );
    assert.deepEqual((await createHost({ kv, get, plugins }).refresh('background')).added, []);
  });
});

describe('recordSeen', () => {
  test('baselines each theatre separately', () => {
    const seen = { 'aaa:1': 0 };
    const added = recordSeen(
      seen,
      [
        { key: 'aaa:2', theatre: 'aaa' },
        { key: 'bbb:1', theatre: 'bbb' },
      ],
      1000,
    );
    assert.deepEqual(
      added.map((f) => f.key),
      ['aaa:2'],
    );
    assert.deepEqual(seen, { 'aaa:1': 0, 'aaa:2': 1000, 'bbb:1': 0 });
  });
});

describe('checkDue', () => {
  const hour = 3_600_000;
  test('never, first ever, and the chosen rate (with a little slack)', () => {
    assert.equal(checkDue(0, null), false);
    assert.equal(checkDue(3, null), true);
    assert.equal(checkDue(3, 0, 2 * hour), false);
    assert.equal(checkDue(3, 0, 3 * hour - 5 * 60_000), true);
    assert.equal(checkDue(1, 0, hour), true);
    assert.equal(checkDue(24, 0, 23 * hour), false);
  });
});
