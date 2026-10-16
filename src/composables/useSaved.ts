import { computed, ref, watch } from 'vue';

import type { FilmDetails } from '../lib/vic';
import { useSchedule, type Film } from './useSchedule';

// Starred films, kept on the device. Stored apart from the schedule cache so
// bumping CACHE_VERSION never clears them. Each keeps a snapshot of the film so
// it can still be shown after it leaves the schedule.

export type SavedFilm = {
  id: number;
  title: string;
  details: FilmDetails | null;
  /** Start of the film's final listed showing, once known. */
  lastShowing: string | null;
};

const SAVED_KEY = 'vic-theatre:saved';

function load(): Record<number, SavedFilm> {
  try {
    const stored = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as
      Record<number, SavedFilm> | number[];
    // Saves used to be a bare list of ids; their snapshots fill in from the schedule.
    if (Array.isArray(stored)) {
      return Object.fromEntries(
        stored.map((id) => [id, { id, title: '', details: null, lastShowing: null }]),
      );
    }
    return stored;
  } catch {
    return {};
  }
}

const saved = ref<Record<number, SavedFilm>>(load());

function persist() {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved.value));
  } catch {
    // storage unavailable — stars still work until the app closes
  }
}

function snapshot(film: Film): SavedFilm {
  return {
    id: film.id,
    title: film.title,
    details: film.details,
    lastShowing: film.showtimes.at(-1)?.start ?? null,
  };
}

const { films, updatedAt } = useSchedule();

function toggleSaved(film: Film) {
  const next = { ...saved.value };
  if (next[film.id]) delete next[film.id];
  else next[film.id] = snapshot(film);
  saved.value = next;
  persist();
}

/** Remove by id — for films no longer on the schedule. */
function unsave(id: number) {
  const next = { ...saved.value };
  delete next[id];
  saved.value = next;
  persist();
}

const isSaved = (id: number) => id in saved.value;

/** A passed save in the shape the poster grid and detail page use. */
export function savedAsFilm(film: SavedFilm): Film {
  return {
    id: film.id,
    title: film.title || film.details?.name || 'Saved film',
    details: film.details,
    showtimes: [],
    isNew: false,
  };
}

// Keep snapshots current while films are still listed.
watch(
  films,
  (current) => {
    let changed = false;
    const next = { ...saved.value };
    for (const film of current) {
      if (!next[film.id]) continue;
      next[film.id] = snapshot(film);
      changed = true;
    }
    if (!changed) return;
    saved.value = next;
    persist();
  },
  { immediate: true },
);

/** Saved films still on the schedule, soonest first. */
const savedUpcoming = computed(() => films.value.filter((film) => isSaved(film.id)));

/** Saved films that have left the schedule, most recently shown first. */
const savedPassed = computed<SavedFilm[]>(() => {
  // Until the schedule has loaded once, everything would look passed.
  if (updatedAt.value === null) return [];
  const listed = new Set(films.value.map((film) => film.id));
  return Object.values(saved.value)
    .filter((film) => !listed.has(film.id))
    .sort((a, b) => (b.lastShowing ?? '').localeCompare(a.lastShowing ?? ''));
});

export function useSaved() {
  return { saved, isSaved, toggleSaved, unsave, savedUpcoming, savedPassed };
}
