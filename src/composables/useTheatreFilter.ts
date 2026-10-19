import { computed, ref } from 'vue';

import { useSchedule } from './useSchedule';

// Which theatres the Films and By day lists show (the dropdown in the header).
// Saved always shows everything, and a film page still opens for a film of a
// hidden theatre. Stored as the theatres *hidden*, so a newly added theatre
// shows up without anyone having to tick it.

const HIDDEN_KEY = 'local-theatre:hidden-theatres';

function load(): string[] {
  try {
    const hidden = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]');
    return Array.isArray(hidden) ? hidden.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

const hidden = ref<string[]>(load());
const { enabledTheatres, multiTheatre } = useSchedule();

function save(next: string[]) {
  hidden.value = next;
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — the choice just isn't remembered
  }
}

/** Enabled theatres with whether each is shown. With only one, there's nothing to filter. */
const options = computed(() =>
  multiTheatre.value
    ? enabledTheatres.value.map(({ manifest }) => ({
        id: manifest.id,
        name: manifest.name,
        color: manifest.color,
        shown: !hidden.value.includes(manifest.id),
      }))
    : [],
);

const shownCount = computed(() => options.value.filter((option) => option.shown).length);
const allShown = computed(() => shownCount.value === options.value.length);

/** Button text: "All theatres", "No theatres", "The Vic", "2 theatres". */
const label = computed(() => {
  if (allShown.value) return 'All theatres';
  if (!shownCount.value) return 'No theatres';
  if (shownCount.value === 1) return options.value.find((option) => option.shown)!.name;
  return `${shownCount.value} theatres`;
});

function toggle(id: string) {
  save(
    hidden.value.includes(id)
      ? hidden.value.filter((other) => other !== id)
      : [...hidden.value, id],
  );
}

/** All when some are hidden, else none. */
function toggleAll() {
  save(allShown.value ? options.value.map((option) => option.id) : []);
}

/** Whether lists should show this theatre's films. Everything shows when there's only one theatre. */
const matches = (theatre: string) => !multiTheatre.value || !hidden.value.includes(theatre);

/** True when the lists are empty only because every theatre is unticked. */
const noneShown = computed(() => multiTheatre.value && shownCount.value === 0);

export function useTheatreFilter() {
  return { options, label, allShown, shownCount, noneShown, toggle, toggleAll, matches };
}
