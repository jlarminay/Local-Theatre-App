import { API_VERSION, type Manifest } from './types.ts';

const ID = /^[a-z0-9][a-z0-9-]*$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const HOST = /^[a-z0-9.-]+$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks a parsed manifest.json from `plugins/<folder>/`, throwing one error that lists every
 * problem. A folder starting with "_" is dev-only (see discover.ts); its id omits the "_".
 */
export function checkManifest(raw: unknown, folder: string): Manifest {
  const problems: string[] = [];
  const m = (raw ?? {}) as Record<string, unknown>;
  const str = (key: string) => {
    if (typeof m[key] !== 'string' || !(m[key] as string).trim())
      problems.push(`"${key}" must be a non-empty string`);
  };

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    problems.push('must be a JSON object');
  } else {
    ['id', 'name', 'shortName', 'color', 'version', 'homepage'].forEach(str);
    if (typeof m.id === 'string') {
      if (!ID.test(m.id)) problems.push(`"id" must be lowercase letters, digits and dashes`);
      else if (m.id !== folder.replace(/^_/, ''))
        problems.push(`"id" is "${m.id}" but the folder is "${folder}"`);
    }
    if (typeof m.color === 'string' && !COLOR.test(m.color))
      problems.push(`"color" must look like "#e4572e"`);
    if (typeof m.homepage === 'string' && !/^https?:\/\//.test(m.homepage))
      problems.push(`"homepage" must be an http(s) URL`);
    if (m.apiVersion !== API_VERSION)
      problems.push(`"apiVersion" must be ${API_VERSION} (got ${JSON.stringify(m.apiVersion)})`);
    if (
      !Array.isArray(m.domains) ||
      !m.domains.length ||
      !m.domains.every((d) => typeof d === 'string' && HOST.test(d))
    )
      problems.push(`"domains" must be a non-empty list of host names, e.g. ["www.example.com"]`);
    for (const key of ['owner', 'author'])
      if (m[key] !== undefined && (typeof m[key] !== 'string' || !(m[key] as string).trim()))
        problems.push(`"${key}" must be a non-empty string`);
    if (m.updated !== undefined && (typeof m.updated !== 'string' || !DATE.test(m.updated)))
      problems.push(`"updated" must be a date like "2026-10-18"`);
    if (
      m.posterSource !== undefined &&
      m.posterSource !== 'theatre' &&
      m.posterSource !== 'database'
    )
      problems.push(`"posterSource" must be "theatre" or "database"`);
    if (
      m.titleExtras !== undefined &&
      (!Array.isArray(m.titleExtras) ||
        !m.titleExtras.every((extra) => typeof extra === 'string' && extra.trim()))
    )
      problems.push(`"titleExtras" must be a list of phrases, e.g. ["Fright Fest", "w/*"]`);
    if (m.enabledByDefault !== undefined && typeof m.enabledByDefault !== 'boolean')
      problems.push(`"enabledByDefault" must be true or false`);
  }

  if (problems.length)
    throw new Error(`plugins/${folder}/manifest.json:\n  - ${problems.join('\n  - ')}`);
  return m as unknown as Manifest;
}
