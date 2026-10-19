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

## Where the data comes from

- **Showtimes**: the [monthly calendar page](https://www.victoriafilmfestival.com/festival/victoria-film-theatre-monthly-calendar/)
  embeds its events as JSON (`var localObj = '…'`). `src/lib/schedule.ts` extracts it.
- **Posters, synopsis, rating, price**: WooCommerce's public Store API
  (`/wp-json/wc/store/v1/products?include=<ids>`), one request for all films.

The site sends no CORS headers, so the app uses `CapacitorHttp`; `npm run dev` goes through
Vite's `/vic` proxy instead.

## Background checks

`runner/runner.ts` runs in Capacitor Background Runner's headless JS engine roughly every
4 hours (`capacitor.config.ts`). It reuses the parser from `src/lib/schedule.ts`, keeps a
"first seen" map of film ids in its key-value store, and notifies when an unseen film appears.
The first check only records a baseline. Opening the app also marks the current films as seen.

Android may delay runs (Doze, battery optimisation). The footer's **Check now** and
**Test notification** buttons trigger the runner immediately for testing.

## Commands

```bash
npm run dev       # browser at http://localhost:5173 (no background runner / notifications)
npm run android   # build web + runner, sync, install and launch on a connected phone
npm run sync      # build + cap sync only (then open/run from Android Studio)
npm run icons     # regenerate the launcher icon from scripts/make-icon.mjs
```
