import { Capacitor, CapacitorHttp } from '@capacitor/core';

import { CALENDAR_URL, parseCalendar, SITE, type Showtime } from './schedule';

// The site sends no CORS headers, so requests go through CapacitorHttp (native
// networking) rather than fetch(). In a desktop browser (npm run dev) they go
// through Vite's /vic proxy instead — see vite.config.ts.

export type FilmDetails = {
  id: number;
  name: string;
  pageUrl: string;
  /** Square poster artwork (the site's images are all 1:1). */
  image: string | null;
  imageSrcset: string | null;
  /** The "PG | Documentary | 2026 | 102 min" line, split up. */
  meta: string[];
  synopsis: string[];
  flags: string[];
};

async function get(url: string, responseType: 'text' | 'json'): Promise<unknown> {
  if (!Capacitor.isNativePlatform()) {
    if (!import.meta.env.DEV) throw new Error('Only works in the app (or npm run dev).');
    const response = await fetch(url.replace(SITE, '/vic'));
    if (!response.ok) throw new Error(`The Vic's site returned ${response.status}`);
    return responseType === 'json' ? response.json() : response.text();
  }
  const response = await CapacitorHttp.get({ url, responseType });
  if (response.status !== 200) throw new Error(`The Vic's site returned ${response.status}`);
  return response.data;
}

export async function fetchShowtimes(): Promise<Showtime[]> {
  return parseCalendar(String(await get(CALENDAR_URL, 'text')));
}

type StoreProduct = {
  id: number;
  name: string;
  permalink: string;
  description: string;
  images: { src: string; srcset: string }[];
};

// Paragraphs every listing repeats, which aren't about the film.
const BOILERPLATE = /accessibility|19\+ Event|membership/i;

function parseDescription(
  html: string,
): Pick<FilmDetails, 'meta' | 'synopsis' | 'flags'> & { heading: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const paragraphs = Array.from(doc.querySelectorAll('p'))
    .map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const metaIndex = paragraphs.findIndex((p) => p.includes('|'));
  const flags: string[] = [];
  if (paragraphs.some((p) => /membership will need/i.test(p))) flags.push('Membership required');
  return {
    heading: (doc.querySelector('h1')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
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

const TRAILING_ELLIPSIS = /\s*(…|\.\.\.)$/;

// Product names are cut short ("…Toronto Godspell…"), but the description's
// heading usually carries the full title — use it when it extends the name.
function fullTitle(name: string, heading: string): string {
  const base = name.replace(TRAILING_ELLIPSIS, '');
  const long = heading.replace(TRAILING_ELLIPSIS, '');
  return long.length > base.length && long.startsWith(base) ? long : name;
}

function decodeHtml(text: string): string {
  return new DOMParser().parseFromString(text, 'text/html').body.textContent ?? text;
}

/** Posters, synopsis etc. come from WooCommerce's public Store API, one request for all films. */
export async function fetchFilmDetails(ids: number[]): Promise<FilmDetails[]> {
  if (!ids.length) return [];
  const url = `${SITE}/wp-json/wc/store/v1/products?include=${ids.join(',')}&per_page=100`;
  const products = (await get(url, 'json')) as StoreProduct[];
  return products.map((product) => {
    const { heading, ...description } = parseDescription(product.description);
    return {
      id: product.id,
      name: fullTitle(decodeHtml(product.name), heading),
      pageUrl: product.permalink,
      image: product.images[0]?.src ?? null,
      imageSrcset: product.images[0]?.srcset || null,
      ...description,
    };
  });
}
