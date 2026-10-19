# Local Theatre

A personal Android app (Vue + TypeScript + Capacitor) that shows local cinemas' schedules in one
readable place and sends a notification when a new film is added. Each cinema is a plugin; the
Vic (Victoria Film Theatre), Cinecenta, the Roxy, Capitol 6 and SilverCity Victoria are built in.

> **Disclaimer:** This is an unofficial personal project. It is not affiliated with, endorsed by,
> or connected to any of the theatres it lists or the organisations that run them (the Victoria
> Film Festival, the UVic Students’ Society), or The Movie Database. All theatre names, logos,
> film titles, posters and descriptions belong to their respective owners, the film studios,
> distributors and rights holders. The app reads publicly available information from the theatres'
> websites and does not redistribute it.
>
> This code is shared for reference only, for personal and non-commercial use. It is provided
> "as is", without warranty of any kind. Use it at your own risk; the author is not liable for
> any damages or issues arising from its use. All rights reserved.

## How it works

- **Theatre plugins** (`plugins/<id>/`, see below) fetch and parse each theatre's site. The Vic's
  showtimes come from its [monthly calendar page](https://www.victoriafilmfestival.com/festival/victoria-film-theatre-monthly-calendar/),
  which embeds its events as JSON, and its posters and synopses from WooCommerce's public Store
  API, in one request for all films. Cinecenta's showtimes come from The Events Calendar's public
  REST API, and its details from one event page per film (cached, refreshed every few days).
  The Roxy and Capitol 6 both run on CinemaHosting (`plugins/sdk/cinemahosting.ts`): the
  homepage lists every film, and each film's page has its details and showtimes. Cineplex theatres
  (`plugins/sdk/cineplex.ts`, one plugin per location id) use the API cineplex.com's own pages
  use, which needs the key those pages send: each user enters it in Settings, and it's never in
  the code. Cineplex's terms allow personal, non-commercial use only.
- **The background runner** (`runner/runner.ts`, Capacitor's headless QuickJS engine) is the only
  place plugins run on the phone. The plugin host (`src/host/host.ts`) runs the enabled ones in
  order, keeps each theatre's last good result if a run fails, and stores everything in the
  runner's key-value store.
- **The app** asks the runner for data with dispatched events (`src/lib/watch.ts`): `refresh` when
  opened (at most hourly) or from Settings, and `state` otherwise. It caches the last answer to
  show instantly on launch.
- **Combining:** a film on at several theatres is shown once (`src/host/merge.ts`): titles must
  match after normalising, and after cutting each theatre's `titleExtras`; release years far apart
  keep them separate. Settings → Combine films turns it off.
- **In a desktop browser** (`npm run dev`) there's no runner, so the same host runs in the page.
  Sites are fetched through the dev server's `/proxy`, since they send no CORS headers.

## Posters (The Movie Database)

With a TMDB key entered in Settings (each user brings their own free key; it's stored only on the
device), the app shows TMDB posters in the film grid and TMDB backdrops as film page banners
(`src/composables/usePosters.ts`, `src/lib/tmdb.ts`). Lookups run in the app, not the runner,
once per film, and are cached on the device; a miss is retried after a week. A match also fills
gaps in the theatre's listing (release year, runtime, genres, or an overview when there's no
description), never replacing what the theatre gave.

- **Matching:** the title is searched with each theatre's `titleExtras` cut out first, then a few
  guesses (each side of a dash or colon). A result needs the same title (or the part after a colon,
  when the years agree) and a release year within two years; the most-voted wins, unless the
  plugin gave a `director` and another candidate's credits match it.
- **Per theatre:** a plugin can opt out with `"posterSource": "theatre"`, and users can choose
  "Use own images" in a theatre's (i).
- **Fix:** on a film's page, pick the right TMDB film by hand when the match is wrong, or use the
  theatre's image. The choice is kept and never looked up again.

## Background checks

Android wakes the runner every hour (`capacitor.config.ts`); it runs a check only when the rate
chosen in Settings is due (every 1, 3, 6, 12 or 24 hours, or never; `src/host/checks.ts`). A check
runs the plugins in background mode (no detail requests), keeps a "first seen" map of film keys,
and notifies when an unseen film appears. A theatre's first check only records a baseline. Films
found by a refresh in the app are recorded as seen without an alert.

Android may delay runs (Doze, battery optimisation). Settings' **Force check now** and
**Test notification** buttons trigger the runner immediately for testing.

## Commands

```bash
npm run dev       # browser at http://localhost:5173 (no background runner / notifications)
npm run android   # build web + runner, sync, install and launch on a connected phone
npm run sync      # build + cap sync only (then open/run from Android Studio)
npm run icons     # regenerate the icons from scripts/make-icon.mjs
npm test          # plugin, host and TMDB-matching tests (saved fixtures, no network)
npm run plugin    # list theatre plugins; `npm run plugin vic` runs one against the live site
npm run key-qr    # show a TMDB key as a QR code in the terminal, to scan into the phone app
```

## Theatre plugins

Each theatre is a folder in `plugins/`:

```text
plugins/<id>/
├── manifest.json   # name, tag text and colour, domains it may fetch, enabledByDefault, …
└── index.ts        # export default async function main(ctx) → { films, showtimes }
```

Adding a folder is all it takes: the build lists every folder in a generated module
(`theatrePlugins()` in `plugins/sdk/node.ts`, read by `plugins/sdk/discover.ts`), and fails with a
clear message if one is broken. `npm run plugin:new <id>` scaffolds one. The contract is in
`plugins/sdk/types.ts`, and `plugins/sdk/manifest.schema.json` gives autocomplete in the manifest.

Optional manifest fields worth knowing:

- `owner`: who runs the theatre, named in the About disclaimer.
- `titleExtras`: event wording in the theatre's titles (`"Fright Fest"`, `"Director's Cut"`), cut
  out for poster lookups and combining. A trailing `*` cuts everything after (`"w/*"`).
- `posterSource`: `"theatre"` to keep the theatre's own images instead of TMDB posters.
- `keys`: keys the user must enter in Settings (kept only on the device), read with
  `ctx.key(name)`. Plugins sharing a key use the same `name`. For `npm run plugin`, pass them as
  `PLUGIN_KEY_<NAME>=… npm run plugin <id>`.

A folder whose name starts with `_` is **dev-only**: it's included in `npm run dev` and never in a
build, e.g. a made-up theatre with static data for working on the UI. Turn theatres on and off in
Settings → Theatres.

Plugins run in the background runner's QuickJS engine, so they can't use the DOM or Node APIs
(`tsconfig.plugins.json` enforces this). Fetch with `ctx.http` and parse HTML with
`plugins/sdk/html.ts`. Node isn't QuickJS, so test on the phone before relying on a plugin.
