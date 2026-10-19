/// <reference types="@capacitor/background-runner" />
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.joshlarminay.localtheatre',
  appName: 'Local Theatre',
  webDir: 'dist',
  backgroundColor: '#121212',
  plugins: {
    // Dark-only app: light status/nav bar icons.
    SystemBars: {
      style: 'DARK',
      initialViewportFitValueHint: 'cover',
    },
    // Keep label in sync with src/lib/watch.ts. interval is how often Android wakes
    // the runner (WAKE_MINUTES in src/host/checks.ts); the runner itself skips
    // wakes until the rate chosen in Settings is due.
    BackgroundRunner: {
      label: 'com.joshlarminay.localtheatre.check',
      src: 'runners/runner.js',
      event: 'checkSchedule',
      repeat: true,
      interval: 60,
      autoStart: true,
    },
  },
};

export default config;
