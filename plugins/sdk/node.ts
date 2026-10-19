// Node-only helpers: the build-time check (vite configs), the plugin runner
// (run.ts) and the scaffold (new.ts). Never bundled into the app or runner.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkManifest } from './manifest.ts';
import type { Manifest } from './types.ts';

export const PLUGINS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every folder in plugins/ except sdk (dev-only "_" folders included), checked. Throws one error listing every problem. */
export function findPlugins(): { folder: string; dir: string; manifest: Manifest }[] {
  const found: { folder: string; dir: string; manifest: Manifest }[] = [];
  const problems: string[] = [];
  const folders = fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'sdk' && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();

  for (const folder of folders) {
    const dir = path.join(PLUGINS_DIR, folder);
    const missing = ['manifest.json', 'index.ts'].filter(
      (file) => !fs.existsSync(path.join(dir, file)),
    );
    if (missing.length) {
      problems.push(`plugins/${folder}/ is missing ${missing.join(' and ')}`);
      continue;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      found.push({ folder, dir, manifest: checkManifest(raw, folder) });
    } catch (err) {
      problems.push(
        err instanceof SyntaxError
          ? `plugins/${folder}/manifest.json: ${err.message}`
          : String((err as Error).message),
      );
    }
  }

  const ids = found.map(({ manifest }) => manifest.id);
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i)))
    problems.push(`Two folders use the id "${id}" (plugins/${id}/ and plugins/_${id}/)`);

  if (problems.length) throw new Error(`Theatre plugins have problems:\n${problems.join('\n')}`);
  return found;
}

/**
 * Vite plugin, dev server only: GET /proxy?url=… fetches a page for the
 * in-browser host (src/lib/watch.ts), since theatre sites send no CORS
 * headers. Only hosts some plugin's manifest lists in "domains".
 */
export function devProxy() {
  return {
    name: 'theatre-dev-proxy',
    apply: 'serve' as const,
    configureServer(server: {
      middlewares: {
        use(
          path: string,
          handler: (req: { url?: string }, res: import('node:http').ServerResponse) => void,
        ): void;
      };
    }) {
      server.middlewares.use('/proxy', async (req, res) => {
        const params = new URL(req.url ?? '', 'http://localhost').searchParams;
        const url = params.get('url') ?? '';
        let headers: Record<string, string> = {};
        try {
          headers = JSON.parse(params.get('headers') ?? '{}');
        } catch {
          // no extra headers
        }
        const allowed = new Set(findPlugins().flatMap(({ manifest }) => manifest.domains));
        let host = '';
        try {
          host = new URL(url).host;
        } catch {
          // invalid URL: refused below
        }
        if (!allowed.has(host)) {
          res.statusCode = 403;
          res.end(`Not in any plugin's "domains": ${url}`);
          return;
        }
        try {
          const response = await fetch(url, {
            headers: { 'user-agent': 'LocalTheatre-dev', ...headers },
          });
          res.statusCode = response.status;
          res.setHeader('content-type', response.headers.get('content-type') ?? 'text/plain');
          res.end(await response.text());
        } catch (err) {
          res.statusCode = 502;
          res.end(String(err));
        }
      });
    },
  };
}

export const PLUGINS_MODULE = 'virtual:theatre-plugins';

/**
 * Vite plugin: provides `virtual:theatre-plugins` (read by sdk/discover.ts),
 * a generated module importing every plugin folder's manifest.json and
 * index.ts. Dev-only "_" folders are included only while serving, so they're
 * never in a build — import.meta.glob can't do that, as its matches stay
 * bundled even in an unused branch. A broken folder fails the build (or dev
 * server start); adding or removing one while serving reloads the page.
 */
export function theatrePlugins() {
  const resolved = `\0${PLUGINS_MODULE}`;
  let serving = false;
  return {
    name: 'theatre-plugins',
    configResolved(config: { command: string }) {
      serving = config.command === 'serve';
    },
    buildStart(this: { error(message: string): never }) {
      try {
        findPlugins();
      } catch (err) {
        this.error((err as Error).message);
      }
    },
    resolveId: (source: string) => (source === PLUGINS_MODULE ? resolved : undefined),
    load(id: string) {
      if (id !== resolved) return undefined;
      const found = findPlugins().filter(({ folder }) => serving || !folder.startsWith('_'));
      const imports = found.flatMap(({ dir }, i) => [
        `import manifest${i} from ${JSON.stringify(path.join(dir, 'manifest.json'))};`,
        `import main${i} from ${JSON.stringify(path.join(dir, 'index.ts'))};`,
      ]);
      const list = found.map(
        ({ folder }, i) =>
          `{ folder: ${JSON.stringify(folder)}, manifest: manifest${i}, main: main${i} }`,
      );
      return `${imports.join('\n')}\nexport default [${list.join(', ')}];\n`;
    },
    configureServer(server: {
      watcher: { on(event: string, listener: (file: string) => void): void };
      moduleGraph: { getModuleById(id: string): unknown; invalidateModule(mod: never): void };
      ws: { send(payload: { type: 'full-reload' }): void };
    }) {
      const onChange = (file: string) => {
        const rel = path.relative(PLUGINS_DIR, file).split(path.sep);
        if (rel.length !== 2 || !['manifest.json', 'index.ts'].includes(rel[1])) return;
        const mod = server.moduleGraph.getModuleById(resolved);
        if (mod) server.moduleGraph.invalidateModule(mod as never);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
}
