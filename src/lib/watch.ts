import { BackgroundRunner } from '@capacitor/background-runner';
import { Capacitor } from '@capacitor/core';

import { DEFAULT_CHECK_RATE, isCheckRate, type CheckRate } from '../host/checks';
import type { Host, HostState, Kv, LastCheck } from '../host/host';

// The app's line to the theatre plugins. On the phone they run only in the
// background runner (runner/runner.ts), which also owns their saved state, so
// everything here is a dispatched event. In a desktop browser (npm run dev)
// there's no runner: the same host runs in the page, with localStorage and the
// dev server's /proxy (the sites send no CORS headers).

export type { HostState, LastCheck };
export const RUNNER_LABEL = 'com.joshlarminay.localtheatre.check';

const native = Capacitor.isNativePlatform();

// The plugin shuts the runner down whenever the app is stopped (screen off,
// notification shade over it) and starts it again on resume, so a dispatch
// made right as the app comes back can arrive before the runner is up.
const RUNNER_START_RETRIES = 20;
const RUNNER_START_DELAY_MS = 250;

async function dispatch<T>(event: string, details: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await BackgroundRunner.dispatchEvent<T>({ label: RUNNER_LABEL, event, details });
    } catch (err) {
      const notStarted = /runner is not started/i.test(String((err as Error)?.message ?? err));
      if (!notStarted || attempt >= RUNNER_START_RETRIES) throw err;
      await new Promise((resolve) => setTimeout(resolve, RUNNER_START_DELAY_MS));
    }
  }
}

const WEB_HOST_PREFIX = 'local-theatre:host:';
let webHost: Promise<Host> | null = null;

function browserHost(): Promise<Host> {
  if (!import.meta.env.DEV)
    return Promise.reject(new Error('Only works in the app (or npm run dev).'));
  webHost ??= Promise.all([import('../host/host'), import('../../plugins/sdk/discover')]).then(
    ([{ createHost }, { plugins }]) => {
      const kv: Kv = {
        get: (key) => localStorage.getItem(WEB_HOST_PREFIX + key),
        set: (key, value) => localStorage.setItem(WEB_HOST_PREFIX + key, value),
        remove: (key) => localStorage.removeItem(WEB_HOST_PREFIX + key),
      };
      return createHost({
        plugins,
        kv,
        get: async (url) => {
          const response = await fetch(`/proxy?url=${encodeURIComponent(url)}`);
          return { status: response.status, text: await response.text() };
        },
      });
    },
  );
  return webHost;
}

/** Runs every enabled theatre now and returns the new state. */
export async function refreshTheatres(): Promise<HostState> {
  if (native) return dispatch('refresh');
  return (await (await browserHost()).refresh('foreground')).state;
}

/** Saved results (including any from background checks), without fetching. */
export async function loadState(): Promise<HostState> {
  if (native) return dispatch('state');
  return (await browserHost()).state();
}

/** Turns theatres on or off; `ids` is the new enabled list, in run order. */
export async function setEnabledTheatres(ids: string[]): Promise<HostState> {
  if (native) return dispatch('plugins', { enabled: ids });
  return (await browserHost()).setEnabled(ids);
}

/** Forgets every theatre's results and plugin storage (first-seen dates stay). */
export async function clearTheatreData(): Promise<void> {
  if (native) return dispatch('clearCache');
  (await browserHost()).clear();
}

export async function checkNow(): Promise<LastCheck> {
  if (!native) throw new Error('Background checks only run in the app.');
  return dispatch('checkSchedule', { force: true });
}

/** Shows what a new-film alert looks like, using `films` as the examples. */
export async function testNotification(films: { title: string; theatre: string }[]): Promise<void> {
  if (!native) throw new Error('Notifications only work in the app.');
  await dispatch('testNotification', { films });
}

const WEB_CHECK_RATE_KEY = 'local-theatre:check-rate';

/** How often the background check runs, in hours (0 = never); pass `rate` to change it. */
export async function checkRate(rate?: CheckRate): Promise<CheckRate> {
  if (native)
    return (await dispatch<{ rate: CheckRate }>('checkRate', rate === undefined ? {} : { rate }))
      .rate;
  // No background checks in a browser; just remember the choice.
  try {
    if (rate !== undefined) localStorage.setItem(WEB_CHECK_RATE_KEY, String(rate));
    const stored = Number(localStorage.getItem(WEB_CHECK_RATE_KEY) ?? NaN);
    return isCheckRate(stored) ? stored : DEFAULT_CHECK_RATE;
  } catch {
    return rate ?? DEFAULT_CHECK_RATE;
  }
}

const WEB_ALERTS_KEY = 'local-theatre:alerts-enabled';

/** Whether new-film alerts are on; pass `enabled` to change it. */
export async function alertsEnabled(enabled?: boolean): Promise<boolean> {
  if (native)
    return (
      await dispatch<{ enabled: boolean }>('alerts', enabled === undefined ? {} : { enabled })
    ).enabled;
  try {
    if (enabled !== undefined) localStorage.setItem(WEB_ALERTS_KEY, String(enabled));
    return localStorage.getItem(WEB_ALERTS_KEY) !== 'false';
  } catch {
    return enabled ?? true;
  }
}

export type NotificationPermission = 'granted' | 'denied' | 'prompt' | 'unavailable';

export async function notificationPermission(): Promise<NotificationPermission> {
  if (!native) return 'unavailable';
  const status = await BackgroundRunner.checkPermissions();
  return status.notifications === 'granted'
    ? 'granted'
    : status.notifications === 'denied'
      ? 'denied'
      : 'prompt';
}

/** Android 13+ needs the user to allow notifications. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!native) return false;
  const status = await BackgroundRunner.checkPermissions();
  if (status.notifications === 'granted') return true;
  const requested = await BackgroundRunner.requestPermissions({ apis: ['notifications'] });
  return requested.notifications === 'granted';
}
