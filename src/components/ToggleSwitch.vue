<script setup lang="ts">
// An on/off switch, as used in Settings.
defineProps<{ on: boolean; label: string; disabled?: boolean }>();
defineEmits<{ toggle: [] }>();
</script>

<template>
  <button
    role="switch"
    :aria-checked="on"
    :aria-label="label"
    :disabled="disabled"
    class="relative h-6 w-11 shrink-0 rounded-full border-0 p-0 transition-colors duration-200 disabled:opacity-50"
    :class="on ? 'bg-accent' : 'bg-border-2'"
    @click="$emit('toggle')"
  >
    <span
      class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
      :class="on && 'translate-x-5'"
    />
  </button>
</template>
