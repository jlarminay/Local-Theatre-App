<script setup lang="ts">
import { Capacitor } from '@capacitor/core';
import { marked } from 'marked';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import changelogMarkdown from '../../CHANGELOG.md?raw';
import { useNow } from '../composables/useNow';
import { usePosters } from '../composables/usePosters';
import { useSaved } from '../composables/useSaved';
import { AUTO_REFRESH_MIN_MS, useSchedule } from '../composables/useSchedule';
import { CHECK_RATES, checkRateLabel, DEFAULT_CHECK_RATE, type CheckRate } from '../host/checks';
import { formatDate, formatDateTime, timeAgo } from '../lib/format';
import { canScanQr, scanQr } from '../lib/scanQr';
import {
  alertsEnabled,
  checkNow,
  checkRate,
  ensureNotificationPermission,
  notificationPermission,
  pluginKeys,
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
    text: `${theatre.films.length} films`,
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
type Modal =
  'schedule' | 'alerts' | 'changelog' | 'tmdb-key' | `key:${string}` | `theatre:${string}`;
const openModal = computed(() => route.query.info as Modal | undefined);
// Per-theatre poster choice, in the theatre's info. Saved as soon as it's picked.
const { tmdbAvailable, keyHint, saveKey, removeKey, imageChoice, setImageChoice, lookupError } =
  usePosters();

// Keys plugins need (manifest "keys"), once each, with the theatres that use
// them; and hints ("…a1b") for those that are set. Kept by the runner.
const pluginKeyHints = ref<Record<string, string>>({});
onMounted(async () => {
  try {
    pluginKeyHints.value = await pluginKeys();
  } catch {
    // runner unavailable — rows show "Add key"
  }
});
const pluginKeySpecs = computed(() => {
  const specs = new Map<
    string,
    { name: string; label: string; help?: string; theatres: string[] }
  >();
  for (const { manifest } of theatres.value)
    for (const key of manifest.keys ?? []) {
      const spec = specs.get(key.name) ?? { ...key, theatres: [] };
      spec.theatres.push(manifest.name);
      specs.set(key.name, spec);
    }
  return [...specs.values()];
});
/** Which key the key window is for: TMDB's, or a plugin's. */
const keyTarget = computed(() => {
  const info = openModal.value;
  if (info === 'tmdb-key') return { kind: 'tmdb' as const, label: 'TMDB key' };
  if (!info?.startsWith('key:')) return null;
  const spec = pluginKeySpecs.value.find((k) => k.name === info.slice('key:'.length));
  return spec ? { kind: 'plugin' as const, ...spec } : null;
});
const targetHint = computed(() =>
  keyTarget.value?.kind === 'plugin'
    ? (pluginKeyHints.value[keyTarget.value.name] ?? '')
    : keyHint.value,
);
async function removePluginKey(name: string) {
  try {
    pluginKeyHints.value = await pluginKeys(name, null);
  } catch (err) {
    message.value = `Failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// The key modal. The key is write-only: the field always starts empty,
// and saving replaces whatever was set before.
const keyInput = ref('');
const keyError = ref('');
const keySaving = ref(false);
function openKeyModal(which: 'tmdb-key' | `key:${string}` = 'tmdb-key') {
  keyInput.value = '';
  keyError.value = '';
  openInfo(which);
}
// Bringing the key over from a computer: scan it from a QR code instead of typing.
const keyScanStatus = ref('');
async function onScanKey() {
  keyError.value = '';
  try {
    const text = await scanQr((status) => (keyScanStatus.value = status));
    if (text) keyInput.value = text;
  } catch (err) {
    keyError.value = err instanceof Error ? err.message : String(err);
  } finally {
    keyScanStatus.value = '';
  }
}

async function onSaveKey() {
  keySaving.value = true;
  keyError.value = '';
  try {
    const target = keyTarget.value;
    if (target?.kind === 'plugin') {
      pluginKeyHints.value = await pluginKeys(target.name, keyInput.value.trim());
      // Try it straight away, if a theatre that uses it is on.
      if (
        theatres.value.some(
          (t) => t.enabled && t.manifest.keys?.some((k) => k.name === target.name),
        )
      )
        refresh();
    } else {
      await saveKey(keyInput.value);
    }
    keyInput.value = '';
    closeInfo();
  } catch (err) {
    keyError.value = err instanceof Error ? err.message : String(err);
  } finally {
    keySaving.value = false;
  }
}
const onImageChoice = (id: string, event: Event) =>
  setImageChoice(id, (event.target as HTMLSelectElement).value as 'default' | 'own');

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
    const example = film
      ? { title: film.title, theatre: film.theatre, starts: film.showtimes.map((s) => s.start) }
      : null;
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
        class="flex items-center gap-1.5 rounded-full border border-border-2 bg-transparent py-1.5 pr-4 pl-3 text-ink"
        @click="goBack"
      >
        <svg
          viewBox="0 0 24 24"
          class="h-4 w-4"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M19 12H5m6-6-6 6 6 6" />
        </svg>
        Back
      </button>
      <h1 class="m-0 font-display text-[32px] leading-none tracking-wide">Settings</h1>
    </header>

    <div class="flex flex-col gap-6 px-4 pt-5 pb-4">
      <section>
        <h2 class="mb-2 font-display text-[22px] leading-none tracking-wide text-accent">
          Settings
        </h2>
        <dl class="settings-list">
          <div v-if="theatres.length > 1" class="items-center">
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
          <div class="items-center">
            <dt class="flex w-auto! flex-1 flex-col gap-0.5 text-ink!">
              <span class="text-[14px]">TMDB key</span>
              <span class="text-[12px] text-muted-1"> For posters from The Movie Database </span>
              <span v-if="lookupError" class="text-[12px] text-error">{{ lookupError }}</span>
            </dt>
            <dd class="flex flex-wrap gap-2">
              <template v-if="keyHint">
                <button class="settings-button whitespace-nowrap" @click="removeKey">
                  Remove key
                </button>
                <button class="settings-button whitespace-nowrap" @click="openKeyModal()">
                  Add another
                </button>
              </template>
              <button v-else class="settings-button whitespace-nowrap" @click="openKeyModal()">
                Add key
              </button>
            </dd>
          </div>
          <div v-for="spec in pluginKeySpecs" :key="spec.name" class="items-center">
            <dt class="flex w-auto! flex-1 flex-col gap-0.5 text-ink!">
              <span class="text-[14px]">{{ spec.label }}</span>
              <span class="text-[12px] text-muted-1">Used by {{ spec.theatres.join(', ') }}</span>
            </dt>
            <dd class="flex flex-wrap gap-2">
              <template v-if="pluginKeyHints[spec.name]">
                <button
                  class="settings-button whitespace-nowrap"
                  @click="removePluginKey(spec.name)"
                >
                  Remove key
                </button>
                <button
                  class="settings-button whitespace-nowrap"
                  @click="openKeyModal(`key:${spec.name}`)"
                >
                  Add another
                </button>
              </template>
              <button
                v-else
                class="settings-button whitespace-nowrap"
                @click="openKeyModal(`key:${spec.name}`)"
              >
                Add key
              </button>
            </dd>
          </div>
        </dl>
      </section>

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
        <div class="mt-4 text-[12px] leading-relaxed text-muted-1">
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
          <p v-if="tmdbAvailable" class="mt-1.5 mb-0">
            Some posters come from
            <a href="https://www.themoviedb.org/" target="_blank" rel="noopener" class="text-accent"
              >The Movie Database (TMDB)</a
            >. This product uses the TMDB API but is not endorsed or certified by TMDB.
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
          <div class="items-center">
            <dt><label for="image-choice">Posters</label></dt>
            <dd class="flex flex-col gap-1">
              <span class="relative self-start">
                <select
                  id="image-choice"
                  :value="imageChoice(infoTheatre.manifest.id)"
                  :disabled="!tmdbAvailable"
                  class="appearance-none rounded-lg border border-border-2 bg-paper py-1.5 pr-8 pl-3 text-[13px] text-ink disabled:opacity-50"
                  @change="onImageChoice(infoTheatre.manifest.id, $event)"
                >
                  <option value="default">Default</option>
                  <option value="own">Use own images</option>
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
              </span>
              <span v-if="!tmdbAvailable" class="text-[12px] text-muted-1">
                Uses the theatre's images until a TMDB key is added in Settings.
              </span>
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

    <BaseModal :open="Boolean(keyTarget)" :title="keyTarget?.label ?? ''" @close="closeInfo">
      <form class="flex flex-col gap-3 text-[13px] text-muted-2" @submit.prevent="onSaveKey">
        <p v-if="keyTarget?.kind === 'plugin'" class="m-0 leading-relaxed">
          {{ keyTarget.help ?? 'A key this theatre needs.' }} It's kept only on this device.
        </p>
        <p v-else class="m-0 leading-relaxed">
          Posters can come from The Movie Database. It needs your own free key: sign up at
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noopener"
            class="text-accent"
            >themoviedb.org ↗</a
          >
          and paste the <strong class="text-ink">API Key</strong> or
          <strong class="text-ink">API Read Access Token</strong>. It's kept only on this device.
        </p>
        <p v-if="targetHint" class="m-0">
          A key ending <span class="font-mono text-ink">{{ targetHint }}</span> is set. Saving a new
          one replaces it.
        </p>
        <div class="flex gap-2">
          <input
            v-model="keyInput"
            type="password"
            autocomplete="off"
            spellcheck="false"
            :placeholder="targetHint ? 'New key' : 'Key'"
            :aria-label="keyTarget?.label ?? 'Key'"
            class="min-w-0 flex-1 rounded-lg border border-border-2 bg-paper px-3 py-2 font-mono text-[13px] text-ink"
          />
          <button
            v-if="canScanQr"
            type="button"
            class="grid w-11 shrink-0 place-items-center rounded-lg border border-border-2 bg-transparent text-ink"
            aria-label="Scan the key from a QR code"
            :disabled="Boolean(keyScanStatus)"
            @click="onScanKey"
          >
            <svg
              viewBox="0 0 24 24"
              class="h-5 w-5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path
                d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"
              />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </button>
        </div>
        <p v-if="keyScanStatus" class="m-0">{{ keyScanStatus }}</p>
        <p v-if="keyError" class="m-0 text-error">{{ keyError }}</p>
      </form>
      <template #actions>
        <div class="flex gap-2">
          <button
            class="flex-1 rounded-lg border border-border-2 bg-transparent py-2.5 text-[14px] text-ink"
            @click="closeInfo"
          >
            Cancel
          </button>
          <button
            class="flex-1 rounded-lg border-0 bg-accent py-2.5 text-[14px] font-medium text-white disabled:opacity-50"
            :disabled="keySaving || !keyInput.trim()"
            @click="onSaveKey"
          >
            {{ keySaving ? (keyTarget?.kind === 'tmdb' ? 'Checking…' : 'Saving…') : 'Save' }}
          </button>
        </div>
      </template>
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
  /* Tailwind's reset removes list markers. */
  list-style-type: '- ';
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
