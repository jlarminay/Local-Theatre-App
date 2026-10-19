// Finding a film's poster on The Movie Database (TMDB). Pure apart from the
// injected `get`, so it runs under Node tests; the app side (caching, which
// theatres use it) is src/composables/usePosters.ts.
//
// Theatre listings carry event wording ("Fright Fest – Suspiria 1977",
// "The Room – Presented by Greg Sestero", "… w/ Q&A – DUFF"), so several
// searches are tried, and a result is only taken when its title matches
// exactly; the release year, when known, has to be close too. No match keeps
// the theatre's own image rather than guessing.

import { titleKey } from '../host/merge.ts';

export type TmdbMovie = {
  id: number;
  title: string;
  original_title?: string;
  /** "1977-02-01" */
  release_date?: string;
  poster_path: string | null;
  /** A wide still from the film, used as the film page's banner. */
  backdrop_path?: string | null;
  popularity?: number;
  vote_count?: number;
};

/** What a lookup finds: image paths ("/abc.jpg") on TMDB's image server. */
export type Found = { poster: string; backdrop: string | null };

export type Get = (
  url: string,
  headers: Record<string, string>,
) => Promise<{ status: number; text: string }>;

export const API = 'https://api.themoviedb.org/3';
const IMAGES = 'https://image.tmdb.org/t/p';
const YEAR_SLACK = 2;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const straightQuotes = (text: string) => text.replace(/[’‘]/g, "'");

/**
 * Cuts a theatre's event wording (its manifest's titleExtras) out of a title:
 * "Fright Fest" anywhere, or "w/*" — a trailing "*" also cuts everything after.
 * Leftover separators ("– ", ": ", empty brackets) are tidied away.
 */
export function stripExtras(title: string, extras: string[]): string {
  let result = straightQuotes(title);
  for (const extra of extras) {
    const phrase = straightQuotes(extra.trim());
    if (!phrase || phrase === '*') continue;
    const rest = phrase.endsWith('*');
    const words = escapeRegExp(rest ? phrase.slice(0, -1).trim() : phrase);
    // Whole words only where the phrase starts/ends with a letter ("DUFF", not "DUFFY").
    const start = /^\w/.test(phrase) ? '\\b' : '';
    const end = rest ? '.*$' : /\w$/.test(phrase) ? '\\b' : '';
    result = result.replace(new RegExp(`${start}${words}${end}`, 'gi'), ' ');
  }
  return result
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s–—:,-]+|[\s–—:,-]+$/g, '')
    .replace(/\s+([–—-])\s+[–—-]\s+/g, ' $1 ')
    .trim();
}

/** Search terms for a listing, most specific first. `extras`: the theatre's titleExtras. */
export function posterQueries(title: string, extras: string[] = []): string[] {
  const clean = (text: string) =>
    text
      .replace(/\s*\([^)]*\)/g, ' ') // "(CAMP! Series)", "(1977)"
      .replace(/\s+w\/.*$/i, '') // "w/ Q&A", "w/ Bruce Vogt"
      .replace(/\s+(19|20)\d\d\s*$/, '') // a trailing (screening) year
      .replace(/\s+/g, ' ')
      .trim();
  const queries: string[] = [];
  const add = (text: string) => {
    const base = clean(text);
    queries.push(base);
    // "Prefix – Film" or "Film – Suffix"; also "Series: Film".
    const dashed = base.split(/\s+[–—-]\s+/);
    if (dashed.length > 1) queries.push(dashed.at(-1)!, dashed[0]);
    const colon = base.split(/:\s+/);
    if (colon.length > 1) queries.push(colon.slice(1).join(': '));
  };
  // The theatre's own wording removed first: it's the most reliable cut.
  if (extras.length) add(stripExtras(title, extras));
  add(title);
  return [...new Set(queries.map((q) => q.replace(/\s+(19|20)\d\d$/, '').trim()))].filter(
    (q) => q.length > 1,
  );
}

const yearOf = (movie: TmdbMovie) => Number(movie.release_date?.slice(0, 4)) || null;

/**
 * How well a result's title fits `wanted` (a titleKey): 2 = the same title;
 * 1 = the part after a colon ("The Lord of the Rings: The Return of the
 * King" for "The Return of the King"), accepted only when the years agree.
 */
