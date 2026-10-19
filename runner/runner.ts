// Background runner: runs in Capacitor's headless JS engine (QuickJS: no DOM,
// no web view, no plugins). Android wakes it hourly (capacitor.config.ts) and
// it checks at the rate chosen in Settings (src/host/checks.ts); it also runs
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
  get: async (url, headers) => {
    // The runner's fetch wants an explicit method whenever options are given.
    const response = await fetch(url, headers ? { method: 'GET', headers } : undefined);
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

/** A film for the alert: its upcoming showings (local "2026-10-30T17:10:00"), soonest first. */
type NewFilm = { title: string; theatre: string; starts?: string[] };

const theatreName = (id: string) =>
  plugins.find(({ manifest }) => manifest.id === id)?.manifest.name ?? id;
// Mid-sentence: "New at the Vic", not "New at The Vic".
const atName = (id: string) => theatreName(id).replace(/^The /, 'the ');

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-30T17:10:00" → "Fri Oct 30, 5:10 pm" (no Intl in the runner's engine). */
function when(start: string): string {
  const [date, time = '00:00'] = start.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const day = DAYS[new Date(y, m - 1, d).getDay()];
  return `${day} ${MONTHS[m - 1]} ${d}, ${h % 12 || 12}:${String(min).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
/** "Fri Oct 30, 5:10 pm (+10 more)" */
const nextShowing = (film: NewFilm) =>
  film.starts?.length
    ? `${when(film.starts[0])}${film.starts.length > 1 ? ` (+${film.starts.length - 1} more)` : ''}`
    : '';
const MAX_TIMES_LISTED = 8;

/** A local wall time's epoch ms (the phone is in the theatres' time zone). */
function localMs(start: string): number {
  const [date, time = '00:00'] = start.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
}

/** The new-film alert. Used by the real check and by the test, so they always match. */
function notifyNewFilms(films: NewFilm[]) {
  if (!films.length) return;
  const titles = films.map((film) => film.title);
  const theatres = new Set(films.map((film) => film.theatre));
  const [only] = theatres;
  // largeBody (the expanded notification) needs the patch in patches/ —
  // stock plugin 3.0.0 ignores it.
  if (films.length === 1) {
    const [film] = films;
    const starts = film.starts ?? [];
    const listed = starts.slice(0, MAX_TIMES_LISTED).map(when);
    if (starts.length > MAX_TIMES_LISTED) listed.push(`+${starts.length - MAX_TIMES_LISTED} more`);
    return notify(
      `New at ${atName(only)}`,
      [film.title, nextShowing(film)].filter(Boolean).join(' · '),
      listed.length ? [film.title, ...listed].join('\n') : undefined,
    );
  }
  // Collapsed: the titles. Expanded: one film per line with its next showing,
  // and its theatre when they're from several.
  const line = (film: NewFilm) =>
    [film.title, theatres.size > 1 ? theatreName(film.theatre) : '', nextShowing(film)]
      .filter(Boolean)
      .join(' · ');
  notify(
    theatres.size === 1
      ? `${films.length} new films at ${atName(only)}`
      : `${films.length} new films`,
    titles.join(' · '),
    films.map(line).join('\n'),
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
  if (alertsEnabled()) {
    // Each new film with its upcoming showings (a film new at a second theatre counts too).
    const now = Date.now();
    const upcoming = (key: string) =>
      state.theatres
        .flatMap((t) => t.showtimes)
        .filter((show) => show.filmKey === key && localMs(show.start) >= now - 30 * 60_000)
        .map((show) => show.start)
        .sort();
    notifyNewFilms(
      added.map((film) => ({
        title: film.title,
        theatre: film.theatre,
        starts: upcoming(film.key),
      })),
    );
  }

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

// Plugin keys (manifest "keys"): saves one when `name` is passed (`value`
// null or empty removes it), and returns a hint ("…a1b") for each key that's set.
on('keys', (args: { name?: string; value?: string | null }) => {
  if (typeof args.name === 'string') host.setKey(args.name, args.value ?? null);
  return host.keyHints();
});

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
