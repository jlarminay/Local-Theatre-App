<script setup lang="ts">
// Centered card over a dimmed backdrop. Closes via the button or a tap outside;
// long content scrolls inside the card, which never outgrows the screen
// (its max height is tied to the viewport, matching the backdrop's py-10).
defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        class="fixed inset-0 z-50 grid place-items-center bg-black/60 px-6 py-10 backdrop-blur-sm"
        @click.self="emit('close')"
      >
        <div
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          class="modal-card flex max-h-[calc(100dvh-5rem)] w-full max-w-sm flex-col rounded-2xl border border-border-1 bg-card shadow-xl"
        >
          <h2
            class="m-0 px-5 pt-5 pb-3 font-display text-[24px] leading-none tracking-wide text-accent"
          >
            {{ title }}
          </h2>
          <div class="min-h-0 overflow-y-auto px-5">
            <slot />
          </div>
          <div class="p-5 pt-4">
            <button
              class="w-full rounded-lg border-0 bg-accent py-2.5 text-[14px] font-medium text-white"
              @click="emit('close')"
            >
              <slot name="close">Close</slot>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
