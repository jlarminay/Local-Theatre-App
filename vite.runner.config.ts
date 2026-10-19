import { defineConfig } from 'vite';

import { theatrePlugins } from './plugins/sdk/node.ts';

// Bundles runner/runner.ts (plus the shared parser it imports) into the single
// classic script the Background Runner loads. Runs after the app build, so it
// writes into dist/ without clearing it.
export default defineConfig({
  plugins: [theatrePlugins()],
  publicDir: false,
  build: {
    outDir: 'dist/runners',
    emptyOutDir: false,
    target: 'es2020',
    minify: false,
    lib: {
      entry: 'runner/runner.ts',
      formats: ['iife'],
      name: 'vicRunner',
      fileName: () => 'runner.js',
    },
  },
});
