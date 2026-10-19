<script setup lang="ts">
// Centered card over a dimmed backdrop. Closes via the button or a tap outside;
// long content scrolls inside the card. The backdrop's padding clears the
// status bar and navigation bar (the app draws behind both), and the card never
// grows past it: not taller (max-h-full), and not wider than the side margins,
// even with long unbroken text (min-w-0, overflow-wrap).
defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="open"
        class="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm"
        @click.self="emit('close')"
      >
        <div
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          class="modal-card flex max-h-full w-full max-w-sm min-w-0 flex-col rounded-2xl border border-border-1 bg-card shadow-xl"
        >
          <h2
            class="m-0 px-5 pt-5 pb-3 font-display text-[24px] leading-none tracking-wide text-accent"
          >
            {{ title }}
          </h2>
          <div class="min-h-0 overflow-y-auto px-5 [overflow-wrap:anywhere]">
            <slot />
          </div>
          <div class="p-5 pt-4">
            <!-- #actions replaces the single close button (e.g. Save + Cancel). -->
            <slot name="actions">
              <button
                class="w-full rounded-lg border-0 bg-accent py-2.5 text-[14px] font-medium text-white"
                @click="emit('close')"
              >
                <slot name="close">Close</slot>
              </button>
            </slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  padding-top: calc(max(env(safe-area-inset-top), var(--safe-area-inset-top, 0px)) + 24px);
  padding-bottom: calc(max(env(safe-area-inset-bottom), var(--safe-area-inset-bottom, 0px)) + 24px);
}
</style>
