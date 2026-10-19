<script setup lang="ts">
import { computed } from 'vue';

import { savedAsFilm, useSaved } from '../composables/useSaved';
import { useSchedule } from '../composables/useSchedule';
import { useTheatreFilter } from '../composables/useTheatreFilter';
import PosterGrid from './PosterGrid.vue';

const props = defineProps<{ savedOnly?: boolean }>();

const { films, loading } = useSchedule();
const { savedUpcoming, savedPassed } = useSaved();
const { matches, noneShown } = useTheatreFilter();

// The theatre filter applies to the lineup, not to Saved.
const shown = computed(() =>
  props.savedOnly ? savedUpcoming.value : films.value.filter((film) => film.theatres.some(matches)),
);
const passed = computed(() => (props.savedOnly ? savedPassed.value.map(savedAsFilm) : []));
</script>

<template>
  <p v-if="!shown.length && !passed.length" class="py-16 text-center text-muted-1">
    <template v-if="loading">Loading the lineup…</template>
    <template v-else-if="!savedOnly && noneShown"
      >No theatres selected.<br />Pick some from the theatre menu.</template
    >
    <template v-else-if="savedOnly"
      >You have no movies saved.<br />Tap the ☆ on a poster to save it.</template
    >
    <template v-else>Nothing scheduled right now.</template>
  </p>
  <PosterGrid :films="shown" class="pt-4" />

  <section v-if="passed.length" class="pt-8">
    <h2 class="mb-3 font-display text-[26px] leading-none tracking-wide text-muted-2">
      No longer showing
    </h2>
    <PosterGrid :films="passed" faded />
  </section>
</template>
