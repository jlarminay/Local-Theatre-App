// The Vic (Victoria Film Theatre). Showtimes come from the monthly calendar
// page; posters and synopses from WooCommerce's public Store API, one request
// for every film.

import { decodeEntities, textOf, textsOf } from '../sdk/html.ts';
import type { Film, Main, Showtime } from '../sdk/types.ts';

const SITE = 'https://www.victoriafilmfestival.com';
const CALENDAR_URL = `${SITE}/festival/victoria-film-theatre-monthly-calendar/`;
const DETAILS_KEY = 'details';

type RawEvent = {
  title: string;
  start: string;
  url: string;
  post_id: number;
  in_stock: string;
  stock_num: number | string;
};

export type CalendarEvent = Showtime & { title: string };

// The calendar (FooEvents + FullCalendar) embeds its events as a JSON string in
// an inline script: `var localObj = '{..."events":[...]}';`. PHP addslashes()es
// the JSON before quoting it, so undoing that (\x → x) gives plain JSON back.
const LOCAL_OBJ = /var localObj = '((?:[^'\\]|\\.)*)'/s;

export function parseCalendar(html: string): CalendarEvent[] {
  const match = html.match(LOCAL_OBJ);
  if (!match)
    throw new Error('Calendar data not found on the page — the site layout may have changed.');
  const data = JSON.parse(match[1].replace(/\\(.)/gs, '$1')) as { events?: RawEvent[] };
  if (!Array.isArray(data.events)) throw new Error('Calendar data has no events list.');

  return data.events
    .filter((event) => Number(event.post_id) && event.start)
    .map((event) => ({
      filmKey: String(Number(event.post_id)),
      title: decodeEntities(event.title),
      start: event.start,
      bookUrl: event.url,
      seatsLeft: Number(event.stock_num) || 0,
      soldOut: event.in_stock !== 'yes',
    }));
}

type StoreProduct = {
  id: number;
  name: string;
  permalink: string;
  description: string;
  images: { src: string; srcset: string }[];
};

export type Details = Omit<Film, 'key'>;

// Paragraphs every listing repeats, which aren't about the film.
const BOILERPLATE = /accessibility|19\+ Event|membership/i;
const TRAILING_ELLIPSIS = /\s*(…|\.\.\.)$/;

// Product names are cut short ("…Toronto Godspell…"), but the description's
// heading usually carries the full title — use it when it extends the name.
function fullTitle(name: string, heading: string): string {
  const base = name.replace(TRAILING_ELLIPSIS, '');
  const long = heading.replace(TRAILING_ELLIPSIS, '');
  return long.length > base.length && long.startsWith(base) ? long : name;
}

export function parseProduct(product: StoreProduct): Details {
  const paragraphs = textsOf(product.description, 'p');
  // The "PG | Documentary | 2026 | 102 min" line.
  const metaIndex = paragraphs.findIndex((p) => p.includes('|'));
  const flags: string[] = [];
  if (paragraphs.some((p) => /membership will need/i.test(p))) flags.push('Membership required');
  return {
    title: fullTitle(textOf(product.name), textsOf(product.description, 'h1')[0] ?? ''),
    url: product.permalink,
    // Square poster artwork (the site's images are all 1:1).
    image: product.images[0]?.src || undefined,
    imageSrcset: product.images[0]?.srcset || undefined,
    imageAspect: 1,
    meta:
      metaIndex >= 0
        ? paragraphs[metaIndex]
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    synopsis: paragraphs.filter((p, i) => i !== metaIndex && !BOILERPLATE.test(p)),
    flags,
  };
}

const main: Main = async (ctx) => {
  const events = parseCalendar(await ctx.http.text(CALENDAR_URL));

  // First (earliest-listed) calendar title per film, as a fallback name.
  const titles = new Map<string, string>();
  for (const event of events)
    if (!titles.has(event.filmKey)) titles.set(event.filmKey, event.title);
  const keys = [...titles.keys()];

  // Details are refetched on every foreground refresh and kept in the store,
  // so background checks (which skip the request) still have them.
  const cached = ctx.store.get<Record<string, Details>>(DETAILS_KEY) ?? {};
  let details = cached;
  if (ctx.mode === 'foreground' && keys.length) {
    try {
      const url = `${SITE}/wp-json/wc/store/v1/products?include=${keys.join(',')}&per_page=100`;
      const products = await ctx.http.json<StoreProduct[]>(url);
      details = { ...cached };
      for (const product of products) details[String(product.id)] = parseProduct(product);
    } catch (err) {
      ctx.log('Film details unavailable, using cached ones:', err);
    }
  }
  // Keep only current films, so the store doesn't grow forever.
  details = Object.fromEntries(
    keys.filter((key) => details[key]).map((key) => [key, details[key]]),
  );
  ctx.store.set(DETAILS_KEY, details);

  return {
    films: keys.map((key) => ({
      ...details[key],
      key,
      title: details[key]?.title || titles.get(key)!,
    })),
    showtimes: events.map(({ title: _title, ...showtime }) => showtime),
  };
};

export default main;
