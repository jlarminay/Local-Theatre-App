import type { Film, ScrapeResult, Showtime } from './types.ts';

// Checks what a plugin's main() returned. Bad entries are dropped (and
// reported) rather than failing the whole theatre, unless nothing usable is left.

export type Validated = { result: ScrapeResult; dropped: string[] };

const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const optStr = (v: unknown) => v === undefined || typeof v === 'string';
const optStrs = (v: unknown) =>
  v === undefined || (Array.isArray(v) && v.every((s) => typeof s === 'string'));
const optNum = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isFinite(v));

function filmProblem(f: Record<string, unknown>): string | null {
  if (!isStr(f.key)) return 'missing key';
  if (!isStr(f.title)) return 'missing title';
  if (!optStr(f.url) || !optStr(f.image) || !optStr(f.imageSrcset)) return 'url/image not a string';
  if (!optNum(f.imageAspect)) return 'imageAspect not a number';
  if (!optStrs(f.meta) || !optStrs(f.synopsis) || !optStrs(f.flags))
    return 'meta/synopsis/flags not a list of strings';
  return null;
}

function showtimeProblem(s: Record<string, unknown>, keys: Set<string>): string | null {
  if (!isStr(s.filmKey)) return 'missing filmKey';
  if (!keys.has(s.filmKey)) return `filmKey "${s.filmKey}" has no film`;
  if (!isStr(s.start) || !LOCAL_TIME.test(s.start))
    return `start ${JSON.stringify(s.start)} isn't local time like "2026-10-23T19:30:00"`;
  if (!optStr(s.bookUrl) || !optStr(s.note)) return 'bookUrl/note not a string';
  if (!optNum(s.seatsLeft)) return 'seatsLeft not a number';
  if (s.soldOut !== undefined && typeof s.soldOut !== 'boolean') return 'soldOut not a boolean';
  return null;
}

export function validateResult(raw: unknown): Validated {
  const r = raw as Partial<Record<keyof ScrapeResult, unknown>> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.films) || !Array.isArray(r.showtimes))
    throw new Error('main() must return { films: [...], showtimes: [...] }');

  const dropped: string[] = [];
  const films: Film[] = [];
  const keys = new Set<string>();
  for (const f of r.films as Record<string, unknown>[]) {
    const problem = f && typeof f === 'object' ? filmProblem(f) : 'not an object';
    if (!problem && keys.has(f.key as string)) dropped.push(`film "${f.key}": duplicate key`);
    else if (problem) dropped.push(`film ${JSON.stringify(f?.key ?? f?.title)}: ${problem}`);
    else {
      films.push(f as unknown as Film);
      keys.add(f.key as string);
    }
  }

  const showtimes: Showtime[] = [];
  for (const s of r.showtimes as Record<string, unknown>[]) {
    const problem = s && typeof s === 'object' ? showtimeProblem(s, keys) : 'not an object';
    if (problem) dropped.push(`showtime ${JSON.stringify(s?.start)}: ${problem}`);
    else showtimes.push(s as unknown as Showtime);
  }

  const given = r.films.length + r.showtimes.length;
  if (given && !films.length && !showtimes.length)
    throw new Error(`Every entry was invalid:\n  - ${dropped.slice(0, 10).join('\n  - ')}`);
  showtimes.sort((a, b) => a.start.localeCompare(b.start));
  return { result: { films, showtimes }, dropped };
}
