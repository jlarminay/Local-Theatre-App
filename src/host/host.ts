// Runs the theatre plugins and owns their saved state. Environment-agnostic:
// the background runner gives it CapacitorKV + fetch (runner/runner.ts), and a
// desktop browser gives it localStorage + the dev proxy (src/lib/watch.ts).
// So no DOM, no Capacitor, nothing app-specific in here.

import { makeHttp, type Get } from '../../plugins/sdk/http.ts';
import type { Ctx, Film, Main, Manifest, Showtime } from '../../plugins/sdk/types.ts';
import { validateResult } from '../../plugins/sdk/validate.ts';

export type Plugin = { manifest: Manifest; main: Main };

export type Kv = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

/** A film with its app-wide key ("vic:385117") and theatre id. */
export type HostFilm = Film & { theatre: string };
/** A showing; filmKey is the app-wide key. */
export type HostShowtime = Showtime & { theatre: string };

export type RunInfo = {
  at: number;
  mode: Ctx['mode'];
  ok: boolean;
  error?: string;
  ms: number;
  /** Entries validation threw away. */
  dropped: string[];
  /** What the plugin passed to ctx.log, last lines only. */
  log: string[];
};

export type TheatreState = {
  manifest: Manifest;
  enabled: boolean;
  /** From the last successful run (kept when a later run fails). */
  films: HostFilm[];
  showtimes: HostShowtime[];
  /** When that successful run happened. */
  updatedAt: number | null;
  lastRun: RunInfo | null;
};

export type LastCheck = { at: number; ok: boolean; error?: string; newTitles: string[] };

/** Film key → when it first appeared (epoch ms; 0 = already listed when first checked). */
export type FirstSeen = Record<string, number>;

export type HostState = {
  /** Enabled theatres in run order, then disabled ones. */
  theatres: TheatreState[];
  firstSeen: FirstSeen;
  lastCheck: LastCheck | null;
};

/** One theatre's line in the refresh progress window. */
export type TheatreProgress = {
  id: string;
  name: string;
  state: 'waiting' | 'running' | 'done' | 'failed';
  /** From ctx.progress while running. */
  step?: string;
  done?: number;
  total?: number;
  startedAt?: number;
  finishedAt?: number;
  /** When done: how many films it returned. */
  films?: number;
  error?: string;
  /** Every step and log line so far, oldest first. */
  steps: { at: number; text: string }[];
};

/** A refresh as it happens, for the app's progress window. */
export type RefreshProgress = {
  startedAt: number;
  finishedAt?: number;
  theatres: TheatreProgress[];
};

export const PLUGIN_TIMEOUT_MS = 60_000;
const MAX_LOG_LINES = 50;

const KEYS = {
  enabled: 'enabledPlugins',
  known: 'knownPlugins',
  firstSeen: 'firstSeen',
  lastCheck: 'lastCheck',
  result: (id: string) => `result:${id}`,
  lastRun: (id: string) => `lastRun:${id}`,
  store: (id: string) => `store:${id}`,
};

type SavedResult = { at: number; films: HostFilm[]; showtimes: HostShowtime[] };

/**
 * Records first-seen times for `films` (app-wide keys). A theatre's first
 * ever run records everything as 0, so enabling a theatre doesn't flag its
 * whole current lineup as new. Returns the films that are actually new.
 */
