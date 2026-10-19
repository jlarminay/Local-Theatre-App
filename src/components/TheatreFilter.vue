<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

import { useTheatreFilter } from '../composables/useTheatreFilter';

// The theatre dropdown at the right of the tab row: a multi-select with
// All/None at the top. Closes on an outside tap or Escape.

const { options, label, allShown, shownCount, toggle, toggleAll } = useTheatreFilter();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

function onPointerDown(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false;
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false;
}
function stopListening() {
  document.removeEventListener('pointerdown', onPointerDown);
  document.removeEventListener('keydown', onKey);
}
watch(open, (isOpen) => {
  if (!isOpen) return stopListening();
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(stopListening);
</script>

<template>
  <div v-if="options.length" ref="root" class="relative self-start">
    <button
      class="flex items-center gap-1.5 rounded-full border bg-transparent py-1 pr-2 pl-3 text-[13px] whitespace-nowrap transition-colors duration-200"
      :class="allShown ? 'border-border-2 text-muted-2' : 'border-accent text-ink'"
      :aria-expanded="open"
      aria-haspopup="true"
      @click="open = !open"
    >
      {{ label }}
      <svg
        viewBox="0 0 24 24"
        class="h-4 w-4 transition-transform duration-200"
        :class="open && 'rotate-180'"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <Transition name="pop-menu">
      <div
        v-if="open"
        class="absolute top-full right-0 z-20 mt-1.5 w-60 overflow-hidden rounded-xl border border-border-2 bg-card py-1 shadow-xl"
        role="group"
        aria-label="Theatres to show"
      >
        <button class="filter-row border-b border-border-1" @click="toggleAll">
          <span
            class="checkbox"
            :class="allShown ? 'checked' : shownCount ? 'partial' : ''"
            aria-hidden="true"
          />
          <span class="flex-1 text-left font-medium">All / None</span>
        </button>
        <button
          v-for="option in options"
          :key="option.id"
          class="filter-row"
          role="checkbox"
          :aria-checked="option.shown"
          @click="toggle(option.id)"
        >
          <span class="checkbox" :class="option.shown && 'checked'" aria-hidden="true" />
          <span
            class="h-2.5 w-2.5 shrink-0 rounded-full"
            :style="{ backgroundColor: option.color }"
          />
          <span class="min-w-0 flex-1 truncate text-left">{{ option.name }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.filter-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.625rem;
  border-left: 0;
  border-right: 0;
  border-top: 0;
  background: transparent;
  padding: 0.625rem 0.875rem;
  color: var(--color-ink);
  font-size: 14px;
}
.filter-row:not(.border-b) {
  border-bottom: 0;
}
.filter-row:active {
  background: var(--color-border-1);
}
.checkbox {
  position: relative;
  flex-shrink: 0;
  width: 1.125rem;
  height: 1.125rem;
  border: 1.5px solid var(--color-muted-1);
  border-radius: 0.3rem;
}
.checkbox.checked,
.checkbox.partial {
  border-color: var(--color-accent);
  background: var(--color-accent);
}
/* A tick when checked, a dash when only some are. */
.checkbox.checked::after {
  content: '';
  position: absolute;
  left: 0.3rem;
  top: 0.08rem;
  width: 0.3rem;
  height: 0.6rem;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.checkbox.partial::after {
  content: '';
  position: absolute;
  left: 0.2rem;
  right: 0.2rem;
  top: calc(50% - 1px);
  height: 2px;
  background: white;
}
.pop-menu-enter-active,
.pop-menu-leave-active {
  transition:
    opacity 0.15s,
    transform 0.15s;
}
.pop-menu-enter-from,
.pop-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
