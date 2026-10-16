<script setup lang="ts">
import { Capacitor } from '@capacitor/core';
import { marked } from 'marked';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import changelogMarkdown from '../../CHANGELOG.md?raw';
import { useSaved } from '../composables/useSaved';
import { AUTO_REFRESH_MIN_MS, useSchedule } from '../composables/useSchedule';
import { formatDateTime, timeAgo } from '../lib/format';
import { CALENDAR_URL, SITE } from '../lib/schedule';
import {
  alertsEnabled,
  CHECK_INTERVAL_MINUTES,
  checkNow,
  ensureNotificationPermission,
  notificationPermission,
  testNotification,
  type NotificationPermission,
} from '../lib/watch';
import { goBack } from '../router';
import BaseModal from './BaseModal.vue';

const { films, upcoming, updatedAt, lastCheck, loading, refresh, clearCache } = useSchedule();
const { saved } = useSaved();

const native = Capacitor.isNativePlatform();
const autoRefreshHours = AUTO_REFRESH_MIN_MS / 3_600_000;
const autoRefreshLimit =
  autoRefreshHours === 1 ? 'once an hour' : `once every ${autoRefreshHours} hours`;
const version = __APP_VERSION__;
const buildTime = __BUILD_TIME__;

const permission = ref<NotificationPermission>('unavailable');
const permissionLabel = computed(
  () =>
    ({ granted: 'Allowed', denied: 'Blocked', prompt: 'Not asked yet', unavailable: 'App only' })[
      permission.value
    ],
);

async function readPermission() {
  try {
    permission.value = await notificationPermission();
  } catch {
    permission.value = 'unavailable';
  }
}
onMounted(readPermission);

// New-film alerts on/off (the runner keeps checking either way, it just stays quiet).
const alerts = ref(true);
onMounted(async () => {
  try {
    alerts.value = await alertsEnabled();
  } catch {
    // runner unavailable — show the default
  }
});

async function toggleAlerts() {
  const next = !alerts.value;
  alerts.value = next;
  try {
    alerts.value = await alertsEnabled(next);
  } catch (err) {
    alerts.value = !next;
    message.value = `Failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Modals are a query param (?info=…), so Android's Back closes them.
const route = useRoute();
const router = useRouter();
type Modal = 'alerts' | 'changelog';
const openModal = computed(() => route.query.info as Modal | undefined);
let openedHere = false;
function openInfo(modal: Modal) {
  openedHere = true;
  router.push({ query: { info: modal } });
}
// Back undoes our own push; after a reload with it open, just drop the query.
const closeInfo = () => (openedHere ? router.back() : router.replace({ query: {} }));

// CHANGELOG.md is bundled at build time; it's our own file, so rendering it as HTML is safe.
const changelogHtml = marked.parse(changelogMarkdown, { async: false });

// One status line under the buttons, for whichever action ran last.
const message = ref('');
const busy = ref(false);

async function run(action: () => Promise<string>) {
  busy.value = true;
  message.value = '';
  try {
    message.value = await action();
  } catch (err) {
    message.value = `Failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    busy.value = false;
  }
}

const onCheck = () =>
  run(async () => {
    lastCheck.value = await checkNow();
    return lastCheck.value.newTitles.length
      ? `New: ${lastCheck.value.newTitles.join(', ')}`
      : 'No new films.';
  });

const onTest = () =>
  run(async () => {
    // Any current film makes a realistic example.
    const example =
      films.value[Math.floor(Math.random() * films.value.length)]?.title ?? 'A new film';
    await testNotification([example]);
    return `Sent a sample alert for "${example}" — check your notifications.`;
  });

const onAllow = () =>
  run(async () => {
    const granted = await ensureNotificationPermission();
    await readPermission();
    // Once blocked, Android stops showing the prompt; only system settings can undo it.
    return granted
      ? 'Notifications allowed.'
      : 'Still blocked — allow them in Android Settings → Apps → Vic Theatre.';
  });

const onClear = () =>
  run(async () => {
    await clearCache();
    return 'Schedule re-downloaded.';
  });
</script>

