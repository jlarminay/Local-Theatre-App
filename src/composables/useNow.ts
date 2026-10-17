import { onUnmounted, ref } from 'vue';

// The current time as a ref, ticking every `intervalMs`, so relative labels like
// "Updated 5 min ago" stay current while the screen is open. Also ticks when the
// app comes back to the foreground, since timers pause in the background.
export function useNow(intervalMs = 60_000) {
  const now = ref(Date.now());
  const tick = () => (now.value = Date.now());
  const timer = setInterval(tick, intervalMs);
  const onVisible = () => document.visibilityState === 'visible' && tick();
  document.addEventListener('visibilitychange', onVisible);
  onUnmounted(() => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  });
  return now;
}
