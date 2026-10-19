import dayjs from 'dayjs';
import { computed, ref } from 'vue';

import type { FirstSeen, HostFilm, HostShowtime, HostState } from '../host/host';
import { groupFilms } from '../host/merge';
import { clearTheatreData, loadState, refreshTheatres, setEnabledTheatres } from '../lib/watch';

export type Showtime = HostShowtime;
/**
 * A film as the app shows it: one theatre's listing, or several theatres'
 * listings of the same film combined. `key` and `theatre` are the main
 * listing's; `keys` and `theatres` cover every listing.
 */
export type Film = HostFilm & {
  keys: string[];
  theatres: string[];
  /** Each theatre's page for the film. */
  links: { theatre: string; url: string }[];
  showtimes: Showtime[];
  isNew: boolean;
};

// The schedule is whatever the theatre plugins last returned, held by the
// background runner (src/lib/watch.ts). A copy is cached here so the app can
// show it instantly on launch, before the runner answers.

// Automatic refreshes (opening or returning to the app) run at most once per
// AUTO_REFRESH_MIN_MS, counted from the last attempt — failed ones too, so a
// down site isn't retried on every open. Manual refreshes always run and
// restart the timer. With no cached data the app always fetches.
// Set false while iterating so constant rebuilds don't hit the sites; the app
// then only fetches with no cache, or from Settings → Refresh now.
const AUTO_REFRESH = true;
export const AUTO_REFRESH_MIN_MS = 60 * 60_000;
const LAST_ATTEMPT_KEY = 'local-theatre:last-fetch-attempt';

// Films first seen within this window get a "New" badge.
const NEW_FOR_MS = 7 * 86_400_000;
// Keep a showing listed until shortly after it starts.
const GRACE_MINUTES = 30;

const CACHE_KEY = 'local-theatre:cache';
// Bump when the cached shape changes, so older caches are ignored.
const CACHE_VERSION = 1;

type Cache = { version: number; state: HostState };

const state = ref<HostState | null>(null);
const loading = ref(false);
const error = ref('');

function loadCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Cache | null;
    if (cache?.version === CACHE_VERSION) state.value = cache.state;
  } catch {
    // no usable cache — the first refresh fills it
  }
}

function setState(next: HostState) {
  state.value = next;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ version: CACHE_VERSION, state: next }));
  } catch {
    // storage unavailable — the app still works, it just waits for the runner on launch
  }
}

/**
 * Every installed theatre, alphabetical by name, for display. The host's own
 * order (enabled first, in run order) only matters to the runner.
 */
const theatres = computed(() =>
  [...(state.value?.theatres ?? [])].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name)),
);
const enabledTheatres = computed(() => theatres.value.filter((theatre) => theatre.enabled));
const lastCheck = computed(() => state.value?.lastCheck ?? null);
/** Theatre tags and filters only matter once there's more than one. */
const multiTheatre = computed(() => enabledTheatres.value.length > 1);

/** The oldest successful update among enabled theatres, so "Updated …" never overstates. */
const updatedAt = computed(() => {
  const times = enabledTheatres.value.flatMap((theatre) => theatre.updatedAt ?? []);
  return times.length ? Math.min(...times) : null;
});

const upcoming = computed(() => {
  const cutoff = dayjs().subtract(GRACE_MINUTES, 'minute');
  return enabledTheatres.value
    .flatMap((theatre) => theatre.showtimes)
    .filter((showtime) => !dayjs(showtime.start).isBefore(cutoff))
    .sort((a, b) => a.start.localeCompare(b.start));
});

// Show a film listed by several theatres once (src/host/merge.ts). A display
// setting: the runner, first-seen dates and saves keep per-theatre keys.
const COMBINE_KEY = 'local-theatre:combine-films';
const combineFilms = ref(loadCombine());