function titleFit(movie: TmdbMovie, wanted: string, yearKnown: boolean): number {
  const titles = [movie.title, movie.original_title].filter((t): t is string => Boolean(t));
  if (titles.some((t) => titleKey(t) === wanted)) return 2;
  if (
    yearKnown &&
    titles.some((t) => t.includes(':') && titleKey(t.split(/:\s*/).at(-1)!) === wanted)
  )
    return 1;
  return 0;
}

/**
 * The best result for `query`: its title must fit (see titleFit), and its
 * release year must be within YEAR_SLACK of `year` when that's known. Among
 * those, the most-voted wins, not the closest year: theatres get years a
 * little wrong (Cinecenta's "1978" Shining), and an obscure film of the same
 * name and year would otherwise beat the famous one.
 */
export function pickMovie(
  results: TmdbMovie[],
  query: string,
  year: number | null,
): TmdbMovie | null {
  const wanted = titleKey(query);
  const scored = results.flatMap((movie) => {
    if (!movie.poster_path) return [];
    const released = yearOf(movie);
    if (year !== null && released !== null && Math.abs(released - year) > YEAR_SLACK) return [];
    const fit = titleFit(movie, wanted, year !== null && released !== null);
    return fit ? [{ movie, fit }] : [];
  });
  scored.sort(
    (a, b) =>
      b.fit - a.fit ||
      (b.movie.vote_count ?? 0) - (a.movie.vote_count ?? 0) ||
      (b.movie.popularity ?? 0) - (a.movie.popularity ?? 0),
  );
  return scored[0]?.movie ?? null;
}

/** A v4 "API Read Access Token" goes in a header; a v3 API key goes in the URL. */
function authorise(url: string, key: string): { url: string; headers: Record<string, string> } {
  return key.startsWith('eyJ')
    ? { url, headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } }
    : { url: `${url}&api_key=${encodeURIComponent(key)}`, headers: { Accept: 'application/json' } };
}

/** Checks a key with TMDB: resolves if it works, rejects with a readable reason if not. */
export async function checkKey(get: Get, key: string): Promise<void> {
  const request = authorise(`${API}/configuration?`, key);
  const response = await get(request.url, request.headers);
  if (response.status === 401) throw new Error('TMDB rejected this key');
  if (response.status < 200 || response.status >= 300)
    throw new Error(`TMDB returned ${response.status}`);
}

/** The poster and backdrop for a listing, or null when nothing matches. Throws on API errors. */
/** One TMDB search: its results in TMDB's order. Throws on API errors. */
export async function searchMovies(get: Get, key: string, query: string): Promise<TmdbMovie[]> {
  const request = authorise(
    `${API}/search/movie?query=${encodeURIComponent(query)}&include_adult=false`,
    key,
  );
  const response = await get(request.url, request.headers);
  if (response.status === 401) throw new Error('TMDB rejected the API key');
  if (response.status < 200 || response.status >= 300)
    throw new Error(`TMDB returned ${response.status}`);
  return (JSON.parse(response.text) as { results?: TmdbMovie[] }).results ?? [];
}

export async function findMovie(
  get: Get,
  key: string,
  title: string,
  year: number | null,
  extras: string[] = [],
): Promise<Found | null> {
  for (const query of posterQueries(title, extras)) {
    const movie = pickMovie(await searchMovies(get, key, query), query, year);
    if (movie?.poster_path)
      return { poster: movie.poster_path, backdrop: movie.backdrop_path ?? null };
  }
  return null;
}

/** A small poster for lists of search results. */
export const posterThumb = (path: string) => `${IMAGES}/w92${path}`;

/** Image URLs for a backdrop path. TMDB backdrops are 16:9. */
export function backdropImages(path: string) {
  return {
    image: `${IMAGES}/w1280${path}`,
    imageSrcset: `${IMAGES}/w780${path} 780w, ${IMAGES}/w1280${path} 1280w`,
    imageAspect: 16 / 9,
  };
}

/** Image URLs for a poster path. TMDB posters are 2:3. */
export function posterImages(path: string) {
  return {
    image: `${IMAGES}/w342${path}`,
    imageSrcset: `${IMAGES}/w185${path} 185w, ${IMAGES}/w342${path} 342w, ${IMAGES}/w500${path} 500w`,
    imageAspect: 2 / 3,
  };
}
