<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { usePosters } from '../composables/usePosters';
import { savedAsFilm, useSaved } from '../composables/useSaved';
import { useSchedule } from '../composables/useSchedule';
import { formatDay, formatTime, LOW_SEATS } from '../lib/format';
import { goBack } from '../router';
import FixMatchModal from './FixMatchModal.vue';
import StarIcon from './StarIcon.vue';
import TheatreTag from './TheatreTag.vue';

const { filmByKey, theatreOf, multiTheatre } = useSchedule();
const props = defineProps<{ filmKey: string }>();
const { savedByKey, isSaved, toggleSaved, unsave } = useSaved();
const { tmdbAvailable } = usePosters();

// Fix a wrong TMDB match. The modal is a query param (?info=fix), like
// Settings' modals, so Android's Back closes it.
const route = useRoute();
const router = useRouter();
const fixOpen = computed(() => route.query.info === 'fix');
let fixOpenedHere = false;
function openFix() {
  fixOpenedHere = true;
  router.push({ query: { info: 'fix' } });
}
const closeFix = () => (fixOpenedHere ? router.back() : router.replace({ query: {} }));

// Any of a combined film's keys opens it. A saved film that has left the
// schedule still opens, from its saved snapshot.
const current = computed(() => filmByKey.value.get(props.filmKey));
const passedSave = computed(() => (current.value ? undefined : savedByKey(props.filmKey)));
const film = computed(
  () => current.value ?? (passedSave.value ? savedAsFilm(passedSave.value) : null),
);
const theatreName = (id: string) => theatreOf(id)?.name ?? 'the theatre';
/** Tag each showing with its theatre when the film is on at more than one. */
const severalTheatres = computed(() => (film.value?.theatres.length ?? 0) > 1);

// The 16:9 banner: TMDB's backdrop (a still from the film) when there is one,
// else the theatre's own wide still, else a poster or square image shown whole.
const banner = computed(() => {
  const current = film.value;
  if (!current) return null;
  if (current.backdrop) return current.backdrop;
  if (current.image && (current.imageAspect ?? 1) >= 1.2) return current;
  return current.poster ?? current;
});
const tall = computed(() => (banner.value?.imageAspect ?? 1) < 0.9);

function onStar() {
  if (!film.value) return;
  if (isSaved(film.value)) unsave(film.value);
  else toggleSaved(film.value);
}
</script>

<template>
  <div class="-mx-4">
    <!-- The banner and its Back/Fix/Save buttons stay at the top; the details scroll
         underneath (only matters once the page is taller than the screen). Sticky
         rather than position: fixed, which would be thrown off by the page's slide-in
         transform. The buttons' row ignores taps between the buttons. -->
    <div class="sticky top-0 z-10">
      <!-- Wide and square images fill the 16:9 banner (squares lose a little top and
           bottom); tall posters would lose most of themselves, so they're shown
           whole over a blurred copy instead. -->
      <div class="relative overflow-hidden bg-imgbg">
        <template v-if="film && banner?.image">
          <img
            v-if="tall"
            :src="banner.image"
            alt=""
            aria-hidden="true"
            class="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-xl"
          />
          <img
            :src="banner.image"
            :srcset="banner.imageSrcset"
            sizes="(min-width: 768px) 768px, 100vw"
            :alt="film.title"
            class="fade-img relative aspect-video w-full"
            :class="tall ? 'object-contain' : 'object-cover'"
            @load="(event) => (event.target as HTMLElement).classList.add('loaded')"
          />
        </template>
        <div v-else class="aspect-video w-full bg-card" />
      </div>
      <div
        class="pointer-events-none absolute inset-x-0 top-0 flex justify-between px-3 pt-[max(env(safe-area-inset-top),12px)]"
      >
        <button
          class="pointer-events-auto flex items-center gap-1.5 rounded-full border-0 bg-black/60 py-2 pr-4 pl-3 text-white backdrop-blur"
          @click="goBack"
        >
          <svg
            viewBox="0 0 24 24"
            class="h-4 w-4"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5m6-6-6 6 6 6" />
          </svg>
          Back
        </button>
        <span class="flex gap-2">
          <button
            v-if="tmdbAvailable && film?.posterLookup"
            class="pointer-events-auto rounded-full border-0 bg-black/60 px-4 py-2 text-white backdrop-blur"
            aria-label="Fix the poster match"
            @click="openFix"
          >
            Fix
          </button>
          <button
            v-if="film"
            class="pointer-events-auto flex items-center gap-1.5 rounded-full border-0 bg-black/60 py-2 pr-4 pl-3 backdrop-blur transition-colors duration-200"
            :class="isSaved(film) ? 'text-accent' : 'text-white'"
            :aria-pressed="isSaved(film)"
            @click="onStar"
          >
            <span class="h-5 w-5"><StarIcon :filled="isSaved(film)" /></span>
            <span class="text-white">{{ isSaved(film) ? 'Saved' : 'Save' }}</span>
          </button>
        </span>
      </div>
    </div>

    <FixMatchModal
      v-if="film?.posterLookup"
      :open="fixOpen"
      :lookup="film.posterLookup"
      @close="closeFix"
    />

    <div v-if="film" class="px-4 pt-4">
      <p
        v-if="multiTheatre"
        class="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-2"
      >
        <span v-for="theatre in film.theatres" :key="theatre" class="flex items-center gap-2">
          <TheatreTag :theatre="theatre" />
          {{ theatreName(theatre) }}
        </span>
      </p>
      <h2 class="mb-1 text-[26px] leading-tight font-bold">{{ film.title }}</h2>
      <p v-if="film.meta?.length" class="mb-3 font-mono text-[12px] text-muted-1">
        {{ film.meta.join(' · ') }}
      </p>
      <div v-if="film.flags?.length" class="mb-4 flex flex-wrap gap-2">
        <span
          v-for="flag in film.flags"
          :key="flag"
          class="rounded bg-accent/15 px-2 py-0.5 text-[12px] font-medium text-accent"
        >
          {{ flag }}
        </span>
      </div>
      <p v-for="(paragraph, i) in film.synopsis" :key="i" class="leading-relaxed text-muted-2">
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
          :key="showtime.start + showtime.filmKey"
          class="flex items-center gap-3 px-3.5 py-3"
        >
          <TheatreTag v-if="severalTheatres" :theatre="showtime.theatre" />
          <span class="flex-1">
            <span class="font-medium">{{ formatDay(showtime.start) }}</span>
            <span class="ml-2 font-mono text-[13px] text-muted-2">{{
              formatTime(showtime.start)
            }}</span>
          </span>
          <span v-if="showtime.soldOut" class="font-mono text-[11px] text-error">Sold out</span>
          <template v-else>
            <span
              v-if="showtime.seatsLeft !== undefined"
              class="font-mono text-[11px]"
              :class="showtime.seatsLeft <= LOW_SEATS ? 'text-error' : 'text-muted-1'"
            >
              {{ showtime.seatsLeft }} seats
            </span>
            <span v-if="showtime.note" class="text-[13px] text-muted-2">{{ showtime.note }}</span>
            <a
              v-if="showtime.bookUrl"
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
        v-for="link in film.links"
        :key="link.theatre"
        :href="link.url"
        target="_blank"
        rel="noopener"
        class="mt-4 block text-[13px] text-accent"
      >
        View on {{ theatreName(link.theatre) }}'s site ↗
      </a>
    </div>
    <p v-else class="px-4 py-16 text-center text-muted-1">This film is no longer scheduled.</p>
  </div>
</template>
