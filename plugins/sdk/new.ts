// Scaffolds a new theatre plugin: npm run plugin:new <id> [-- --name "Full Name"]
// Making plugins/<id>/manifest.json and index.ts by hand works just as well.

import fs from 'node:fs';
import path from 'node:path';

import { checkManifest } from './manifest.ts';
import { PLUGINS_DIR } from './node.ts';
import { API_VERSION } from './types.ts';

const args = process.argv.slice(2);
const id = args.find((arg) => !arg.startsWith('--'));
const nameAt = args.indexOf('--name');
if (!id || id === 'sdk') {
  console.error('Usage: npm run plugin:new <id> [-- --name "Full Name"]');
  process.exit(1);
}

const dir = path.join(PLUGINS_DIR, id);
if (fs.existsSync(dir)) {
  console.error(`plugins/${id}/ already exists.`);
  process.exit(1);
}

const name = nameAt >= 0 && args[nameAt + 1] ? args[nameAt + 1] : id[0].toUpperCase() + id.slice(1);
const manifest = {
  $schema: '../sdk/manifest.schema.json',
  id,
  name,
  shortName: id.slice(0, 3).toUpperCase(),
  color: '#888888',
  version: '0.1.0',
  author: 'Your name',
  updated: new Date().toISOString().slice(0, 10),
  apiVersion: API_VERSION,
  homepage: 'https://www.example.com/',
  domains: ['www.example.com'],
  enabledByDefault: false,
};
checkManifest(manifest, id);

const index = `// ${name}. Runs in the background runner (QuickJS): no DOM — use ctx.http
// and the helpers in ../sdk/html.ts. Try it with: npm run plugin ${id}

import type { Main } from '../sdk/types.ts';

const main: Main = async (ctx) => {
  // const html = await ctx.http.text('https://www.example.com/showtimes');
  return { films: [], showtimes: [] };
};

export default main;
`;

fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(dir, 'index.ts'), index);
console.log(`Created plugins/${id}/manifest.json and index.ts.
Next: set "homepage" and "domains" in the manifest, write main(), then npm run plugin ${id}`);
