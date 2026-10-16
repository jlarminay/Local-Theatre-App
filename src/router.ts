import { createRouter, createWebHistory } from 'vue-router';

import FilmDetail from './components/FilmDetail.vue';
import SettingsPage from './components/SettingsPage.vue';
import TabsPage from './components/TabsPage.vue';

export const TABS = ['saved', 'films', 'days'] as const;
export type Tab = (typeof TABS)[number];

// Every screen has a URL, so a reload (or the app being restored) lands back on
// it. Android's Back button maps to history.back(), which the router handles.
// meta.depth picks the page transition: deeper pages slide in, shallower slide back.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/films' },
    { path: `/:tab(${TABS.join('|')})`, component: TabsPage, props: true, meta: { depth: 0 } },
    {
      path: '/film/:id(\\d+)',
      component: FilmDetail,
      props: (route) => ({ id: Number(route.params.id) }),
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

export function openFilm(id: number) {
  router.push(`/film/${id}`);
}

/** Back to the previous screen, or to Films when this page was opened directly. */
export function goBack() {
  if (router.options.history.state.back) router.back();
  else router.replace('/films');
}
