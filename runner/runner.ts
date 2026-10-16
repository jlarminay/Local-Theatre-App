// Background runner: runs in Capacitor's headless JS engine (no DOM, no web
// view, no plugins), roughly every 6 hours per capacitor.config.ts. Bundled to
// dist/runners/runner.js by vite.runner.config.ts.
//
// State lives in CapacitorKV (Android SharedPreferences), so the app reads and
// updates it by dispatching events here — see src/lib/watch.ts.

import {
  CALENDAR_URL,
  parseCalendar,
  recordSeen,
  uniqueFilms,
  type FirstSeen,
} from '../src/lib/schedule';

type Resolve = (value?: unknown) => void;
type Reject = (reason?: unknown) => void;

// The runner's globals aren't the browser's, so they're reached through a cast
// rather than declared (DOM's addEventListener would clash).
const runner = globalThis as unknown as {
  addEventListener(
    event: string,
    handler: (resolve: Resolve, reject: Reject, args: any) => void,
  ): void;
  CapacitorKV: {
    get(key: string): { value: string } | null;
    set(key: string, value: string): void;
  };
  CapacitorNotifications: {
    schedule(
      options: {
        id: number;
        title: string;
        body: string;
        largeBody?: string;
        smallIcon?: string;
      }[],
    ): void;
  };
};

export type LastCheck = { at: number; ok: boolean; error?: string; newTitles: string[] };

const SEEN_KEY = 'firstSeen';
const LAST_CHECK_KEY = 'lastCheck';
// Set from the app's Settings. Off only silences alerts: checks keep recording
// films, so switching back on doesn't announce everything added meanwhile.
const ALERTS_KEY = 'alertsEnabled';

const alertsEnabled = () => readJson<boolean>(ALERTS_KEY, true);

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = runner.CapacitorKV.get(key)?.value;
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  runner.CapacitorKV.set(key, JSON.stringify(value));
}

function notify(title: string, body: string, largeBody?: string) {
  // No scheduleAt, so it shows now. The Android plugin parses scheduleAt's UTC
  // ISO string as local time, which here pushed notifications ~7 hours late.
  // smallIcon is the white emblem drawable from scripts/make-icon.mjs (else
  // Android's generic (i)). Ids only need to be unique among visible notifications.
  runner.CapacitorNotifications.schedule([
    {
      id: Math.floor(Date.now() / 1000) % 2_000_000_000,
      title,
      body,
      largeBody,
      smallIcon: 'ic_stat_vic',
    },
  ]);
}

/** The new-film alert. Used by the real check and by the test, so they always match. */
function notifyNewFilms(titles: string[]) {
  if (titles.length === 1) notify('New at the Vic', titles[0]);
  // Collapsed: one line. Expanded: one film per line. largeBody needs the
  // patch in patches/ — stock plugin 3.0.0 ignores it.
  else if (titles.length > 1)
    notify(`${titles.length} new films at the Vic`, titles.join(' · '), titles.join('\n'));
}

// The scheduled 6-hourly check (also dispatched by "Force check now" in the app).
runner.addEventListener('checkSchedule', async (resolve, reject) => {
  try {
    const response = await fetch(CALENDAR_URL);
    if (!response.ok) throw new Error(`Site returned ${response.status}`);
    const films = uniqueFilms(parseCalendar(await response.text()));

    const seen = readJson<FirstSeen>(SEEN_KEY, {});
    const added = recordSeen(seen, films);
    writeJson(SEEN_KEY, seen);

    const newTitles = films.filter((film) => added.includes(film.id)).map((film) => film.title);
    if (alertsEnabled()) notifyNewFilms(newTitles);

    const result: LastCheck = { at: Date.now(), ok: true, newTitles };
    writeJson(LAST_CHECK_KEY, result);
    resolve(result);
  } catch (err) {
    const result: LastCheck = { at: Date.now(), ok: false, error: String(err), newTitles: [] };
    writeJson(LAST_CHECK_KEY, result);
    reject(err);
  }
});

// The app saw these films (it fetched the calendar itself), so they're not news.
// Returns the full first-seen map and last check so the app can show "New" badges.
runner.addEventListener('markSeen', (resolve, reject, args: { films?: { id: number }[] }) => {
  try {
    const seen = readJson<FirstSeen>(SEEN_KEY, {});
    recordSeen(seen, args?.films ?? []);
    writeJson(SEEN_KEY, seen);
    resolve({ firstSeen: seen, lastCheck: readJson<LastCheck | null>(LAST_CHECK_KEY, null) });
  } catch (err) {
    reject(err);
  }
});

// Reads the alerts setting, and changes it when `enabled` is passed.
runner.addEventListener('alerts', (resolve, reject, args: { enabled?: boolean }) => {
  try {
    if (typeof args?.enabled === 'boolean') writeJson(ALERTS_KEY, args.enabled);
    resolve({ enabled: alertsEnabled() });
  } catch (err) {
    reject(err);
  }
});

// A sample of the new-film alert, using titles the app passes in. Sent even
// with alerts off — it's a test.
runner.addEventListener('testNotification', (resolve, _reject, args: { titles?: string[] }) => {
  notifyNewFilms(args?.titles?.length ? args.titles : ['A new film']);
  resolve();
});
