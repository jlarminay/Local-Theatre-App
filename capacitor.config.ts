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
    // Keep label and interval in sync with src/lib/watch.ts.
    BackgroundRunner: {
      label: 'com.joshlarminay.localtheatre.check',
      src: 'runners/runner.js',
      event: 'checkSchedule',
      repeat: true,
      interval: 240,
      autoStart: true,
    },
  },
};

export default config;
