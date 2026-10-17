<script setup lang="ts">
// The small circled "i" beside a section heading; opens that section's explainer.
defineProps<{ label: string }>();
</script>

<template>
  <button
    class="grid h-5 w-5 place-items-center rounded-full border border-muted-1 bg-transparent p-0 font-serif text-[12px] leading-none tracking-normal text-muted-1 italic"
    :aria-label="label"
  >
    i
  </button>
</template>
