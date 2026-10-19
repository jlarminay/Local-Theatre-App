<script setup lang="ts">
import { computed, ref } from 'vue';

import { useNow } from '../composables/useNow';
import { useSchedule } from '../composables/useSchedule';
import type { TheatreProgress } from '../host/host';
import { formatDateTime, timeAgo } from '../lib/format';
import BaseModal from './BaseModal.vue';
import TheatreTag from './TheatreTag.vue';

// The header's "Updating… / Updated …" opens this: a refresh in the app (on
// opening, or Refresh now) as it happens, one line per theatre; or, before
// any this session, how each theatre's last run went. Background checks
// aren't shown live.

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { progress, loading, enabledTheatres, updatedAt, refresh } = useSchedule();
const now = useNow(1000);

/** "32s", "1m 05s" */
function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 90 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

const running = computed(() => Boolean(progress.value && !progress.value.finishedAt));

/** Right of the name: "5/12 · 22s" while running, the time taken once done. */
function counter(line: TheatreProgress): string {
  if (!line.startedAt) return '';
  const took = duration((line.finishedAt ?? now.value) - line.startedAt);
  const count = line.state === 'running' && line.total ? `${line.done ?? 0}/${line.total} · ` : '';
  return count + took;
}

// Tap a theatre to see every step (newest last).
const expanded = ref<Set<string>>(new Set());
function toggle(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}
// Collapsed, at most three lines: all of them, or "…" and the newest two.
// (steps may be missing from progress saved by an older version)
const shownSteps = (line: TheatreProgress) => {
  const steps = line.steps ?? [];
  return expanded.value.has(line.id) || steps.length <= 3 ? steps : steps.slice(-2);
};
const hasEarlier = (line: TheatreProgress) =>
  !expanded.value.has(line.id) && (line.steps?.length ?? 0) > 3;
/** "+12s": when a step happened, from the theatre's start. */
const stepTime = (line: TheatreProgress, at: number) => `+${duration(at - (line.startedAt ?? at))}`;

/** Before any refresh this session: each enabled theatre's last run. */
const lastRuns = computed(() =>
  enabledTheatres.value.map(({ manifest, lastRun, films }) => ({
    id: manifest.id,
    name: manifest.name,
    error: lastRun && !lastRun.ok,
    text: !lastRun
      ? 'Not run yet'
      : lastRun.ok
        ? `${timeAgo(lastRun.at, now.value)} · ${films.length} films · ${duration(lastRun.ms)}` +
          (lastRun.mode === 'background' ? ' · background check' : '')
        : `${lastRun.error ?? 'Failed'} · ${timeAgo(lastRun.at, now.value)}`,
  })),
);
</script>

<template>
  <BaseModal :open="open" :title="running ? 'Updating' : 'Updates'" @close="emit('close')">
    <div class="flex flex-col gap-4 text-[13px] text-muted-2">
      <p class="m-0">
        <template v-if="progress && running">
          Started {{ formatDateTime(progress.startedAt) }} ({{ duration(now - progress.startedAt) }}
          ago)
        </template>
        <template v-else-if="progress?.finishedAt">
          Finished {{ formatDateTime(progress.finishedAt) }} · took
          {{ duration(progress.finishedAt - progress.startedAt) }}
        </template>
        <template v-else-if="updatedAt">
          Last updated {{ formatDateTime(updatedAt) }} ({{ timeAgo(updatedAt, now) }})
        </template>
        <template v-else>Not updated yet.</template>
      </p>

      <ul v-if="progress" class="m-0 flex list-none flex-col gap-2 p-0">
        <li v-for="line in progress.theatres" :key="line.id" class="min-w-0">
          <button
            class="w-full min-w-0 overflow-hidden rounded-lg border-0 bg-transparent p-1.5 text-left text-muted-2 active:bg-border-1"
            :aria-expanded="expanded.has(line.id)"
            @click="toggle(line.id)"
          >
            <span class="flex items-center gap-2 text-[14px] text-ink">
              <TheatreTag :theatre="line.id" always />
              <span class="min-w-0 flex-1 truncate">{{ line.name }}</span>
              <span
                v-if="line.state === 'running'"
                class="inline-block animate-[spin_2.5s_linear_infinite] text-muted-1"
                aria-hidden="true"
                >↻</span
              >
              <span class="shrink-0 font-mono text-[12px] text-muted-1">{{ counter(line) }}</span>
            </span>
            <span
              v-if="line.state === 'running' && line.total"
              class="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-border-1"
              role="progressbar"
              :aria-valuenow="line.done ?? 0"
              :aria-valuemax="line.total"
            >
              <span
                class="block h-full rounded-full bg-accent transition-[width] duration-300"
                :style="{ width: `${(100 * (line.done ?? 0)) / line.total}%` }"
              />
            </span>
            <span v-if="line.state === 'waiting'" class="mt-1 block text-[12px]">Waiting</span>
            <span v-else class="mt-1 block text-[12px]">
              <span v-if="hasEarlier(line)" class="block text-muted-1" aria-label="Earlier steps"
                >…</span
              >
              <span
                v-for="(step, i) in shownSteps(line)"
                :key="i"
                class="flex gap-2"
                :class="{
                  'text-ink': i === shownSteps(line).length - 1 && line.state === 'running',
                  'text-error':
                    step.text.startsWith('Failed') || /unavailable|error/i.test(step.text),
                }"
              >
                <span v-if="expanded.has(line.id)" class="w-12 shrink-0 font-mono text-muted-1">{{
                  stepTime(line, step.at)
                }}</span>
                <span class="min-w-0 flex-1 truncate">{{ step.text }}</span>
              </span>
            </span>
          </button>
        </li>
      </ul>

      <ul v-else class="m-0 flex list-none flex-col gap-3 p-0">
        <li v-for="line in lastRuns" :key="line.id">
          <p class="m-0 flex items-center gap-2 text-[14px] text-ink">
            <TheatreTag :theatre="line.id" always />
            {{ line.name }}
          </p>
          <p class="mt-0.5 mb-0" :class="line.error ? 'text-error' : ''">{{ line.text }}</p>
        </li>
      </ul>
    </div>

    <template #actions>
      <div class="flex gap-2">
        <button
          class="flex-1 rounded-lg border border-border-2 bg-transparent py-2.5 text-[14px] text-ink"
          @click="emit('close')"
        >
          Close
        </button>
        <button
          class="flex-1 rounded-lg border-0 bg-accent py-2.5 text-[14px] font-medium text-white disabled:opacity-50"
          :disabled="loading"
          @click="refresh"
        >
          {{ loading ? 'Updating…' : 'Refresh now' }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>
