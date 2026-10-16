<script setup lang="ts">
import { ref, watch } from 'vue';

import { onViewLeft, router, TABS, type Tab } from '../router';
import AppHeader from './AppHeader.vue';
import DayList from './DayList.vue';
import FilmList from './FilmList.vue';

const props = defineProps<{ tab: Tab }>();

// Slide toward the tab's side of the tab bar.
const direction = ref<'tab-next' | 'tab-prev'>('tab-next');
watch(
  () => props.tab,
  (next, prev) =>
    (direction.value = TABS.indexOf(next) > TABS.indexOf(prev) ? 'tab-next' : 'tab-prev'),
);

// Swipe left/right to move between tabs. Only a quick, clearly sideways swipe
// counts, so scrolling the posters never switches tabs by accident.
const SWIPE_MIN_PX = 60;
const SWIPE_MAX_MS = 600;
let touch: { x: number; y: number; at: number } | null = null;

function onTouchStart(event: TouchEvent) {
  touch =
    event.touches.length === 1
      ? { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() }
      : null;
}

function onTouchEnd(event: TouchEvent) {
  if (!touch) return;
  const dx = event.changedTouches[0].clientX - touch.x;
  const dy = event.changedTouches[0].clientY - touch.y;
  const quick = Date.now() - touch.at < SWIPE_MAX_MS;
  touch = null;
  if (!quick || Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 2) return;
  const next = TABS[TABS.indexOf(props.tab) + (dx < 0 ? 1 : -1)];
  if (next) router.replace(`/${next}`);
}
</script>

<template>
  <div
    class="flex flex-1 flex-col"
    @touchstart.passive="onTouchStart"
    @touchend.passive="onTouchEnd"
  >
    <AppHeader :tab="tab" />
    <Transition :name="direction" mode="out-in" @after-leave="onViewLeft">
      <div :key="tab" class="pb-8">
        <FilmList v-if="tab === 'saved'" saved-only />
        <FilmList v-else-if="tab === 'films'" />
        <DayList v-else />
      </div>
    </Transition>
  </div>
</template>
