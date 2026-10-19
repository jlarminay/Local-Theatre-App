# Local Theatre

> Formerly **Vic Theatre**. It is being reworked to support several local cinemas through
> built-in scraper plugins. The last Vic-only release is tagged `vic-v1.0.2`.

A personal Android app (Vue + TypeScript + Capacitor) that shows the Victoria Film Theatre's
schedule in a readable way and sends a notification when a new film is added.

> **Disclaimer:** This is an unofficial personal project. It is not affiliated with, endorsed by,
> or connected to the Victoria Film Theatre or the Victoria Film Festival. All theatre names,
> logos, film titles, posters and descriptions belong to the Victoria Film Festival and the
> respective film studios. The app reads publicly available information from their website and
> does not redistribute it.
>
> This code is shared for reference only, for personal and non-commercial use. It is provided
> "as is", without warranty of any kind. Use it at your own risk; the author is not liable for
> any damages or issues arising from its use. All rights reserved.

## How it works

- **Theatre plugins** (`plugins/<id>/`, see below) fetch and parse each theatre's site. The Vic's
  showtimes come from its [monthly calendar page](https://www.victoriafilmfestival.com/festival/victoria-film-theatre-monthly-calendar/),
  which embeds its events as JSON, and its posters and synopses from WooCommerce's public Store
  API, in one request for all films.
- **The background runner** (`runner/runner.ts`, Capacitor's headless QuickJS engine) is the only
  place plugins run on the phone. The plugin host (`src/host/host.ts`) runs the enabled ones in
  order, keeps each theatre's last good result if a run fails, and stores everything in the
  runner's key-value store.
- **The app** asks the runner for data with dispatched events (`src/lib/watch.ts`): `refresh` when
  opened (at most hourly) or from Settings, and `state` otherwise. It caches the last answer to
  show instantly on launch.
- **In a desktop browser** (`npm run dev`) there's no runner, so the same host runs in the page.
  Sites are fetched through the dev server's `/proxy`, since they send no CORS headers.

## Background checks

Roughly every 4 hours (`capacitor.config.ts`) the runner runs the plugins in background mode
(no detail requests), keeps a "first seen" map of film keys, and notifies when an unseen film
appears. A theatre's first check only records a baseline. Films found by a refresh in the app
are recorded as seen without an alert.

Android may delay runs (Doze, battery optimisation). Settings' **Force check now** and
**Test notification** buttons trigger the runner immediately for testing.

## Commands

```bash
npm run dev       # browser at http://localhost:5173 (no background runner / notifications)
npm run android   # build web + runner, sync, install and launch on a connected phone
npm run sync      # build + cap sync only (then open/run from Android Studio)
npm run icons     # regenerate the launcher icon from scripts/make-icon.mjs
npm test          # plugin tests (saved fixtures, no network)
npm run plugin    # list theatre plugins; `npm run plugin vic` runs one against the live site
```

## Theatre plugins

Each theatre is a folder in `plugins/`:

```text
plugins/<id>/
├── manifest.json   # name, tag text and colour, domains it may fetch, enabledByDefault
└── index.ts        # export default async function main(ctx) → { films, showtimes }
```

Adding a folder is all it takes: the build lists every folder in a generated module
(`theatrePlugins()` in `plugins/sdk/node.ts`, read by `plugins/sdk/discover.ts`), and fails with a
clear message if one is broken. `npm run plugin:new <id>` scaffolds one. The contract is in
`plugins/sdk/types.ts`.

A folder whose name starts with `_` is **dev-only**: it's included in `npm run dev` and never in a
build. `plugins/_sample/` is a made-up theatre with no network access, covering what the Vic doesn't
(wide and tall images, no image, no seat counts, notes instead of ticket links) for working on the
multi-theatre UI. Turn theatres on and off in Settings → Theatres.

Plugins run in the background runner's QuickJS engine, so they can't use the DOM or Node APIs
(`tsconfig.plugins.json` enforces this). Fetch with `ctx.http` and parse HTML with
`plugins/sdk/html.ts`. Node isn't QuickJS, so test on the phone before relying on a plugin.
