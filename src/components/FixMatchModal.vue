<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { usePosters, type Lookup } from '../composables/usePosters';
import { posterThumb, type TmdbMovie } from '../lib/tmdb';
import BaseModal from './BaseModal.vue';

// The film page's Fix: search TMDB and pick the right film by hand when the
// automatic match is wrong. The choice is kept on the device and never looked
// up again (see usePosters).

const props = defineProps<{ open: boolean; lookup: Lookup }>();
const emit = defineEmits<{ close: [] }>();

const { firstQuery, searchForFix, matchOf, setMatch, clearMatch } = usePosters();

const query = ref('');
const results = ref<TmdbMovie[]>([]);
const searching = ref(false);
const error = ref('');
const match = computed(() => matchOf(props.lookup));

async function search() {
  if (!query.value.trim()) return;
  searching.value = true;
  error.value = '';
  try {
    results.value = await searchForFix(query.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    results.value = [];
  } finally {
    searching.value = false;
  }
}

// Each time it opens: start from what the automatic lookup searched for.
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    query.value = firstQuery(props.lookup);
    results.value = [];
    search();
  },
  { immediate: true },
);

const year = (movie: TmdbMovie) => movie.release_date?.slice(0, 4) || '';

function choose(movie: TmdbMovie | null) {
  setMatch(props.lookup, movie);
  emit('close');
}

function automatic() {
  clearMatch(props.lookup);
  emit('close');
}
</script>

<template>
  <BaseModal :open="open" title="Fix the match" @close="emit('close')">
    <div class="flex flex-col gap-3 text-[13px] text-muted-2">
      <form class="flex gap-2" @submit.prevent="search">
        <input
          v-model="query"
          type="search"
          aria-label="Search The Movie Database"
          class="min-w-0 flex-1 rounded-lg border border-border-2 bg-paper px-3 py-2 text-[14px] text-ink"
        />
        <button
          type="submit"
          class="rounded-lg border border-border-2 bg-transparent px-3 text-[13px] text-ink disabled:opacity-50"
          :disabled="searching || !query.trim()"
        >
          {{ searching ? '…' : 'Search' }}
        </button>
      </form>

      <p v-if="error" class="m-0 text-error">{{ error }}</p>
      <p v-else-if="!searching && !results.length" class="m-0">
        No films with posters found. Try fewer words, or the original title.
      </p>

      <ul class="m-0 flex list-none flex-col gap-1 p-0">
        <li v-for="movie in results" :key="movie.id">
          <button
            class="flex w-full items-center gap-3 rounded-lg border-0 bg-transparent p-1.5 text-left text-ink active:bg-border-1"
            @click="choose(movie)"
          >
            <img
              :src="posterThumb(movie.poster_path!)"
              alt=""
              class="h-[69px] w-[46px] shrink-0 rounded bg-imgbg object-cover"
              loading="lazy"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[14px] font-medium">{{ movie.title }}</span>
              <span class="block text-[12px] text-muted-1">
                {{ year(movie) || 'Year unknown'
                }}<template v-if="movie.original_title && movie.original_title !== movie.title">
                  · {{ movie.original_title }}</template
                >
              </span>
            </span>
            <span
              v-if="match?.path && match.path === movie.poster_path"
              class="shrink-0 rounded bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent"
            >
              Current
            </span>
          </button>
        </li>
      </ul>

      <div class="flex flex-col items-start gap-2 border-t border-border-1 pt-3">
        <button class="border-0 bg-transparent p-0 text-[13px] text-accent" @click="choose(null)">
          Use the theatre's image
        </button>
        <button
          v-if="match?.manual"
          class="border-0 bg-transparent p-0 text-[13px] text-accent"
          @click="automatic"
        >
          Back to automatic
        </button>
      </div>
    </div>
    <template #close>Cancel</template>
  </BaseModal>
</template>
