<script setup lang="ts">
import { computed } from 'vue';

import { savedAsFilm, useSaved } from '../composables/useSaved';
import { useSchedule } from '../composables/useSchedule';
import { formatDay, formatTime, LOW_SEATS } from '../lib/format';
import { goBack } from '../router';
import StarIcon from './StarIcon.vue';

const { films } = useSchedule();
const props = defineProps<{ id: number }>();
const { saved, isSaved, toggleSaved, unsave } = useSaved();

// A saved film that has left the schedule still opens, from its saved snapshot.
const passedSave = computed(() =>
  films.value.some((f) => f.id === props.id) ? undefined : saved.value[props.id],
);
const film = computed(
  () =>
    films.value.find((f) => f.id === props.id) ??
    (passedSave.value ? savedAsFilm(passedSave.value) : null),
);

function onStar() {
  if (!film.value) return;
  if (isSaved(film.value.id)) unsave(film.value.id);
  else toggleSaved(film.value);
}
</script>

<template>
  <div class="-mx-4 pb-10">
    <div class="relative">
      <img
        v-if="film?.details?.image"
        :src="film.details.image"
        :alt="film.title"
        class="fade-img aspect-video w-full bg-imgbg object-cover"
        @load="(event) => (event.target as HTMLElement).classList.add('loaded')"
      />
      <div v-else class="aspect-video w-full bg-card" />
    </div>

    <!-- Pinned to the screen so Back/Save stay reachable while scrolling. The bar
         itself ignores taps so the page underneath stays usable between the buttons. -->
    <div
      class="pointer-events-none fixed inset-x-0 top-0 z-10 mx-auto flex max-w-3xl justify-between px-3 pt-[max(env(safe-area-inset-top),12px)]"
    >
      <button
        class="pointer-events-auto rounded-full border-0 bg-black/60 px-4 py-2 text-white backdrop-blur"
        @click="goBack"
      >
        ← Back
      </button>
      <button
        v-if="film"
        class="pointer-events-auto flex items-center gap-1.5 rounded-full border-0 bg-black/60 py-2 pr-4 pl-3 backdrop-blur transition-colors duration-200"
        :class="isSaved(film.id) ? 'text-accent' : 'text-white'"
        :aria-pressed="isSaved(film.id)"
        @click="onStar"
      >
        <span class="h-5 w-5"><StarIcon :filled="isSaved(film.id)" /></span>
        <span class="text-white">{{ isSaved(film.id) ? 'Saved' : 'Save' }}</span>
      </button>
    </div>

    <div v-if="film" class="px-4 pt-4">
      <h2 class="mb-1 text-[26px] leading-tight font-bold">{{ film.title }}</h2>
      <p v-if="film.details?.meta.length" class="mb-3 font-mono text-[12px] text-muted-1">
        {{ film.details.meta.join(' · ') }}
      </p>
      <div v-if="film.details?.flags.length" class="mb-4 flex flex-wrap gap-2">
        <span
          v-for="flag in film.details?.flags"
          :key="flag"
          class="rounded bg-accent/15 px-2 py-0.5 text-[12px] font-medium text-accent"
        >
          {{ flag }}
        </span>
      </div>
      <p
        v-for="(paragraph, i) in film.details?.synopsis"
        :key="i"
        class="leading-relaxed text-muted-2"
      >
        {{ paragraph }}
      </p>

      <p v-if="passedSave" class="mt-6 rounded-lg bg-card px-3.5 py-3 text-[14px] text-muted-2">
        No longer showing<template v-if="passedSave.lastShowing">
          · last shown {{ formatDay(passedSave.lastShowing) }}</template
        >
      </p>
      <h3
        v-if="film.showtimes.length"
        class="mt-6 mb-2 font-display text-[24px] leading-none tracking-wide text-accent"
      >
        Showtimes
      </h3>
      <ul
        v-if="film.showtimes.length"
        class="m-0 list-none divide-y divide-border-1 overflow-hidden rounded-xl border border-border-1 bg-card p-0"
      >
        <li
          v-for="showtime in film.showtimes"
          :key="showtime.start"
          class="flex items-center gap-3 px-3.5 py-3"
        >
          <span class="flex-1">
            <span class="font-medium">{{ formatDay(showtime.start) }}</span>
            <span class="ml-2 font-mono text-[13px] text-muted-2">{{
              formatTime(showtime.start)
            }}</span>
          </span>
          <span v-if="showtime.soldOut" class="font-mono text-[11px] text-error">Sold out</span>
          <template v-else>
            <span
              class="font-mono text-[11px]"
              :class="showtime.seatsLeft <= LOW_SEATS ? 'text-error' : 'text-muted-1'"
            >
              {{ showtime.seatsLeft }} seats
            </span>
            <a
              :href="showtime.bookUrl"
              target="_blank"
              rel="noopener"
              class="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white no-underline"
            >
              Tickets
            </a>
          </template>
        </li>
      </ul>

      <a
        v-if="film.details?.pageUrl"
        :href="film.details.pageUrl"
        target="_blank"
        rel="noopener"
        class="mt-4 inline-block text-[13px] text-accent"
      >
        View on the Vic's site ↗
      </a>
    </div>
    <p v-else class="px-4 py-16 text-center text-muted-1">This film is no longer scheduled.</p>
  </div>
</template>
