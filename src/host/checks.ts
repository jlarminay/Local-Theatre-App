// How often the background new-film check runs. Android's job wakes the runner
// every WAKE_MINUTES (capacitor.config.ts → BackgroundRunner.interval; the
// plugin can't change it at runtime), and the runner skips wakes until the
// user's chosen rate says a check is due. Shared by runner/runner.ts and the app.

/** The choices in Settings, in hours; 0 = never. */
export const CHECK_RATES = [1, 3, 6, 12, 24, 0] as const;
export type CheckRate = (typeof CHECK_RATES)[number];
export const DEFAULT_CHECK_RATE: CheckRate = 3;

/** Keep in sync with BackgroundRunner.interval in capacitor.config.ts. */
export const WAKE_MINUTES = 60;

// Android runs periodic jobs a little early or late, so a check counts as due
// slightly before its time; otherwise a 3 h rate could slip to every 4 h.
const EARLY_MS = 10 * 60_000;

export const isCheckRate = (value: unknown): value is CheckRate =>
  CHECK_RATES.includes(value as CheckRate);

/** Whether a scheduled wake should run the check, given when the last one ran. */
export function checkDue(rate: CheckRate, lastAt: number | null, now = Date.now()): boolean {
  if (rate === 0) return false;
  if (lastAt === null) return true;
  return now - lastAt >= rate * 3_600_000 - EARLY_MS;
}

/** "Every 3 hours", "Every hour", "Never". */
export function checkRateLabel(rate: CheckRate): string {
  if (rate === 0) return 'Never';
  if (rate === 1) return 'Every hour';
  return `Every ${rate} hours`;
}
