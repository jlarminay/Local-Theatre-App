<script setup lang="ts">
import { Capacitor } from '@capacitor/core';
import { marked } from 'marked';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import changelogMarkdown from '../../CHANGELOG.md?raw';
import { useNow } from '../composables/useNow';
import { useSaved } from '../composables/useSaved';
import { AUTO_REFRESH_MIN_MS, useSchedule } from '../composables/useSchedule';
import { CHECK_RATES, checkRateLabel, DEFAULT_CHECK_RATE, type CheckRate } from '../host/checks';
import { formatDate, formatDateTime, timeAgo } from '../lib/format';
import {
  alertsEnabled,
  checkNow,
  checkRate,
  ensureNotificationPermission,
  notificationPermission,
  testNotification,
  type NotificationPermission,
} from '../lib/watch';
import { goBack } from '../router';
import BaseModal from './BaseModal.vue';
import InfoButton from './InfoButton.vue';
import TheatreTag from './TheatreTag.vue';
import ToggleSwitch from './ToggleSwitch.vue';

const {
  films,
  upcoming,
  theatres,
  updatedAt,
  lastCheck,
  loading,
  refresh,
  syncState,
  clearCache,
  setTheatreEnabled,
  combineFilms,
  setCombineFilms,
} = useSchedule();
const { saved } = useSaved();

const native = Capacitor.isNativePlatform();
const now = useNow();
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

// How often the background check runs. Saved as soon as it's picked.
const rate = ref<CheckRate>(DEFAULT_CHECK_RATE);
onMounted(async () => {
  try {
    rate.value = await checkRate();
  } catch {
    // runner unavailable — show the default
  }
});

