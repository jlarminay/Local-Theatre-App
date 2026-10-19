// Cinecenta, at UVic. Showtimes come from The Events Calendar's public
// REST API: one event per showing, with no film id, so showings are grouped
// into films by title. The API has no film details, so those come from one
// event page per film, cached in the store and refreshed every few days
// (ticket links can appear after a film is first listed). Background checks
// fetch pages only for films that have no details yet.

import { decodeEntities, textOf, textsOf } from '../sdk/html.ts';
import type { Ctx, Film, Main, Showtime } from '../sdk/types.ts';

const SITE = 'https://www.cinecenta.com';
const DETAILS_KEY = 'details';
/** Details older than this are fetched again, a few films per refresh. */
const DETAILS_MAX_AGE_MS = 3 * 86_400_000;
const STALE_REFRESHES_PER_RUN = 2;
/** Event pages fetched at once. */
const CONCURRENCY = 6;
// The site is slow (~5 s a page, and the phone's runner fetches one at a time),
// so the manifest gives it a long timeout. A batch only starts if it should end
// this long before the host's deadline (judged by the previous batch); leftover
// films are marked detailsPending and fetched on a later run.
const DEADLINE_MARGIN_MS = 15_000;
const MAX_PAGES = 10;

type ApiImage = {
  url: string;
  width: number;
  height: number;
  sizes?: Record<string, { url: string; width: number; height: number }>;
};

type ApiEvent = {
  id: number;
  title: string;
  /** "2026-10-23 17:00:00", Vancouver local time. */
  start_date: string;
  url: string;
  image?: ApiImage | false;
};

type ApiPage = { events?: ApiEvent[]; next_rest_url?: string };

/** What an event page adds to a film. */
export type Details = Pick<Film, 'meta' | 'synopsis' | 'director'> & {
  /** Online ticket link, when the event sells them (Eventbrite etc.). */
  bookUrl?: string;
  /** True when the page says there are no online sales (pay at the door). */
  atTheDoor: boolean;
};

type Cached = { at: number; details: Details };

/** "The Room – Presented by Greg Sestero" → "the-room-presented-by-greg-sestero". */
export function filmKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Every upcoming showing, following the API's pages. */
async function fetchEvents(ctx: Ctx): Promise<ApiEvent[]> {
  const events: ApiEvent[] = [];
  let url: string | undefined =
    `${SITE}/wp-json/tribe/events/v1/events?per_page=50&start_date=${today()}`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    ctx.progress(page ? `Reading the events list (page ${page + 1})` : 'Reading the events list');
    const data: ApiPage = await ctx.http.json<ApiPage>(url);
    if (!Array.isArray(data.events)) throw new Error('Events API returned no events list.');
    events.push(...data.events);
    url = data.next_rest_url;
  }
  return events;
}

/** The image and a srcset of its same-shaped sizes (the API also lists square and banner crops). */
function imageOf(
  image: ApiImage | false | undefined,
): Pick<Film, 'image' | 'imageSrcset' | 'imageAspect'> {
  if (!image || !image.url) return {};
  const aspect = image.width && image.height ? image.width / image.height : undefined;
  const sizes = Object.values(image.sizes ?? {}).filter(
    (size) =>
      aspect &&
      size.width &&
      size.height &&
      Math.abs(size.width / size.height - aspect) < 0.02 * aspect,
  );
  const srcset = [...sizes, image]
    .sort((a, b) => a.width - b.width)
    .filter((size, i, all) => i === 0 || size.width !== all[i - 1].width)
    .map((size) => `${size.url} ${size.width}w`)
    .join(', ');
  return { image: image.url, imageSrcset: srcset || undefined, imageAspect: aspect };
}

/** The first element with this class: its inner HTML (not for nested same-name tags). */
function byClass(html: string, tag: string, className: string): string | undefined {
  const pattern = new RegExp(
    `<${tag}\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)</${tag}>`,
    'i',
  );
  return pattern.exec(html)?.[1];
}

/** "Label: value" from the details box, e.g. <span class="rating"><strong>Rating: </strong>PG</span>. */
const labelled = (html: string, className: string) =>
  textOf(byClass(html, 'span', className) ?? '').replace(/^[^:]+:\s*/, '') || undefined;