function loadCombine(): boolean {
  try {
    return localStorage.getItem(COMBINE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function setCombineFilms(on: boolean) {
  combineFilms.value = on;
  try {
    localStorage.setItem(COMBINE_KEY, String(on));
  } catch {
    // storage unavailable — the choice just isn't remembered
  }
}

const detailScore = (film: HostFilm) =>
  (film.image ? 2 : 0) + (film.synopsis?.length ? 1 : 0) + (film.meta?.length ? 1 : 0);
const synopsisLength = (film: HostFilm) => film.synopsis?.join('').length ?? 0;

/** One film from one or more theatres' listings of it. */
function combine(members: HostFilm[], showtimes: Showtime[], firstSeen: FirstSeen): Film {
  // The fullest listing leads (ties: the longer synopsis); gaps come from the others.
  const [main, ...rest] = [...members].sort(
    (a, b) => detailScore(b) - detailScore(a) || synopsisLength(b) - synopsisLength(a),
  );
  const withImage = [main, ...rest].find((film) => film.image);
  const fill = <K extends 'meta' | 'synopsis' | 'flags'>(field: K) =>
    [main, ...rest].find((film) => film[field]?.length)?.[field];
  // New only if every theatre's listing is: a film the Vic has had for weeks
  // isn't new just because Cinecenta added it.
  const seen = members.map((film) => firstSeen[film.key]);
  return {
    ...main,
    image: withImage?.image,
    imageSrcset: withImage?.imageSrcset,
    imageAspect: withImage?.imageAspect,
    meta: fill('meta'),
    synopsis: fill('synopsis'),
    flags: fill('flags'),
    keys: members.map((film) => film.key),
    theatres: members.map((film) => film.theatre),
    links: members.flatMap((film) => (film.url ? [{ theatre: film.theatre, url: film.url }] : [])),
    showtimes,
    isNew: seen.every(Boolean) && Date.now() - Math.min(...seen) < NEW_FOR_MS,
  };
}

/** Films with upcoming showings, soonest first. */
const films = computed<Film[]>(() => {
  const showtimes = new Map<string, Showtime[]>();
  for (const showtime of upcoming.value)
    showtimes.set(showtime.filmKey, [...(showtimes.get(showtime.filmKey) ?? []), showtime]);
  const listed = enabledTheatres.value
    .flatMap((theatre) => theatre.films)
    .filter((film) => showtimes.has(film.key));
  const groups = combineFilms.value ? groupFilms(listed) : listed.map((film) => [film]);
  const firstSeen = state.value?.firstSeen ?? {};
  return groups
    .map((members) =>
      combine(
        members,
        members
          .flatMap((film) => showtimes.get(film.key)!)
          .sort((a, b) => a.start.localeCompare(b.start)),
        firstSeen,
      ),
    )
    .sort((a, b) => a.showtimes[0].start.localeCompare(b.showtimes[0].start));
});

/** The film (combined or not) that a theatre's film key belongs to. */
const filmByKey = computed(
  () => new Map(films.value.flatMap((film) => film.keys.map((key) => [key, film] as const))),
);

/** A theatre's manifest by id, if it's still installed. */
const theatreOf = (id: string) => theatres.value.find((t) => t.manifest.id === id)?.manifest;

/** Turns a theatre on or off. A theatre with no results yet is fetched straight away. */
async function setTheatreEnabled(id: string, on: boolean) {
  // From the host's order, so switching one theatre doesn't reorder the others' runs.
  const ids = (state.value?.theatres ?? [])
    .filter((t) => t.enabled && t.manifest.id !== id)
    .map((t) => t.manifest.id);
  setState(await setEnabledTheatres(on ? [...ids, id] : ids));
  if (on && !theatres.value.find((t) => t.manifest.id === id)?.updatedAt) await refresh();
}

function lastAttempt(): number {
  try {
    return Number(localStorage.getItem(LAST_ATTEMPT_KEY)) || 0;
  } catch {
    return 0;
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Fetch the schedule now (manual, or an automatic refresh that's due). */
async function refresh() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  const started = Date.now();
  try {
    localStorage.setItem(LAST_ATTEMPT_KEY, String(started));
  } catch {
    // storage unavailable — the limit just won't hold across restarts
  }
  try {
    setState(await refreshTheatres());
    // A failing theatre keeps its last results; say which one failed.
    error.value = enabledTheatres.value
      .filter(({ lastRun }) => lastRun && !lastRun.ok && lastRun.at >= started)
      .map(({ manifest, lastRun }) => `${manifest.name}: ${lastRun!.error}`)
      .join('\n');
  } catch (err) {
    error.value = errorText(err);
  } finally {
    loading.value = false;
  }
}

/** Pick up what the runner has (e.g. from a background check), without fetching. */
async function syncState() {
  try {
    setState(await loadState());
  } catch (err) {
    console.warn('Could not read the schedule from the background runner', err);
  }
}

/** For automatic triggers: fetch only with no cache, or when the hourly limit has passed. */
function autoRefreshDue(): boolean {
  if (updatedAt.value === null) return true;
  return AUTO_REFRESH && Date.now() - lastAttempt() >= AUTO_REFRESH_MIN_MS;
}

async function refreshOnLaunch() {
  if (autoRefreshDue()) return refresh();
  await syncState();
}

/** Forget the cached schedule (and plugins' stored details) and fetch it fresh. Saved films are kept. */
async function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // storage unavailable — nothing cached anyway
  }
  await clearTheatreData();
  state.value = null;
  await refresh();
}

loadCache();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (autoRefreshDue()) refresh();
  else syncState();
});

export function useSchedule() {
  return {
    films,
    filmByKey,
    combineFilms,
    setCombineFilms,
    upcoming,
    theatres,
    enabledTheatres,
    multiTheatre,
    theatreOf,
    setTheatreEnabled,
    updatedAt,
    lastCheck,
    loading,
    error,
    refresh,
    refreshOnLaunch,
    syncState,
    clearCache,
  };
}