async function onRateChange(event: Event) {
  const previous = rate.value;
  const next = Number((event.target as HTMLSelectElement).value) as CheckRate;
  rate.value = next;
  try {
    rate.value = await checkRate(next);
  } catch (err) {
    rate.value = previous;
    message.value = `Failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** One line under a theatre's name: what it last returned, or why it failed. */
function theatreStatus(theatre: (typeof theatres.value)[number]) {
  const run = theatre.lastRun;
  if (run && !run.ok) return { error: true, text: run.error ?? 'Failed' };
  if (!theatre.updatedAt) return { error: false, text: theatre.enabled ? 'Not loaded yet' : 'Off' };
  return {
    error: false,
    text: `${theatre.films.length} films · updated ${timeAgo(theatre.updatedAt, now.value)}`,
  };
}

const onToggleTheatre = (id: string, on: boolean) =>
  run(async () => {
    await setTheatreEnabled(id, on);
    return '';
  });

// Modals are a query param (?info=…), so Android's Back closes them.
const route = useRoute();
const router = useRouter();
/** 'schedule', 'alerts', 'changelog', or 'theatre:<id>' for a theatre's info. */
type Modal = 'schedule' | 'alerts' | 'changelog' | `theatre:${string}`;
const openModal = computed(() => route.query.info as Modal | undefined);
/** "victoriafilmfestival.com" from a homepage URL. */
const siteName = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** The theatre whose info is open, if any. */
const infoTheatre = computed(() => {
  const id = openModal.value?.startsWith('theatre:') && openModal.value.slice('theatre:'.length);
  return id ? (theatres.value.find((t) => t.manifest.id === id) ?? null) : null;
});
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
    const check = await checkNow();
    // The check also refreshed the theatres' results.
    await syncState();
    return check.newTitles.length ? `New: ${check.newTitles.join(', ')}` : 'No new films.';
  });

const onTest = () =>
  run(async () => {
    // Any current film makes a realistic example.
    const film = films.value[Math.floor(Math.random() * films.value.length)];
    const example = film ? { title: film.title, theatre: film.theatre } : null;
    await testNotification(example ? [example] : []);
    return `Sent a sample alert for "${example?.title ?? 'A new film'}" — check your notifications.`;
  });

const onAllow = () =>
  run(async () => {
    const granted = await ensureNotificationPermission();
    await readPermission();
    // Once blocked, Android stops showing the prompt; only system settings can undo it.
    return granted
      ? 'Notifications allowed.'
      : 'Still blocked — allow them in Android Settings → Apps → Local Theatre.';
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
          Theatres
        </h2>
        <dl class="settings-list">
          <div v-for="theatre in theatres" :key="theatre.manifest.id" class="items-center">
            <dt class="flex w-auto! flex-1 flex-col gap-0.5 text-ink!">
              <span class="flex items-center gap-2 text-[14px]">
                <TheatreTag :theatre="theatre.manifest.id" always />
                {{ theatre.manifest.name }}
              </span>
              <span
                class="text-[12px]"
                :class="theatreStatus(theatre).error ? 'text-error' : 'text-muted-1'"
              >
                {{ theatreStatus(theatre).text }}
              </span>
            </dt>
            <dd class="flex items-center gap-2">
              <InfoButton
                :label="`About ${theatre.manifest.name}`"
                @click="openInfo(`theatre:${theatre.manifest.id}`)"
              />
              <ToggleSwitch
                :on="theatre.enabled"
                :label="theatre.manifest.name"
                :disabled="loading || busy"
                @toggle="onToggleTheatre(theatre.manifest.id, !theatre.enabled)"
              />
            </dd>
          </div>
        </dl>
        <!-- A wrapper carries the gap: .settings-list's own margin: 0 overrides mt-*. -->
        <div v-if="theatres.length > 1" class="mt-5">
          <dl class="settings-list">
            <div class="items-center">
              <dt class="flex w-auto! flex-1 flex-col gap-0.5 text-ink!">
                <span class="text-[14px]">Combine films</span>
                <span class="text-[12px] text-muted-1">
                  Show a film on at several theatres once, with every theatre's showtimes
                </span>
              </dt>
              <dd>
                <ToggleSwitch
                  :on="combineFilms"
                  label="Combine films on at several theatres"
                  @toggle="setCombineFilms(!combineFilms)"
                />
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section>
        <h2
          class="mb-2 flex items-center gap-2 font-display text-[22px] leading-none tracking-wide text-accent"
        >
          Schedule
          <InfoButton label="How the schedule refreshes" @click="openInfo('schedule')" />
        </h2>
        <dl class="settings-list">
          <div>
            <dt>Last updated</dt>
            <dd>
              {{
                updatedAt ? `${formatDateTime(updatedAt)} (${timeAgo(updatedAt, now)})` : 'Never'
              }}
            </dd>
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
          <InfoButton label="How new film alerts work" @click="openInfo('alerts')" />
        </h2>
        <dl class="settings-list">
          <div class="items-center">
            <dt>Alerts</dt>
            <dd class="flex flex-1 items-center justify-between gap-3">
              {{ alerts ? 'On' : 'Off' }}
              <ToggleSwitch :on="alerts" label="New film alerts" @toggle="toggleAlerts" />
            </dd>
          </div>
          <div class="items-center">
            <dt><label for="check-rate">Background check</label></dt>
            <dd class="relative">
              <select
                id="check-rate"
                :value="rate"
                class="appearance-none rounded-lg border border-border-2 bg-paper py-1.5 pr-8 pl-3 text-[13px] text-ink"
                @change="onRateChange"
              >
                <option v-for="option in CHECK_RATES" :key="option" :value="option">
                  {{ checkRateLabel(option) }}
                </option>
              </select>
              <svg
                viewBox="0 0 24 24"
                class="pointer-events-none absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2 text-muted-1"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </dd>
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
        </dl>
        <div class="mt-4 text-[11px] leading-relaxed text-muted-1">
          <p class="m-0">
            This is an unofficial, personal project made for fun. It isn't affiliated with, endorsed
            by, or connected to any of the theatres it lists:
          </p>
          <ul class="my-1.5 list-disc pl-5">
            <li v-for="{ manifest } in theatres" :key="manifest.id">
              {{ manifest.name }}<template v-if="manifest.owner"> — {{ manifest.owner }}</template>
            </li>
          </ul>
          <p class="m-0">
            All listings, images, logos and trademarks belong to the theatres and the respective
            film studios, distributors and rights holders. Showtimes and seat counts are read from
            their public websites and may be out of date. Always check the official site before
            buying tickets.
          </p>
        </div>
      </section>
    </div>
    <BaseModal :open="openModal === 'schedule'" title="How refreshing works" @close="closeInfo">
      <ul class="m-0 flex list-none flex-col gap-2.5 p-0 text-[13px] leading-relaxed text-muted-2">
        <li>
          The app keeps a copy of the schedule on your phone, so it opens instantly and still works
          without a connection.
        </li>
        <li>
          Opening the app updates that copy from the theatres' sites — at most
          {{ autoRefreshLimit }}. Opening it again sooner just shows the copy you already have.
        </li>
        <li>
          <strong class="text-ink">Refresh now</strong> always updates straight away, and restarts
          the hour.
        </li>
        <li>
          If an update fails (no signal, site down), you keep the last copy and the app tries again
          next time it's due.
        </li>
        <li>
          This is separate from the background check for new film alerts, which runs even when the
          app is closed.
        </li>
      </ul>
      <template #close>Got it</template>
    </BaseModal>

    <BaseModal :open="openModal === 'alerts'" title="How alerts work" @close="closeInfo">
      <ul class="m-0 flex list-none flex-col gap-2.5 p-0 text-[13px] leading-relaxed text-muted-2">
        <li>
          The app checks each theatre's listings in the background — even when it's closed — and
          notifies you when a film appears that you haven't seen before. How often is set by
          <strong class="text-ink">Background check</strong>: every hour up to once a day, or never
          (Force check now still works).
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
      </ul>
      <template #close>Got it</template>
    </BaseModal>

    <BaseModal
      :open="Boolean(infoTheatre)"
      :title="infoTheatre?.manifest.name ?? ''"
      @close="closeInfo"
    >
      <template v-if="infoTheatre">
        <dl class="theatre-info">
          <div>
            <dt>Tag</dt>
            <dd><TheatreTag :theatre="infoTheatre.manifest.id" always /></dd>
          </div>
          <div v-if="infoTheatre.manifest.owner">
            <dt>Run by</dt>
            <dd>{{ infoTheatre.manifest.owner }}</dd>
          </div>
          <div>
            <dt>Data from</dt>
            <dd>
              <a
                :href="infoTheatre.manifest.homepage"
                target="_blank"
                rel="noopener"
                class="text-accent"
                >{{ siteName(infoTheatre.manifest.homepage) }} ↗</a
              >
            </dd>
          </div>
          <div>
            <dt>Plugin by</dt>
            <dd>{{ infoTheatre.manifest.author ?? 'Unknown' }}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>
              {{ infoTheatre.manifest.version }}
              <template v-if="infoTheatre.manifest.updated">
                · {{ formatDate(infoTheatre.manifest.updated) }}</template
              >
            </dd>
          </div>
          <div>
            <dt>Listed</dt>
            <dd>
              {{ infoTheatre.films.length }} films · {{ infoTheatre.showtimes.length }} showings
            </dd>
          </div>
        </dl>
        <details v-if="infoTheatre.lastRun?.log.length" class="mt-3 text-[12px] text-muted-2">
          <summary class="cursor-pointer text-muted-1">Log from the last run</summary>
          <pre
            class="mt-2 max-h-48 overflow-auto rounded-lg bg-paper p-2.5 font-mono text-[11px] whitespace-pre-wrap"
            >{{ infoTheatre.lastRun.log.join('\n') }}</pre>
        </details>
      </template>
      <template #close>Close</template>
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
.theatre-info {
  margin: 0;
  font-size: 13px;
}
.theatre-info > div {
  display: flex;
  gap: 1rem;
  padding: 0.45rem 0;
}
.theatre-info > div + div {
  border-top: 1px solid var(--color-border-1);
}
.theatre-info dt {
  flex-shrink: 0;
  width: 5.5rem;
  color: var(--color-muted-1);
}
.theatre-info dd {
  margin: 0;
  min-width: 0;
  color: var(--color-ink);
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
