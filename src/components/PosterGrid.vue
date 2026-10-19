<script setup lang="ts">
import { useSaved } from '../composables/useSaved';
import type { Film } from '../composables/useSchedule';
import { openFilm } from '../router';
import StarIcon from './StarIcon.vue';
import TheatreTag from './TheatreTag.vue';

defineProps<{ films: Film[]; faded?: boolean }>();

const { isSaved, toggleSaved, unsave } = useSaved();

// Films off the schedule can only be unsaved.
const onStar = (film: Film) => (isSaved(film) ? unsave(film) : toggleSaved(film));

// A leaving poster is pinned where it was (absolute, same size) so the others
// can glide into its place while it fades.
function pinInPlace(el: Element) {
  const item = el as HTMLElement;
  Object.assign(item.style, {
    position: 'absolute',
    top: `${item.offsetTop}px`,
    left: `${item.offsetLeft}px`,
    width: `${item.offsetWidth}px`,
  });
}

const markLoaded = (event: Event) => (event.target as HTMLElement).classList.add('loaded');

/** What the tile shows: a movie-database poster when the film has one, else the theatre's image. */
const tile = (film: Film) => film.poster ?? film;

// Tiles are poster-shaped (2:3), since most films have a TMDB poster. Other
// shapes (a theatre's own square or wide images) are shown whole, over a
// blurred, zoomed copy of themselves that fills the rest of the tile. Unknown
// aspect is treated as not 2:3: the copy just sits hidden behind a poster.
// TMDB posters are nominally 2:3 but some are slightly off, so they're
// cropped to fill (object-cover) instead; theatres' own images never are.
const POSTER = 2 / 3;
const needsFill = (film: Film) => {
  const aspect = tile(film).imageAspect;
  return !aspect || Math.abs(aspect - POSTER) > 0.02;
};
</script>

<template>
  <TransitionGroup
    tag="ul"
    name="poster"
    class="relative m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3"
    @before-leave="pinInPlace"
  >
    <li v-for="film in films" :key="film.key" class="relative">
      <button
        class="relative block w-full overflow-hidden rounded-lg border-0 bg-imgbg p-0"
        :class="faded && 'opacity-50 grayscale'"
        :aria-label="film.title"
        @click="openFilm(film.key)"
      >
        <template v-if="tile(film).image">
          <img
            v-if="needsFill(film)"
            :src="tile(film).image"
            alt=""
            aria-hidden="true"
            loading="lazy"
            class="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-xl"
          />
          <img
            :src="tile(film).image"
            :srcset="tile(film).imageSrcset"
            sizes="(min-width: 640px) 33vw, 50vw"
            :alt="film.title"
            loading="lazy"
            class="fade-img relative block aspect-2/3 w-full"
            :class="film.poster ? 'object-cover' : 'object-contain'"
            @load="markLoaded"
          />
        </template>
        <div
          v-else
          class="grid aspect-2/3 w-full place-items-center p-3 text-center font-display text-2xl text-muted-2"
        >
          {{ film.title }}
        </div>
        <span
          v-if="film.isNew"
          class="absolute top-1.5 left-1.5 rounded bg-accent px-1.5 py-0.5 font-display text-sm leading-tight text-white"
        >
          New
        </span>
        <span class="absolute bottom-1.5 left-1.5 flex flex-wrap gap-1">
          <TheatreTag
            v-for="theatre in film.theatres"
            :key="theatre"
            :theatre="theatre"
            class="shadow"
          />
        </span>
      </button>
      <!-- A sibling of the poster button, not inside it: buttons can't nest. -->
      <button
        class="absolute top-1 right-1 h-9 w-9 rounded-full border-0 bg-black/55 p-2 transition-colors duration-200"
        :class="isSaved(film) ? 'text-accent' : 'text-white'"
        :aria-label="isSaved(film) ? `Unsave ${film.title}` : `Save ${film.title}`"
        :aria-pressed="isSaved(film)"
        @click="onStar(film)"
      >
        <StarIcon :filled="isSaved(film)" />
      </button>
    </li>
  </TransitionGroup>
</template>
