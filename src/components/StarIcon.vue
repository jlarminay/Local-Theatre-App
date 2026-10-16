<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{ filled: boolean }>();

// A small pop whenever it's toggled (not on first render).
const popping = ref(false);
watch(
  () => props.filled,
  () => {
    popping.value = false;
    requestAnimationFrame(() => (popping.value = true));
  },
);
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    class="h-full w-full"
    :class="popping && 'star-pop'"
    @animationend="popping = false"
  >
    <path
      d="M12 2.8l2.84 5.76 6.36.92-4.6 4.48 1.09 6.33L12 17.3l-5.69 2.99 1.09-6.33-4.6-4.48 6.36-.92z"
      :fill="filled ? 'currentColor' : 'none'"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linejoin="round"
    />
  </svg>
</template>
