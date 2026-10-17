import { BackgroundRunner } from '@capacitor/background-runner';
import { Capacitor } from '@capacitor/core';

import type { LastCheck } from '../../runner/runner';
import { recordSeen, type FirstSeen } from './schedule';

// Talks to the background runner, which owns the "seen films" state. In a
// desktop browser there's no runner, so localStorage stands in for it.

export type { LastCheck };
export const RUNNER_LABEL = 'com.joshlarminay.victheatre.check';
export const CHECK_INTERVAL_MINUTES = 240;

const WEB_SEEN_KEY = 'vic-theatre:first-seen';
const native = Capacitor.isNativePlatform();

function dispatch<T>(event: string, details: Record<string, unknown> = {}): Promise<T> {
  return BackgroundRunner.dispatchEvent<T>({ label: RUNNER_LABEL, event, details });
}

export async function markSeen(
  films: { id: number }[],
): Promise<{ firstSeen: FirstSeen; lastCheck: LastCheck | null }> {
  if (native) return dispatch('markSeen', { films: films.map(({ id }) => ({ id })) });
  let seen: FirstSeen = {};
  try {
    seen = JSON.parse(localStorage.getItem(WEB_SEEN_KEY) ?? '{}');
  } catch {
    // unreadable — start fresh
  }
  recordSeen(seen, films);
  try {
    localStorage.setItem(WEB_SEEN_KEY, JSON.stringify(seen));
  } catch {
    // storage unavailable — badges just won't persist
  }
  return { firstSeen: seen, lastCheck: null };
}

export async function checkNow(): Promise<LastCheck> {
  if (!native) throw new Error('Background checks only run in the app.');
  return dispatch('checkSchedule');
}

/** Shows what a new-film alert looks like, using `titles` as the example films. */
export async function testNotification(titles: string[]): Promise<void> {
  if (!native) throw new Error('Notifications only work in the app.');
  await dispatch('testNotification', { titles });
}

const WEB_ALERTS_KEY = 'vic-theatre:alerts-enabled';

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