export function parseEventPage(html: string): Details {
  const metaHtml = byClass(html, 'div', 'movie-meta') ?? '';
  const runtime = textOf(byClass(metaHtml, 'span', 'runtime') ?? '').replace(
    /^(\d+)\s*min$/,
    '$1 min',
  );
  const meta = [
    textOf(byClass(metaHtml, 'span', 'director') ?? ''),
    textOf(byClass(metaHtml, 'span', 'country') ?? ''),
    textOf(byClass(metaHtml, 'span', 'year') ?? ''),
    runtime,
    labelled(html, 'rating'),
    labelled(html, 'language'),
  ].filter((item): item is string => Boolean(item));

  // The synopsis, without the review quotes in <blockquote>s. Credits sit in
  // bold right after the text ("…found.<b>-Film Threat</b>"), so bold and
  // italics get a space before them.
  const synopsisHtml = (byClass(html, 'div', 'synopsis-content') ?? '')
    .replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi, '')
    .replace(/<(b|strong|i|em)\b/gi, ' <$1');
  const synopsis = textsOf(synopsisHtml, 'p');
  const cast = labelled(html, 'cast');
  if (cast) synopsis.push(`Cast: ${cast}`);

  const tickets = /<div class="tickets-container"[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? '';
  const bookUrl = /<a\b[^>]*class="[^"]*tickets-button[^"]*"[^>]*href="([^"]+)"/i.exec(
    tickets,
  )?.[1];
  return {
    meta,
    synopsis,
    director: textOf(byClass(metaHtml, 'span', 'director') ?? '') || undefined,
    bookUrl: bookUrl ? decodeEntities(bookUrl) : undefined,
    atTheDoor: /no online ticket sales/i.test(tickets),
  };
}

/**
 * Runs `work` over `items`, a few at a time. A batch only starts if, taking as
 * long as the last one did, it would still end before `deadline`.
 */
async function inBatches<T>(items: T[], deadline: number, work: (item: T) => Promise<void>) {
  let lastBatchMs = 0;
  for (let i = 0; i < items.length && Date.now() + lastBatchMs < deadline; i += CONCURRENCY) {
    const batchStarted = Date.now();
    await Promise.all(items.slice(i, i + CONCURRENCY).map(work));
    lastBatchMs = Date.now() - batchStarted;
  }
}

const main: Main = async (ctx) => {
  const events = (await fetchEvents(ctx)).filter((event) => event.title && event.start_date);

  // One film per title; its first event supplies the image and the page to read.
  const films = new Map<string, { title: string; first: ApiEvent; events: ApiEvent[] }>();
  for (const event of events) {
    const title = decodeEntities(event.title).replace(/\s+/g, ' ').trim();
    const key = filmKey(title);
    if (!key) continue;
    const film = films.get(key) ?? { title, first: event, events: [] };
    film.events.push(event);
    films.set(key, film);
  }

  const cache = ctx.store.get<Record<string, Cached>>(DETAILS_KEY) ?? {};
  // Films with no details yet are fetched on every run, background checks
  // included, so leftovers fill in without waiting for the app; refreshing
  // stale details is left to the app's (foreground) refreshes.
  {
    const now = Date.now();
    const missing = [...films.keys()].filter((key) => !cache[key]);
    const stale =
      ctx.mode === 'foreground'
        ? [...films.keys()]
            .filter((key) => cache[key] && now - cache[key].at > DETAILS_MAX_AGE_MS)
            .sort((a, b) => cache[a].at - cache[b].at)
            .slice(0, STALE_REFRESHES_PER_RUN)
        : [];
    const toFetch = [...missing, ...stale];
    let fetched = 0;
    if (toFetch.length) ctx.progress('Fetching film details', 0, toFetch.length);
    await inBatches(toFetch, ctx.deadline - DEADLINE_MARGIN_MS, async (key) => {
      try {
        cache[key] = {
          at: now,
          details: parseEventPage(await ctx.http.text(films.get(key)!.first.url)),
        };
      } catch (err) {
        ctx.log(`Details for "${films.get(key)!.title}" unavailable:`, err);
      }
      ctx.progress(`Read ${films.get(key)!.title}`, ++fetched, toFetch.length);
    });
  }
  // Keep only current films, so the store doesn't grow forever.
  ctx.store.set(
    DETAILS_KEY,
    Object.fromEntries(
      [...films.keys()].filter((key) => cache[key]).map((key) => [key, cache[key]]),
    ),
  );

  const resultFilms: Film[] = [];
  const showtimes: Showtime[] = [];
  for (const [key, film] of films) {
    const details = cache[key]?.details;
    resultFilms.push({
      key,
      title: film.title,
      url: film.first.url,
      ...imageOf(film.first.image),
      meta: details?.meta,
      synopsis: details?.synopsis,
      director: details?.director,
      // Fetched on a later refresh (time budget, or a page that failed).
      ...(details ? {} : { detailsPending: true }),
    });
    for (const event of film.events)
      showtimes.push({
        filmKey: key,
        start: event.start_date.replace(' ', 'T'),
        ...(details?.bookUrl
          ? { bookUrl: details.bookUrl }
          : details?.atTheDoor
            ? { note: 'Tickets at the door' }
            : {}),
      });
  }
  return { films: resultFilms, showtimes };
};

export default main;
