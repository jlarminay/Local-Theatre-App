<script setup lang="ts">
import { useSaved } from '../composables/useSaved';
import type { Film } from '../composables/useSchedule';
import { openFilm } from '../router';
import StarIcon from './StarIcon.vue';

defineProps<{ films: Film[]; faded?: boolean }>();

const { isSaved, toggleSaved, unsave } = useSaved();

// Films off the schedule can only be unsaved, by id.
const onStar = (film: Film) => (isSaved(film.id) ? unsave(film.id) : toggleSaved(film));

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
</script>

<template>
  <TransitionGroup
    tag="ul"
    name="poster"
    class="relative m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3"
    @before-leave="pinInPlace"
  >
    <li v-for="film in films" :key="film.id" class="relative">
      <button
        class="relative block w-full overflow-hidden rounded-lg border-0 bg-imgbg p-0"
        :class="faded && 'opacity-50 grayscale'"
        :aria-label="film.title"
        @click="openFilm(film.id)"
      >
        <img
          v-if="film.details?.image"
          :src="film.details.image"
          :srcset="film.details.imageSrcset ?? undefined"
          sizes="(min-width: 640px) 33vw, 50vw"
          :alt="film.title"
          loading="lazy"
          class="fade-img block aspect-square w-full object-contain"
          @load="markLoaded"
        />
        <div
          v-else
          class="grid aspect-square w-full place-items-center p-3 text-center font-display text-2xl text-muted-2"
        >
          {{ film.title }}
        </div>
        <span
          v-if="film.isNew"
          class="absolute top-1.5 left-1.5 rounded bg-accent px-1.5 py-0.5 font-display text-sm leading-tight text-white"
        >
          New
        </span>
      </button>
      <!-- A sibling of the poster button, not inside it: buttons can't nest. -->
      <button
        class="absolute top-1 right-1 h-9 w-9 rounded-full border-0 bg-black/55 p-2 transition-colors duration-200"
        :class="isSaved(film.id) ? 'text-accent' : 'text-white'"
        :aria-label="isSaved(film.id) ? `Unsave ${film.title}` : `Save ${film.title}`"
        :aria-pressed="isSaved(film.id)"
        @click="onStar(film)"
      >
        <StarIcon :filled="isSaved(film.id)" />
      </button>
    </li>
  </TransitionGroup>
</template>
