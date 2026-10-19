// Background runner: runs in Capacitor's headless JS engine (QuickJS: no DOM,
// no web view, no plugins), roughly every 4 hours per capacitor.config.ts, and
// whenever the app dispatches an event. Bundled to dist/runners/runner.js by
// vite.runner.config.ts, theatre plugins included.
//
// It's the only place theatre plugins run on the phone: the app's refresh is a
// `refresh` event here too, so the app and the periodic check can't disagree.
// State lives in CapacitorKV (Android SharedPreferences) — see src/host/host.ts.

import { plugins } from '../plugins/sdk/discover';
import { checkDue, DEFAULT_CHECK_RATE, isCheckRate, type CheckRate } from '../src/host/checks';
import { createHost, type HostState, type LastCheck } from '../src/host/host';

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
    remove(key: string): void;
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

export type { LastCheck };

const host = createHost({
  plugins,
  kv: {
    get: (key) => runner.CapacitorKV.get(key)?.value ?? null,
    set: (key, value) => runner.CapacitorKV.set(key, value),
    remove: (key) => runner.CapacitorKV.remove(key),
  },
  get: async (url) => {
    const response = await fetch(url);
    return { status: response.status, text: await response.text() };
  },
});

// Set from the app's Settings. Off only silences alerts: checks keep recording
// films, so switching back on doesn't announce everything added meanwhile.
const ALERTS_KEY = 'alertsEnabled';

function alertsEnabled(): boolean {
  try {
    const value = runner.CapacitorKV.get(ALERTS_KEY)?.value;
    return value ? JSON.parse(value) !== false : true;
  } catch {
    return true;
  }
}

// How often the scheduled check actually runs (see src/host/checks.ts).
const CHECK_RATE_KEY = 'checkRate';

function checkRate(): CheckRate {
  try {
    const value = JSON.parse(runner.CapacitorKV.get(CHECK_RATE_KEY)?.value ?? 'null');
    return isCheckRate(value) ? value : DEFAULT_CHECK_RATE;
  } catch {
    return DEFAULT_CHECK_RATE;
  }
}

function notify(title: string, body: string, largeBody?: string) {
  // No scheduleAt, so it shows now. The Android plugin parses scheduleAt's UTC
  // ISO string as local time, which here pushed notifications ~7 hours late.
  // smallIcon is the white "LT" drawable from scripts/make-icon.mjs (else
  // Android's generic (i)). Ids only need to be unique among visible notifications.
  runner.CapacitorNotifications.schedule([
    {
      id: Math.floor(Date.now() / 1000) % 2_000_000_000,
      title,
      body,
      largeBody,
      smallIcon: 'ic_stat_notify',
    },
  ]);
}

type NewFilm = { title: string; theatre: string };

const theatreName = (id: string) =>
  plugins.find(({ manifest }) => manifest.id === id)?.manifest.name ?? id;
// Mid-sentence: "New at the Vic", not "New at The Vic".
const atName = (id: string) => theatreName(id).replace(/^The /, 'the ');

/** The new-film alert. Used by the real check and by the test, so they always match. */
function notifyNewFilms(films: NewFilm[]) {
  if (!films.length) return;
  const titles = films.map((film) => film.title);
  const theatres = new Set(films.map((film) => film.theatre));
  const [only] = theatres;
  if (films.length === 1) return notify(`New at ${atName(only)}`, titles[0]);
  // Collapsed: one line. Expanded: one film per line, with its theatre when
  // they're from several. largeBody needs the patch in patches/ — stock
  // plugin 3.0.0 ignores it.
  if (theatres.size === 1)
    return notify(
      `${films.length} new films at ${atName(only)}`,
      titles.join(' · '),
      titles.join('\n'),
    );
  notify(
    `${films.length} new films`,
    titles.join(' · '),
    films.map((film) => `${film.title} · ${theatreName(film.theatre)}`).join('\n'),
  );
}

/** Wraps a handler so a throw rejects the dispatch instead of hanging it. */
function on<A>(event: string, handler: (args: A) => unknown | Promise<unknown>) {
  runner.addEventListener(event, async (resolve, reject, args: A) => {
    try {
      resolve(await handler(args ?? ({} as A)));
    } catch (err) {
      reject(err);
    }
  });
}

// The scheduled check. Android wakes the runner hourly; wakes before the
// chosen rate is due (or with "Never") return straight away. "Force check
// now" in the app passes `force` and always runs. Theatres whose run fails
// keep their last results and are reported in the check's error; the others
// still alert.
on('checkSchedule', async (args: { force?: boolean }): Promise<LastCheck | { skipped: true }> => {
  if (!args.force && !checkDue(checkRate(), host.state().lastCheck?.at ?? null))
    return { skipped: true };
  const { state, added, runs } = await host.refresh('background');
  const newTitles = added.map((film) => film.title);
  if (alertsEnabled()) notifyNewFilms(added);

  const failed = state.theatres.filter((t) => runs[t.manifest.id] && !runs[t.manifest.id].ok);
  const check: LastCheck = {
    at: Date.now(),
    ok: !failed.length,
    newTitles,
    ...(failed.length > 0 && {
      error: failed.map((t) => `${t.manifest.name}: ${runs[t.manifest.id].error}`).join('\n'),
    }),
  };
  host.setLastCheck(check);
  return check;
});

// The app's refresh. Films found here are on screen, so they're recorded as
// seen without an alert. Progress goes into the KV store as it happens; the app
// reads it from there (src/lib/watch.ts) for its progress window, since it
// can't hear from this event until it finishes.
export const PROGRESS_KEY = 'refreshProgress';
on(
  'refresh',
  async (): Promise<HostState> =>
    (
      await host.refresh('foreground', (progress) =>
        runner.CapacitorKV.set(PROGRESS_KEY, JSON.stringify(progress)),
      )
    ).state,
);

// Saved results, first-seen dates and the last check, without fetching.
on('state', (): HostState => host.state());

// Which theatres are on, in run order. Without `enabled` it just reads.
on('plugins', (args: { enabled?: string[] }): HostState =>
  Array.isArray(args.enabled) ? host.setEnabled(args.enabled) : host.state(),
);

// "Clear cached schedule": forget results and plugin storage (first-seen dates stay).
on('clearCache', () => host.clear());

// Reads the check rate (hours, 0 = never), and changes it when `rate` is passed.
on('checkRate', (args: { rate?: unknown }) => {
  if (isCheckRate(args.rate)) runner.CapacitorKV.set(CHECK_RATE_KEY, JSON.stringify(args.rate));
  return { rate: checkRate() };
});

// Reads the alerts setting, and changes it when `enabled` is passed.
on('alerts', (args: { enabled?: boolean }) => {
  if (typeof args.enabled === 'boolean')
    runner.CapacitorKV.set(ALERTS_KEY, JSON.stringify(args.enabled));
  return { enabled: alertsEnabled() };
});

// A sample of the new-film alert, using films the app passes in. Sent even
// with alerts off — it's a test.
on('testNotification', (args: { films?: NewFilm[] }) => {
  notifyNewFilms(
    args.films?.length
      ? args.films
      : [{ title: 'A new film', theatre: plugins[0]?.manifest.id ?? '' }],
  );
});
