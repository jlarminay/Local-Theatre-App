import { computed, ref, watch } from 'vue';

import { useSchedule, type Film } from './useSchedule';

// Starred films, kept on the device. Stored apart from the schedule cache so
// bumping CACHE_VERSION never clears them. Each keeps a snapshot of the film so
// it can still be shown after it leaves the schedule.
//
// A save is stored under one theatre's film key ("vic:385117"), but a film
// combined from several theatres has several keys (Film.keys), so lookups
// match on any of them. That way a save survives a film being combined with
// another theatre's listing, or split apart again.

export type SavedFilm = {
  film: Omit<Film, 'showtimes' | 'isNew'>;
  /** Start of the film's final listed showing, once known. */
  lastShowing: string | null;
};

const SAVED_KEY = 'local-theatre:saved';

function load(): Record<string, SavedFilm> {
  try {
    const stored = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as Record<string, SavedFilm>;
    // Saves from before films could be combined lack keys/theatres/links.
    for (const { film } of Object.values(stored)) {
      film.keys ??= [film.key];
      film.theatres ??= [film.theatre];
      film.links ??= film.url ? [{ theatre: film.theatre, url: film.url }] : [];
    }
    return stored;
  } catch {
    return {};
  }
}

const saved = ref<Record<string, SavedFilm>>(load());

function persist() {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved.value));
  } catch {
    // storage unavailable — stars still work until the app closes
  }
}

function snapshot({ showtimes, isNew: _isNew, ...film }: Film): SavedFilm {
  return { film, lastShowing: showtimes.at(-1)?.start ?? null };
}

const overlaps = (a: string[], b: string[]) => a.some((key) => b.includes(key));

/** The key a film is saved under, if it's saved. */
function savedKey(film: { keys: string[] }): string | undefined {
  return Object.keys(saved.value).find(
    (key) => film.keys.includes(key) || overlaps(film.keys, saved.value[key].film.keys),
  );
}

const { films, updatedAt } = useSchedule();

function toggleSaved(film: Film) {
  const next = { ...saved.value };
  const key = savedKey(film);
  if (key) delete next[key];
  else next[film.key] = snapshot(film);
  saved.value = next;
  persist();
}

/** Remove a save — also for films no longer on the schedule. */
function unsave(film: { keys: string[] }) {
  const key = savedKey(film);
  if (!key) return;
  const next = { ...saved.value };
  delete next[key];
  saved.value = next;
  persist();
}

const isSaved = (film: { keys: string[] }) => savedKey(film) !== undefined;

/** The save for a theatre's film key, if any (e.g. for a film page's URL). */
const savedByKey = (key: string): SavedFilm | undefined =>
  saved.value[key] ?? Object.values(saved.value).find((entry) => entry.film.keys.includes(key));

/** A passed save in the shape the poster grid and detail page use. */
export function savedAsFilm(saved: SavedFilm): Film {
  return { ...saved.film, showtimes: [], isNew: false };
}

// Keep snapshots current while films are still listed.
watch(
  films,
  (current) => {
    let changed = false;
    const next = { ...saved.value };
    for (const film of current) {
      const key = savedKey(film);
      if (!key) continue;
      next[key] = snapshot(film);
      changed = true;
    }
    if (!changed) return;
    saved.value = next;
    persist();
  },
  { immediate: true },
);

/** Saved films still on the schedule, soonest first. */
const savedUpcoming = computed(() => films.value.filter(isSaved));

/** Saved films that have left the schedule, most recently shown first. */
const savedPassed = computed<SavedFilm[]>(() => {
  // Until the schedule has loaded once, everything would look passed.
  if (updatedAt.value === null) return [];
  const listed = films.value.flatMap((film) => film.keys);
  return Object.values(saved.value)
    .filter((entry) => !overlaps(entry.film.keys, listed))
    .sort((a, b) => (b.lastShowing ?? '').localeCompare(a.lastShowing ?? ''));
});

export function useSaved() {
  return { saved, savedByKey, isSaved, toggleSaved, unsave, savedUpcoming, savedPassed };
}
