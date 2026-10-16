<script setup lang="ts">
import { onMounted } from 'vue';

import { useSchedule } from './composables/useSchedule';
import { ensureNotificationPermission } from './lib/watch';
import { onViewLeft } from './router';

const { refreshOnLaunch } = useSchedule();

onMounted(() => {
  refreshOnLaunch();
  ensureNotificationPermission().catch((err) =>
    console.warn('Notification permission request failed', err),
  );
});
</script>

<template>
  <main class="pb-safe mx-auto flex min-h-dvh max-w-3xl flex-col px-4">
    <!-- Keyed by route record, not path: switching tabs reuses TabsPage (which
         animates its own content), while opening/closing a film swaps pages. -->
    <RouterView v-slot="{ Component, route }">
      <Transition :name="route.meta.depth ? 'push' : 'pop'" mode="out-in" @after-leave="onViewLeft">
        <component :is="Component" :key="route.matched[0]?.path" />
      </Transition>
    </RouterView>
  </main>
</template>
