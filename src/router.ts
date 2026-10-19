import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { createRouter, createWebHistory } from 'vue-router';

import FilmDetail from './components/FilmDetail.vue';
import SettingsPage from './components/SettingsPage.vue';
import TabsPage from './components/TabsPage.vue';

export const TABS = ['saved', 'films', 'days'] as const;
export type Tab = (typeof TABS)[number];

// Every screen has a URL, so a reload (or the app being restored) lands back on
// it. Android's Back button is wired up at the bottom of this file.
// meta.depth picks the page transition: deeper pages slide in, shallower slide back.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/films' },
    { path: `/:tab(${TABS.join('|')})`, component: TabsPage, props: true, meta: { depth: 0 } },
    {
      // Keys are "<theatre>:<film>", e.g. /film/vic:385117.
      path: '/film/:key',
      component: FilmDetail,
      props: (route) => ({ filmKey: String(route.params.key) }),
      meta: { depth: 1 },
    },
    { path: '/settings', component: SettingsPage, meta: { depth: 1 } },
    { path: '/:rest(.*)*', redirect: '/films' },
  ],
  // Back from a film returns to where the list was scrolled. Views transition
  // out-in, so scrolling waits until the old view has faded out (onViewLeft),
  // rather than jumping while it's still visible.
  scrollBehavior: (to, from, savedPosition) =>
    // Same page, only the query changed (e.g. a modal opening): stay put.
    to.path === from.path
      ? false
      : new Promise((resolve) => {
          const scroll = () => resolve(savedPosition ?? { top: 0 });
          pendingScroll = scroll;
          // In case no transition runs (first load, reduced motion).
          setTimeout(scroll, 300);
        }),
});

let pendingScroll: (() => void) | null = null;

/** Call from a view transition's after-leave. */
export function onViewLeft() {
  pendingScroll?.();
  pendingScroll = null;
}

export function openFilm(key: string) {
  router.push(`/film/${encodeURIComponent(key)}`);
}

/** Back to the previous screen, or to Films when this page was opened directly. */
export function goBack() {
  if (router.options.history.state.back) router.back();
  else router.replace('/films');
}

// Android's Back button. Capacitor doesn't pass it to the WebView by itself
// (without this the app just closes), so route it through the router:
// back through history; else from a modal, deeper page, or Saved/By day to
// Films (the home tab); and from Films, background the app like other Android
// apps do.
if (Capacitor.isNativePlatform()) {
  App.addListener('backButton', () => {
    const route = router.currentRoute.value;
    if (router.options.history.state.back) router.back();
    else if (route.query.info) router.replace({ query: {} });
    else if (route.path === '/films') App.minimizeApp();
    else router.replace('/films');
  });
}
