import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // Shown on the Settings page. The build time is when `npm run build` ran,
  // i.e. what's on the phone after `npm run android`.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: true,
    port: 5173,
    // Dev-only: the Vic's site sends no CORS headers, so in a desktop browser
    // its pages are fetched through here. The native app doesn't need this.
    proxy: {
      '/vic': {
        target: 'https://www.victoriafilmfestival.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/vic/, ''),
      },
    },
  },
});
