import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { computed, ref } from 'vue';

import type { Manifest } from '../../plugins/sdk/types';
import { titleKey } from '../host/merge';
import {
  backdropImages,
  checkKey,
  findMovie,
  posterImages,
  posterQueries,
  searchMovies,
  type Get,
  type TmdbMovie,
} from '../lib/tmdb';

// Posters (and banner stills) from The Movie Database. With a key set, every
// theatre uses them unless its plugin opts out (manifest posterSource:
// "theatre") or the user picks "Use own images" in the theatre's (i). Looked
// up here in the app rather than in the runner: they only matter on screen.
// Each title is looked up once and cached on the device; a miss is retried
// after a week, in case TMDB adds the film.
//
// Each user brings their own TMDB key (Settings → TMDB key). It's kept only in
// this device's storage and never shown again, just a hint of its last
// characters.

export type Poster = ReturnType<typeof posterImages>;
export type Backdrop = ReturnType<typeof backdropImages>;

const KEY_KEY = 'local-theatre:tmdb-key';
/** Theatre ids the user set to "Use own images". */
const OWN_IMAGES_KEY = 'local-theatre:own-images';
const CACHE_KEY = 'local-theatre:tmdb-posters';
const MISS_RETRY_MS = 7 * 86_400_000;
const CONCURRENCY = 3;

/** What a film is looked up by: its title, release year and its theatre's titleExtras. */
export type Lookup = { title: string; year: number | null; extras: string[] };

/**
 * `v`: the matching rules it was found with. Entries from older rules (or
 * none, from before versions) are looked up again, so improvements to
 * matching fix posters that were cached wrong. Bump when matching changes.
 */
const LOOKUP_VERSION = 2;
/** `manual`: picked by the user with Fix on the film page; never looked up again. */
type Entry = {
  path: string | null;
  backdrop?: string | null;
  at: number;
  v?: number;
  manual?: boolean;
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable — lookups just repeat next launch
  }
}

const apiKey = ref(loadJson<string>(KEY_KEY, ''));
/** Whether a TMDB key has been entered. */
const tmdbAvailable = computed(() => Boolean(apiKey.value));
/** "…a1b": enough to tell which key is set, without showing it. */
const keyHint = computed(() => (apiKey.value ? `…${apiKey.value.slice(-3)}` : ''));

function loadOwnImages(): string[] {
  const own = loadJson<string[]>(OWN_IMAGES_KEY, []);
  // From the earlier per-theatre menu: { vic: 'theatre' | 'database' }.
  const old = loadJson<Record<string, string>>('local-theatre:poster-sources', {});
  for (const [id, source] of Object.entries(old))
    if (source === 'theatre' && !own.includes(id)) own.push(id);
  return own;
}
const ownImages = ref<string[]>(loadOwnImages());

const cache = ref<Record<string, Entry>>(loadJson(CACHE_KEY, {}));
/** The last lookup error (e.g. a rejected key), for Settings. */
const lookupError = ref('');

/** Whether a theatre's films get TMDB posters. */
function usesDatabase(manifest: Manifest | undefined): boolean {
  if (!manifest || !tmdbAvailable.value || ownImages.value.includes(manifest.id)) return false;
  return manifest.posterSource !== 'theatre';
}

/** The user's choice for a theatre: "default" (the plugin's setting) or "own" images. */
const imageChoice = (id: string): 'default' | 'own' =>
  ownImages.value.includes(id) ? 'own' : 'default';

function setImageChoice(id: string, choice: 'default' | 'own') {
  const rest = ownImages.value.filter((other) => other !== id);
  ownImages.value = choice === 'own' ? [...rest, id] : rest;
  saveJson(OWN_IMAGES_KEY, ownImages.value);
}

const cacheKey = ({ title, year, extras }: Lookup) =>
  `${titleKey(title)}|${year ?? ''}|${extras.join('|')}`;

/** A looked-up poster and backdrop, once found. Reactive: fills in when a lookup finishes. */
function cachedImages(lookup: Lookup): { poster?: Poster; backdrop?: Backdrop } {
  // An entry from older rules still shows until its new lookup lands.
  const entry = cache.value[cacheKey(lookup)];
  if (!entry?.path) return {};
  return {
    poster: posterImages(entry.path),
    backdrop: entry.backdrop ? backdropImages(entry.backdrop) : undefined,
  };
}

