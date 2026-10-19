<script setup lang="ts">
import { computed } from 'vue';

import { useSchedule } from '../composables/useSchedule';

// A theatre's short coloured label ("VIC"). Shown only when more than one
// theatre is enabled; with one, every film is obviously from it.
const props = defineProps<{ theatre: string; always?: boolean }>();

const { theatreOf, multiTheatre } = useSchedule();
const manifest = computed(() => theatreOf(props.theatre));
</script>

<template>
  <span
    v-if="manifest && (multiTheatre || always)"
    class="inline-block shrink-0 rounded px-1.5 py-px font-mono text-[10px] leading-normal font-bold tracking-wide text-white"
    :style="{ backgroundColor: manifest.color }"
    :title="manifest.name"
  >
    {{ manifest.shortName }}
  </span>
</template>