export function recordSeen<F extends { key: string; theatre: string }>(
  seen: FirstSeen,
  films: F[],
  now = Date.now(),
): F[] {
  const seenTheatres = new Set(Object.keys(seen).map((key) => key.split(':')[0]));
  const added: F[] = [];
  for (const film of films) {
    if (film.key in seen) continue;
    const baseline = !seenTheatres.has(film.theatre);
    seen[film.key] = baseline ? 0 : now;
    if (!baseline) added.push(film);
  }
  return added;
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  if (typeof setTimeout !== 'function') return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} took over ${ms / 1000} s`)), ms);
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (err) => (clearTimeout(timer), reject(err)),
    );
  });
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function createHost(options: { plugins: Plugin[]; kv: Kv; get: Get; timeoutMs?: number }) {
  const { kv, get } = options;
  const timeoutMs = options.timeoutMs ?? PLUGIN_TIMEOUT_MS;
  const byId = new Map(options.plugins.map((plugin) => [plugin.manifest.id, plugin]));

  function read<T>(key: string, fallback: T): T {
    try {
      const value = kv.get(key);
      return value ? (JSON.parse(value) as T) : fallback;
    } catch {
      return fallback;
    }
  }
  const write = (key: string, value: unknown) => kv.set(key, JSON.stringify(value));

  // Plugins new to this install start as their manifest says; plugins whose
  // folder is gone are forgotten along with their data.
  (function register() {
    const known = read<string[]>(KEYS.known, []);
    const enabled = read<string[]>(KEYS.enabled, []);
    const ids = [...byId.keys()];
    const added = ids.filter((id) => !known.includes(id));
    const removed = known.filter((id) => !byId.has(id));
    if (!added.length && !removed.length) return;
    for (const id of removed)
      for (const key of [KEYS.result(id), KEYS.lastRun(id), KEYS.store(id)]) kv.remove(key);
    write(KEYS.known, ids);
    write(KEYS.enabled, [
      ...enabled.filter((id) => byId.has(id)),
      ...added.filter((id) => byId.get(id)!.manifest.enabledByDefault !== false),
    ]);
  })();

  const enabledIds = () => read<string[]>(KEYS.enabled, []).filter((id) => byId.has(id));

  function state(): HostState {
    const enabled = enabledIds();
    const order = [...enabled, ...[...byId.keys()].filter((id) => !enabled.includes(id))];
    return {
      theatres: order.map((id) => {
        const result = read<SavedResult | null>(KEYS.result(id), null);
        return {
          manifest: byId.get(id)!.manifest,
          enabled: enabled.includes(id),
          films: result?.films ?? [],
          showtimes: result?.showtimes ?? [],
          updatedAt: result?.at ?? null,
          lastRun: read<RunInfo | null>(KEYS.lastRun(id), null),
        };
      }),
      firstSeen: read<FirstSeen>(KEYS.firstSeen, {}),
      lastCheck: read<LastCheck | null>(KEYS.lastCheck, null),
    };
  }

  async function runOne(
    plugin: Plugin,
    mode: Ctx['mode'],
    onStep: (step: string, done?: number, total?: number) => void = () => {},
    onLog: (line: string) => void = () => {},
  ): Promise<RunInfo> {
    const { id } = plugin.manifest;
    const started = Date.now();
    const limitMs = plugin.manifest.timeoutSeconds
      ? Math.min(plugin.manifest.timeoutSeconds, 300) * 1000
      : timeoutMs;
    const log: string[] = [];
    const store = read<Record<string, unknown>>(KEYS.store(id), {});
    const ctx: Ctx = {
      http: makeHttp(plugin.manifest, get),
      store: {
        get: <T>(key: string) => store[key] as T | undefined,
        set: (key, value) => {
          store[key] = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
        },
      },
      mode,
      log: (...parts) => {
        const line = parts.map((p) => (typeof p === 'string' ? p : errorText(p))).join(' ');
        log.push(line);
        if (log.length > MAX_LOG_LINES) log.shift();
        onLog(line);
        console.log(`[${id}]`, line);
      },
      progress: onStep,
      deadline: started + limitMs,
    };

    let info: RunInfo;
    try {
      const { result, dropped } = validateResult(
        await withTimeout(plugin.main(ctx), limitMs, plugin.manifest.name),
      );
      const prefix = (key: string) => `${id}:${key}`;
      const saved: SavedResult = {
        at: Date.now(),
        films: result.films.map((film) => ({ ...film, key: prefix(film.key), theatre: id })),
        showtimes: result.showtimes.map((s) => ({ ...s, filmKey: prefix(s.filmKey), theatre: id })),
      };
      write(KEYS.result(id), saved);
      write(KEYS.store(id), store);
      info = { at: saved.at, mode, ok: true, ms: saved.at - started, dropped, log };
    } catch (err) {
      // The last good result stays; only the run info records the failure.
      info = {
        at: Date.now(),
        mode,
        ok: false,
        error: errorText(err),
        ms: Date.now() - started,
        dropped: [],
        log,
      };
    }
    write(KEYS.lastRun(id), info);
    return info;
  }

  return {
    state,
    enabledIds,

    /**
     * Runs every enabled plugin, in order, one at a time; one failing doesn't
     * stop the rest. Returns the new state and the films seen for the first time.
     */
    async refresh(
      mode: Ctx['mode'],
      /** Called as the refresh goes: each theatre waiting, running (with its steps), done. */
      onProgress?: (progress: RefreshProgress) => void,
    ): Promise<{ state: HostState; added: HostFilm[]; runs: Record<string, RunInfo> }> {
      const runs: Record<string, RunInfo> = {};
      const ids = enabledIds();
      const progress: RefreshProgress = {
        startedAt: Date.now(),
        theatres: ids.map((id) => ({
          id,
          name: byId.get(id)!.manifest.name,
          state: 'waiting',
          steps: [],
        })),
      };
      const emit = () => onProgress?.(JSON.parse(JSON.stringify(progress)));
      emit();
      for (const [i, id] of ids.entries()) {
        const line = progress.theatres[i];
        Object.assign(line, { state: 'running', startedAt: Date.now() });
        emit();
        const addStep = (text: string) => line.steps.push({ at: Date.now(), text });
        runs[id] = await runOne(
          byId.get(id)!,
          mode,
          (step, done, total) => {
            // A new step is a new line; the same step with a new count just updates.
            if (step !== line.step) addStep(step);
            Object.assign(line, { step, done, total });
            emit();
          },
          (logLine) => {
            addStep(logLine);
            emit();
          },
        );
        const run = runs[id];
        Object.assign(line, {
          state: run.ok ? 'done' : 'failed',
          finishedAt: Date.now(),
          error: run.error,
          step: undefined,
          done: undefined,
          total: undefined,
        });
        if (run.ok) line.films = read<SavedResult | null>(KEYS.result(id), null)?.films.length;
        addStep(run.ok ? `Done · ${line.films ?? 0} films` : `Failed: ${run.error}`);
        emit();
      }
      progress.finishedAt = Date.now();
      emit();

      const next = state();
      const films = next.theatres.filter((t) => runs[t.manifest.id]?.ok).flatMap((t) => t.films);
      const added = recordSeen(next.firstSeen, films);
      write(KEYS.firstSeen, next.firstSeen);
      return { state: next, added, runs };
    },

    /** Turns theatres on or off; `ids` is the new enabled list, in run order. */
    setEnabled(ids: string[]): HostState {
      write(
        KEYS.enabled,
        ids.filter((id, i) => byId.has(id) && ids.indexOf(id) === i),
      );
      return state();
    },

    setLastCheck(check: LastCheck) {
      write(KEYS.lastCheck, check);
    },

    /** Forgets every theatre's results and plugin storage. Keeps first-seen dates and settings. */
    clear() {
      for (const id of byId.keys())
        for (const key of [KEYS.result(id), KEYS.lastRun(id), KEYS.store(id)]) kv.remove(key);
    },
  };
}

export type Host = ReturnType<typeof createHost>;