<template>
  <div class="-mx-4 flex flex-1 flex-col">
    <header
      class="sticky top-0 z-10 flex items-center gap-3 border-b border-border-1 bg-paper/95 px-4 pt-[max(env(safe-area-inset-top),14px)] pb-3 backdrop-blur"
    >
      <button
        class="rounded-full border border-border-2 bg-transparent px-4 py-1.5 text-ink"
        @click="goBack"
      >
        ← Back
      </button>
      <h1 class="m-0 font-display text-[32px] leading-none tracking-wide">Settings</h1>
    </header>

    <div class="flex flex-col gap-6 px-4 pt-5 pb-4">
      <section>
        <h2 class="mb-2 font-display text-[22px] leading-none tracking-wide text-accent">
          Schedule
        </h2>
        <dl class="settings-list">
          <div>
            <dt>Last updated</dt>
            <dd>
              {{ updatedAt ? `${formatDateTime(updatedAt)} (${timeAgo(updatedAt)})` : 'Never' }}
            </dd>
          </div>
          <div>
            <dt>Auto refresh</dt>
            <dd>On opening the app, at most {{ autoRefreshLimit }}</dd>
          </div>
          <div>
            <dt>Listed</dt>
            <dd>{{ films.length }} films · {{ upcoming.length }} showings</dd>
          </div>
          <div>
            <dt>Saved</dt>
            <dd>{{ Object.keys(saved).length }} films</dd>
          </div>
        </dl>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="settings-button" :disabled="loading || busy" @click="refresh">
            {{ loading ? 'Updating…' : 'Refresh now' }}
          </button>
          <button class="settings-button" :disabled="loading || busy" @click="onClear">
            Clear cached schedule
          </button>
        </div>
      </section>

      <section>
        <h2
          class="mb-2 flex items-center gap-2 font-display text-[22px] leading-none tracking-wide text-accent"
        >
          New film alerts
          <button
            class="grid h-5 w-5 place-items-center rounded-full border border-muted-1 bg-transparent p-0 font-serif text-[12px] leading-none tracking-normal text-muted-1 italic"
            aria-label="How new film alerts work"
            @click="openInfo('alerts')"
          >
            i
          </button>
        </h2>
        <dl class="settings-list">
          <div class="items-center">
            <dt>Alerts</dt>
            <dd class="flex flex-1 items-center justify-between gap-3">
              {{ alerts ? 'On' : 'Off' }}
              <button
                role="switch"
                :aria-checked="alerts"
                aria-label="New film alerts"
                class="relative h-6 w-11 shrink-0 rounded-full border-0 p-0 transition-colors duration-200"
                :class="alerts ? 'bg-accent' : 'bg-border-2'"
                @click="toggleAlerts"
              >
                <span
                  class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200"
                  :class="alerts && 'translate-x-5'"
                />
              </button>
            </dd>
          </div>
          <div>
            <dt>Background check</dt>
            <dd>About every {{ CHECK_INTERVAL_MINUTES / 60 }} hours</dd>
          </div>
          <div>
            <dt>Last check</dt>
            <dd>
              <template v-if="lastCheck">
                {{ formatDateTime(lastCheck.at) }} · {{ lastCheck.ok ? 'OK' : 'Failed' }}
                <span v-if="lastCheck.newTitles.length" class="block text-muted-1">
                  Found: {{ lastCheck.newTitles.join(', ') }}
                </span>
                <span v-if="lastCheck.error" class="block text-error">{{ lastCheck.error }}</span>
              </template>
              <template v-else>Not yet</template>
            </dd>
          </div>
          <div>
            <dt>Notifications</dt>
            <dd :class="permission === 'denied' && 'text-error'">{{ permissionLabel }}</dd>
          </div>
        </dl>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="settings-button" :disabled="busy" @click="onCheck">Force check now</button>
          <button class="settings-button" :disabled="busy" @click="onTest">
            Test notification
          </button>
          <button
            v-if="native && permission !== 'granted'"
            class="settings-button"
            :disabled="busy"
            @click="onAllow"
          >
            Allow notifications
          </button>
        </div>
      </section>

      <p v-if="message" class="m-0 rounded-lg bg-card px-3.5 py-3 text-[13px] text-muted-2">
        {{ message }}
      </p>

      <section>
        <h2 class="mb-2 font-display text-[22px] leading-none tracking-wide text-accent">About</h2>
        <dl class="settings-list">
          <div>
            <dt>Version</dt>
            <dd>{{ version }}</dd>
          </div>
          <div>
            <dt>Built</dt>
            <dd>{{ formatDateTime(buildTime) }}</dd>
          </div>
          <div>
            <dt>Changelog</dt>
            <dd>
              <button
                class="border-0 bg-transparent p-0 text-[13px] text-accent"
                @click="openInfo('changelog')"
              >
                What's new →
              </button>
            </dd>
          </div>
          <div>
            <dt>Data from</dt>
            <dd>
              <a :href="CALENDAR_URL" target="_blank" rel="noopener" class="text-accent"
                >The Vic's calendar ↗</a
              >
            </dd>
          </div>
          <div>
            <dt>Website</dt>
            <dd>
              <a :href="SITE" target="_blank" rel="noopener" class="text-accent"
                >victoriafilmfestival.com ↗</a
              >
            </dd>
          </div>
        </dl>
        <p class="mt-4 mb-0 text-[11px] leading-relaxed text-muted-1">
          This is an unofficial, personal project made for fun. It isn't affiliated with, endorsed
          by, or connected to the Vic Theatre or the Victoria Film Festival. All listings, images,
          logos and trademarks belong to the Victoria Film Festival and the respective film studios,
          distributors and rights holders. Showtimes and seat counts are read from their public
          website and may be out of date. Always check the official site before buying tickets.
        </p>
      </section>
    </div>
    <BaseModal :open="openModal === 'alerts'" title="How alerts work" @close="closeInfo">
      <ul class="m-0 flex list-none flex-col gap-2.5 p-0 text-[13px] leading-relaxed text-muted-2">
        <li>
          About every {{ CHECK_INTERVAL_MINUTES / 60 }} hours, the app checks the Vic's calendar in
          the background — even when it's closed — and notifies you when a film appears that you
          haven't seen before.
        </li>
        <li>
          Opening the app counts as seeing the current lineup, so you're only alerted about films
          added since.
        </li>
        <li>
          Turning alerts off keeps the checks running quietly, so switching back on won't announce
          everything added in the meantime.
        </li>
        <li>
          Android decides exactly when background work runs and may delay it to save battery. If
          alerts never arrive, set the app's battery usage to "Unrestricted".
        </li>
        <li>Alerts only work in the installed app — not in a browser.</li>
      </ul>
      <template #close>Got it</template>
    </BaseModal>

    <BaseModal :open="openModal === 'changelog'" title="Changelog" @close="closeInfo">
      <div class="changelog" v-html="changelogHtml" />
    </BaseModal>
  </div>
