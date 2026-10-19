// The bundled theatre plugins: every plugins/<folder>/ with a manifest.json and
// an index.ts. Adding a folder is all it takes — nothing else imports plugins
// directly. The list comes from `virtual:theatre-plugins`, generated at build
// time by theatrePlugins() in sdk/node.ts, which also checks every folder; the
// checks here are a backstop.
//
// Folders starting with "_" are dev-only: listed only while serving
// (npm run dev), so builds — including the phone's runner — never contain them.

import found from 'virtual:theatre-plugins';

import { checkManifest } from './manifest.ts';
import type { Main, Manifest } from './types.ts';

export type Plugin = { manifest: Manifest; main: Main };

/** Sorted by id. */
export const plugins: Plugin[] = found
  .map(({ folder, manifest, main }) => {
    if (typeof main !== 'function')
      throw new Error(`plugins/${folder}/index.ts must default-export main(ctx)`);
    return { manifest: checkManifest(manifest, folder), main: main as Main };
  })
  .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