// Native requests go through CapacitorHttp, like the theatre sites;
// TMDB allows cross-origin fetch, so a desktop browser can call it directly.
const get: Get = async (url, headers) => {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({ url, headers, responseType: 'text' });
    // CapacitorHttp parses JSON responses into objects even when asked for text.
    const text =
      typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? null);
    return { status: response.status, text };
  }
  const response = await fetch(url, { headers });
  return { status: response.status, text: await response.text() };
};

const queue: Lookup[] = [];
const pending = new Set<string>();
let running = 0;
let keyRejected = false;

function pump() {
  while (running < CONCURRENCY && queue.length && !keyRejected) {
    const lookup = queue.shift()!;
    const { title, year, extras } = lookup;
    const entryKey = cacheKey(lookup);
    running++;
    findMovie(get, apiKey.value, title, year, extras)
      .then((found) => {
        const entry: Entry = found
          ? { path: found.poster, backdrop: found.backdrop, at: Date.now(), v: LOOKUP_VERSION }
          : { path: null, backdrop: null, at: Date.now(), v: LOOKUP_VERSION };
        cache.value = { ...cache.value, [entryKey]: entry };
        saveJson(CACHE_KEY, cache.value);
        lookupError.value = '';
      })
      .catch((err) => {
        lookupError.value = err instanceof Error ? err.message : String(err);
        if (/rejected the API key/.test(lookupError.value)) keyRejected = true;
        console.warn(`Poster lookup for "${title}" failed`, err);
      })
      .finally(() => {
        pending.delete(entryKey);
        running--;
        pump();
      });
  }
}

/** Queues lookups for any of these films not cached yet (or due a retry). */
function requestPosters(films: Lookup[]) {
  if (!tmdbAvailable.value) return;
  const now = Date.now();
  for (const film of films) {
    const entryKey = cacheKey(film);
    const entry = cache.value[entryKey];
    const fresh =
      entry?.manual ||
      (entry?.v === LOOKUP_VERSION && (entry.path !== null || now - entry.at < MISS_RETRY_MS));
    if (pending.has(entryKey) || fresh) continue;
    pending.add(entryKey);
    queue.push(film);
  }
  pump();
}

// Fixing a wrong match by hand (the film page's Fix).

/** What the automatic lookup searched for first; the Fix search starts from it. */
const firstQuery = (lookup: Lookup) =>
  posterQueries(lookup.title, lookup.extras)[0] ?? lookup.title;

/** The top results with posters for a search, for picking from. */
async function searchForFix(query: string, limit = 5): Promise<TmdbMovie[]> {
  return (await searchMovies(get, apiKey.value, query.trim()))
    .filter((movie) => movie.poster_path)
    .slice(0, limit);
}

/** The cached match for a film: its poster path (null = none) and whether it was picked by hand. */
function matchOf(lookup: Lookup): { path: string | null; manual: boolean } | undefined {
  const entry = cache.value[cacheKey(lookup)];
  return entry && { path: entry.path, manual: Boolean(entry.manual) };
}

/** Uses this TMDB film for the listing from now on; null = the theatre's own image. */
function setMatch(lookup: Lookup, movie: TmdbMovie | null) {
  const entry: Entry = {
    path: movie?.poster_path ?? null,
    backdrop: movie?.backdrop_path ?? null,
    at: Date.now(),
    v: LOOKUP_VERSION,
    manual: true,
  };
  cache.value = { ...cache.value, [cacheKey(lookup)]: entry };
  saveJson(CACHE_KEY, cache.value);
}

/** Forgets a hand-picked match and looks the film up automatically again. */
function clearMatch(lookup: Lookup) {
  const next = { ...cache.value };
  delete next[cacheKey(lookup)];
  cache.value = next;
  saveJson(CACHE_KEY, cache.value);
  requestPosters([lookup]);
}

/** Checks a key with TMDB, then saves it in place of any old one. Rejects if TMDB refuses it. */
async function saveKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Enter a key');
  await checkKey(get, trimmed);
  apiKey.value = trimmed;
  saveJson(KEY_KEY, trimmed);
  keyRejected = false;
  lookupError.value = '';
  pump();
}

function removeKey() {
  apiKey.value = '';
  try {
    localStorage.removeItem(KEY_KEY);
  } catch {
    // storage unavailable — nothing stored anyway
  }
  queue.length = 0;
  lookupError.value = '';
}

export function usePosters() {
  return {
    tmdbAvailable,
    keyHint,
    saveKey,
    removeKey,
    usesDatabase,
    imageChoice,
    setImageChoice,
    cachedImages,
    requestPosters,
    lookupError,
    firstQuery,
    searchForFix,
    matchOf,
    setMatch,
    clearMatch,
  };
}