</template>

<style scoped>
.settings-list {
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--color-border-1);
  border-radius: 0.75rem;
  background: var(--color-card);
}
.settings-list > div {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem 1rem;
  padding: 0.75rem 0.875rem;
}
.settings-list > div + div {
  border-top: 1px solid var(--color-border-1);
}
.settings-list dt {
  flex-shrink: 0;
  width: 8.5rem;
  color: var(--color-muted-1);
  font-size: 13px;
}
.settings-list dd {
  margin: 0;
  min-width: 0;
  font-size: 13px;
}
.settings-button {
  border: 1px solid var(--color-border-2);
  border-radius: 0.5rem;
  background: transparent;
  padding: 0.5rem 0.875rem;
  color: var(--color-ink);
  font-size: 13px;
}
.settings-button:disabled {
  opacity: 0.5;
}
.changelog {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-muted-2);
}
/* The file's own "# CHANGELOG" heading duplicates the modal title. */
.changelog :deep(h1) {
  display: none;
}
.changelog :deep(h2) {
  margin: 1.1rem 0 0.4rem;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0;
  color: var(--color-ink);
}
.changelog :deep(h2:first-of-type) {
  margin-top: 0;
}
.changelog :deep(h3) {
  margin: 0.6rem 0 0.2rem;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-accent);
}
.changelog :deep(ul) {
  margin: 0 0 0.5rem;
  padding-left: 1.1rem;
}
.changelog :deep(li) {
  margin: 0.15rem 0;
}
.changelog :deep(p) {
  margin: 0 0 0.5rem;
}
.changelog :deep(a) {
  color: var(--color-accent);
}
.changelog :deep(code) {
  font-family: var(--font-mono);
  font-size: 12px;
}
</style>
