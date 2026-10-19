import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

import pkg from './package.json' with { type: 'json' };
import { devProxy, theatrePlugins } from './plugins/sdk/node.ts';

export default defineConfig({
  // devProxy: in a desktop browser, theatre sites are fetched through /proxy
  // (they send no CORS headers). The native app doesn't need it.
  plugins: [vue(), tailwindcss(), theatrePlugins(), devProxy()],
  // Shown on the Settings page. The build time is when `npm run build` ran,
  // i.e. what's on the phone after `npm run android`.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: true,
    port: 5173,
  },
});
