<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useNow } from '../composables/useNow';
import { useSchedule } from '../composables/useSchedule';
import { timeAgo } from '../lib/format';
import type { Tab } from '../router';
import RefreshModal from './RefreshModal.vue';
import TheatreFilter from './TheatreFilter.vue';

const { updatedAt, loading, error } = useSchedule();
const now = useNow();
defineProps<{ tab: Tab }>();

// The status opens the update window. A query param (?info=refresh), like the
// other modals, so Android's Back closes it.
const route = useRoute();
const router = useRouter();
const refreshOpen = computed(() => route.query.info === 'refresh');
let openedHere = false;
function openRefresh() {
  openedHere = true;
  router.push({ query: { info: 'refresh' } });
}
const closeRefresh = () => (openedHere ? router.back() : router.replace({ query: {} }));

const tabs: { id: Tab; label: string }[] = [
  { id: 'saved', label: 'Saved' },
  { id: 'films', label: 'Films' },
  { id: 'days', label: 'By day' },
];
</script>

<template>
  <header
    class="sticky top-0 z-10 -mx-4 border-b border-border-1 bg-paper/95 px-4 pt-[max(env(safe-area-inset-top),14px)] backdrop-blur"
  >
    <div class="flex items-center justify-between gap-3 pb-2">
      <div class="flex items-center gap-3">
        <h1 class="m-0 -mb-1 font-display text-[32px] leading-none tracking-wide whitespace-nowrap">
          Local Theatre
        </h1>
      </div>
      <div class="flex items-center gap-2">
        <!-- Opens the update window: live progress, or how the last update went. -->
        <button
          class="m-0 flex items-center gap-1 rounded-full border border-border-2 bg-card px-2.5 py-1 font-mono text-[11px] whitespace-nowrap text-muted-1"
          aria-label="Update details"
          @click="openRefresh"
        >
          <span
            v-if="loading"
            class="inline-block animate-[spin_2.5s_linear_infinite]"
            aria-hidden="true"
            >↻</span
          >
          {{
            loading ? 'Updating…' : updatedAt ? `Updated ${timeAgo(updatedAt, now)}` : 'Not updated'
          }}
        </button>
        <RouterLink
          to="/settings"
          aria-label="Settings"
          class="grid h-9 w-9 place-items-center rounded-full border border-border-2 bg-card text-muted-2 transition-colors duration-200 active:border-accent active:text-accent"
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            class="h-4.5 w-4.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              stroke-linejoin="round"
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
        </RouterLink>
      </div>
    </div>
    <nav class="flex items-start gap-5">
      <!-- replace: switching tabs shouldn't stack up history for the Back button. -->
      <RouterLink
        v-for="t in tabs"
        :key="t.id"
        :to="`/${t.id}`"
        replace
        class="border-b-3 pb-2 text-[15px] font-medium text-ink no-underline transition-[border-color,opacity] duration-200"
        :class="tab === t.id ? 'border-accent' : 'border-transparent opacity-60'"
      >
        {{ t.label }}
      </RouterLink>
      <!-- Saved shows every theatre's saves, so the filter is only for the lineup tabs. -->
      <TheatreFilter v-if="tab !== 'saved'" class="ml-auto" />
    </nav>
  </header>
  <RefreshModal :open="refreshOpen" @close="closeRefresh" />
  <p v-if="error" class="mt-3 rounded-lg bg-error/10 p-3 text-sm whitespace-pre-line text-error">
    {{ error }}
  </p>
</template>
