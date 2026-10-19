// Runs a theatre plugin under Node against the live site and prints what it
// found — the quick loop for writing a scraper.
//
//   npm run plugin                     list plugins
//   npm run plugin <id>                run it (foreground)
//   npm run plugin <id> -- --background   run as the periodic check would
//   npm run plugin <id> -- --json         print the full result
//
// The store persists in plugins/.store/<id>.json, so a --background run sees
// what a previous run saved. Delete the file to start fresh.
//
// Node isn't QuickJS: something that works here can still fail on the phone.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { makeHttp } from './http.ts';
import { findPlugins, PLUGINS_DIR } from './node.ts';
import type { Ctx, Main } from './types.ts';
import { validateResult } from './validate.ts';

const args = process.argv.slice(2);
const id = args.find((arg) => !arg.startsWith('--'));
const background = args.includes('--background');
const asJson = args.includes('--json');

const plugins = findPlugins();
if (!id) {
  console.log('Plugins:');
  for (const { manifest } of plugins)
    console.log(`  ${manifest.id.padEnd(14)} ${manifest.name} (v${manifest.version})`);
  console.log('\nRun one with: npm run plugin <id>');
  process.exit(0);
}

const plugin = plugins.find(({ manifest }) => manifest.id === id);
if (!plugin) {
  console.error(
    `No plugin "${id}". Have: ${plugins.map(({ manifest }) => manifest.id).join(', ')}`,
  );
  process.exit(1);
}

const storeFile = path.join(PLUGINS_DIR, '.store', `${id}.json`);
let stored: Record<string, unknown> = {};
try {
  stored = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
} catch {
  // first run
}

let requests = 0;
const ctx: Ctx = {
  http: makeHttp(plugin.manifest, async (url) => {
    requests++;
    const response = await fetch(url, { headers: { 'user-agent': 'LocalTheatre-dev' } });
    return { status: response.status, text: await response.text() };
  }),
  store: {
    get: <T>(key: string) => stored[key] as T | undefined,
    set: (key, value) => {
      stored[key] = JSON.parse(JSON.stringify(value));
    },
  },
  mode: background ? 'background' : 'foreground',
  log: (...parts) => console.error(`[${id}]`, ...parts),
  progress: (step, done, total) =>
    console.error(`[${id}] … ${step}${total ? ` ${done ?? 0}/${total}` : ''}`),
  deadline: Date.now() + Math.min(plugin.manifest.timeoutSeconds ?? 60, 300) * 1000,
};

const started = Date.now();
const main = (await import(pathToFileURL(path.join(plugin.dir, 'index.ts')).href)).default as Main;
const { result, dropped } = validateResult(await main(ctx));
const ms = Date.now() - started;

fs.mkdirSync(path.dirname(storeFile), { recursive: true });
fs.writeFileSync(storeFile, JSON.stringify(stored, null, 2));

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const counts = new Map<string, number>();
  for (const s of result.showtimes) counts.set(s.filmKey, (counts.get(s.filmKey) ?? 0) + 1);
  console.log(
    `${plugin.manifest.name}: ${result.films.length} films, ${result.showtimes.length} showtimes ` +
      `(${ctx.mode}, ${requests} requests, ${ms} ms)\n`,
  );
  for (const film of result.films) {
    const extras = [film.image ? 'image' : '', film.synopsis?.length ? 'synopsis' : '']
      .filter(Boolean)
      .join(', ');
    console.log(
      `  ${String(counts.get(film.key) ?? 0).padStart(3)}×  ${film.title}  ` +
        `[${film.key}]${film.meta?.length ? `  ${film.meta.join(' · ')}` : ''}${extras ? `  (${extras})` : ''}`,
    );
  }
  const next = result.showtimes[0];
  if (next) console.log(`\n  Next: ${next.start}  ${next.filmKey}`);
}
if (dropped.length) {
  console.error(`\nDropped ${dropped.length} invalid entries:`);
  for (const line of dropped.slice(0, 20)) console.error(`  - ${line}`);
}
