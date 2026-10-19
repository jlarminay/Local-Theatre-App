import dayjs from 'dayjs';
import { computed, ref } from 'vue';

import { uniqueFilms, type FirstSeen, type Showtime } from '../lib/schedule';
import { fetchFilmDetails, fetchShowtimes, type FilmDetails } from '../lib/vic';
import { markSeen, type LastCheck } from '../lib/watch';

export type Film = {
  id: number;
  title: string;
  details: FilmDetails | null;
  showtimes: Showtime[];
  isNew: boolean;
};

// Automatic refreshes (opening or returning to the app) run at most once per
// AUTO_REFRESH_MIN_MS, counted from the last attempt — failed ones too, so a
// down site isn't retried on every open. Manual refreshes always run and
// restart the timer. With no cached data the app always fetches.
// Set false while iterating so constant rebuilds don't hit the site; the app
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
const CACHE_VERSION = 5;

type Cache = {
  version: number;
  updatedAt: number;
  showtimes: Showtime[];
  details: Record<number, FilmDetails>;
};

const showtimes = ref<Showtime[]>([]);
const details = ref<Record<number, FilmDetails>>({});
const firstSeen = ref<FirstSeen>({});
const lastCheck = ref<LastCheck | null>(null);
const updatedAt = ref<number | null>(null);
const loading = ref(false);
const error = ref('');

function loadCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Cache | null;
    if (cache?.version !== CACHE_VERSION) return;
    showtimes.value = cache.showtimes;
    details.value = cache.details;
    updatedAt.value = cache.updatedAt;
  } catch {
    // no usable cache — the first refresh fills it
  }
}

function saveCache() {
  try {
    const cache: Cache = {
      version: CACHE_VERSION,
      updatedAt: updatedAt.value ?? Date.now(),
      showtimes: showtimes.value,
      details: details.value,
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable — the app still works, it just refetches on launch
  }
}

const upcoming = computed(() => {
  const cutoff = dayjs().subtract(GRACE_MINUTES, 'minute');
  return showtimes.value.filter((showtime) => !dayjs(showtime.start).isBefore(cutoff));
});

/** Films with upcoming showings, soonest first. */
const films = computed<Film[]>(() =>
  uniqueFilms(upcoming.value).map(({ id, title }) => {
    const filmDetails = details.value[id] ?? null;
    const seenAt = firstSeen.value[id];
    return {
      id,
      title: filmDetails?.name || title,
      details: filmDetails,
      showtimes: upcoming.value.filter((showtime) => showtime.filmId === id),
      isNew: Boolean(seenAt) && Date.now() - seenAt < NEW_FOR_MS,
    };
  }),
);

function lastAttempt(): number {
  try {
    return Number(localStorage.getItem(LAST_ATTEMPT_KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Fetch the schedule now (manual, or an automatic refresh that's due). */
async function refresh() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    localStorage.setItem(LAST_ATTEMPT_KEY, String(Date.now()));
  } catch {
    // storage unavailable — the limit just won't hold across restarts
  }
  try {
    showtimes.value = await fetchShowtimes();
    updatedAt.value = Date.now();
    const ids = uniqueFilms(showtimes.value).map((film) => film.id);
    const fetched = await fetchFilmDetails(ids);
    details.value = Object.fromEntries(fetched.map((film) => [film.id, film]));
    saveCache();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
  await syncSeen();
}

/** For automatic triggers: fetch only with no cache, or when the hourly limit has passed. */
function autoRefreshDue(): boolean {
  if (updatedAt.value === null) return true;
  return AUTO_REFRESH && Date.now() - lastAttempt() >= AUTO_REFRESH_MIN_MS;
}

async function refreshOnLaunch() {
  if (autoRefreshDue()) return refresh();
  await syncSeen();
}

// Tell the runner which films the app has shown, and get back first-seen dates for New badges.
async function syncSeen() {
  try {
    const state = await markSeen(uniqueFilms(showtimes.value));
    firstSeen.value = state.firstSeen;
    lastCheck.value = state.lastCheck;
  } catch (err) {
    console.warn('Could not sync seen films with the background runner', err);
  }
}

/** Forget the cached schedule and fetch it fresh. Saved films are stored separately and kept. */
async function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // storage unavailable — nothing cached anyway
  }
  showtimes.value = [];
  details.value = {};
  updatedAt.value = null;
  await refresh();
}

loadCache();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && autoRefreshDue()) refresh();
});

export function useSchedule() {
  return {
    films,
    upcoming,
    updatedAt,
    lastCheck,
    loading,
    error,
    refresh,
    refreshOnLaunch,
    clearCache,
  };
}
