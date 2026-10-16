// Pure parsing of the Vic's calendar page. Shared by the app and the background
// runner (runner/runner.ts), so nothing here may touch the DOM or Capacitor —
// the runner's JS engine has neither.

export const SITE = 'https://www.victoriafilmfestival.com';
export const CALENDAR_URL = `${SITE}/festival/victoria-film-theatre-monthly-calendar/`;

export type Showtime = {
  filmId: number;
  title: string;
  /** Theatre-local wall time, e.g. "2026-10-16T19:30:00" (no offset). */
  start: string;
  bookUrl: string;
  seatsLeft: number;
  soldOut: boolean;
};

type RawEvent = {
  title: string;
  start: string;
  url: string;
  post_id: number;
  in_stock: string;
  stock_num: number | string;
};

// The calendar (FooEvents + FullCalendar) embeds its events as a JSON string in
// an inline script: `var localObj = '{..."events":[...]}';`. PHP addslashes()es
// the JSON before quoting it, so undoing that (\x → x) gives plain JSON back.
const LOCAL_OBJ = /var localObj = '((?:[^'\\]|\\.)*)'/s;

export function parseCalendar(html: string): Showtime[] {
  const match = html.match(LOCAL_OBJ);
  if (!match)
    throw new Error('Calendar data not found on the page — the site layout may have changed.');
  const data = JSON.parse(match[1].replace(/\\(.)/gs, '$1')) as { events?: RawEvent[] };
  if (!Array.isArray(data.events)) throw new Error('Calendar data has no events list.');

  return data.events
    .map((event) => ({
      filmId: Number(event.post_id),
      title: decodeEntities(event.title),
      start: event.start,
      bookUrl: event.url,
      seatsLeft: Number(event.stock_num) || 0,
      soldOut: event.in_stock !== 'yes',
    }))
    .filter((showtime) => showtime.filmId && showtime.start)
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** One entry per film, keeping the first (earliest) title seen. */
export function uniqueFilms(showtimes: Showtime[]): { id: number; title: string }[] {
  const films = new Map<number, string>();
  for (const showtime of showtimes)
    if (!films.has(showtime.filmId)) films.set(showtime.filmId, showtime.title);
  return [...films].map(([id, title]) => ({ id, title }));
}

const NAMED: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  hellip: '…',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, code: string) => {
    if (code[0] !== '#') return NAMED[code.toLowerCase()] ?? whole;
    const n =
      code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
  });
}

// "Seen" bookkeeping, also shared: film id → when it first appeared (epoch ms).
// The very first check records everything as 0 so an install doesn't flag the
// whole current lineup as new.
export type FirstSeen = Record<string, number>;

export function recordSeen(seen: FirstSeen, films: { id: number }[], now = Date.now()): number[] {
  const baseline = Object.keys(seen).length === 0;
  const added: number[] = [];
  for (const { id } of films) {
    if (String(id) in seen) continue;
    seen[id] = baseline ? 0 : now;
    if (!baseline) added.push(id);
  }
  return added;
}
