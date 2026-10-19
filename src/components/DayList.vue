<script setup lang="ts">
import { computed } from 'vue';

import { useSchedule, type Showtime } from '../composables/useSchedule';
import { useTheatreFilter } from '../composables/useTheatreFilter';
import { dayKey, formatDay, formatTime, LOW_SEATS } from '../lib/format';
import { openFilm } from '../router';
import TheatreTag from './TheatreTag.vue';

const { upcoming, filmByKey, loading } = useSchedule();
const { matches, noneShown } = useTheatreFilter();

const days = computed(() => {
  const groups = new Map<string, Showtime[]>();
  for (const showtime of upcoming.value) {
    if (!matches(showtime.theatre)) continue;
    const key = dayKey(showtime.start);
    groups.set(key, [...(groups.get(key) ?? []), showtime]);
  }
  return [...groups].map(([key, showtimes]) => ({
    key,
    label: formatDay(showtimes[0].start),
    showtimes,
  }));
});

const titleOf = (key: string) => filmByKey.value.get(key)?.title ?? '';
const isNew = (key: string) => filmByKey.value.get(key)?.isNew ?? false;
</script>

<template>
  <p v-if="!days.length" class="py-16 text-center text-muted-1">
    {{
      loading
        ? 'Loading the lineup…'
        : noneShown
          ? 'No theatres selected.'
          : 'Nothing scheduled right now.'
    }}
  </p>
  <section v-for="day in days" :key="day.key" class="pt-5">
    <h2 class="mb-2 font-display text-[26px] leading-none tracking-wide text-accent">
      {{ day.label }}
    </h2>
    <ul
      class="m-0 list-none divide-y divide-border-1 overflow-hidden rounded-xl border border-border-1 bg-card p-0"
    >
      <li v-for="showtime in day.showtimes" :key="showtime.start + showtime.filmKey">
        <button
          class="flex w-full items-baseline gap-3 border-0 bg-transparent px-3.5 py-3 text-left text-ink"
          @click="openFilm(showtime.filmKey)"
        >
          <span class="min-w-20 shrink-0 font-mono whitespace-nowrap text-[13px] text-muted-2">{{
            formatTime(showtime.start)
          }}</span>
          <TheatreTag :theatre="showtime.theatre" class="self-center" />
          <span
            class="min-w-0 flex-1 truncate font-medium"
            :class="showtime.soldOut && 'text-muted-1 line-through'"
          >
            {{ titleOf(showtime.filmKey) }}
          </span>
          <span
            v-if="isNew(showtime.filmKey)"
            class="shrink-0 rounded bg-accent px-1.5 text-[11px] font-bold text-white"
            >NEW</span
          >
          <span v-if="showtime.soldOut" class="shrink-0 font-mono text-[11px] text-error"
            >Sold out</span
          >
          <span
            v-else-if="showtime.seatsLeft !== undefined && showtime.seatsLeft <= LOW_SEATS"
            class="shrink-0 font-mono text-[11px] text-error"
          >
            {{ showtime.seatsLeft }} left
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>
