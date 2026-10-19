// Shared by theatres whose sites run on CinemaHosting (cinemahosting.com):
// the Roxy and Capitol 6. The homepage's footer lists every film ("Now
// Showing" and "Coming Soon"), and each film's page has its details and every
// showtime, each with a ticket link (formovietickets.com). Dates have no year
// ("Oct 19"), so the year is worked out from today.

import { decodeEntities, textOf } from './html.ts';
import type { Film, Main, Showtime } from './types.ts';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** A date this far in the past is next year's ("Jan 9" listed in October). */
const PAST_GRACE_DAYS = 60;

/** Every film the homepage links to: its page's slug and title. */
export function parseFilmList(html: string): { slug: string; title: string }[] {
  const films = new Map<string, string>();
  for (const [, slug, text] of html.matchAll(/<a href="\/movie\/([^"]+)">([^<]+)<\/a>/g)) {
    const title = textOf(text);
    if (slug !== 'releaseDate' && title && !films.has(slug)) films.set(slug, title);
  }
  return [...films].map(([slug, title]) => ({ slug, title }));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "Oct 19" → "2026-10-19", in the year that makes it upcoming. */
export function parseDate(text: string, now = new Date()): string | null {
  const m = /^([A-Za-z]{3})\w*\s+(\d{1,2})$/.exec(text.trim());
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  if (!m || month < 0) return null;
  const day = Number(m[2]);
  let year = now.getFullYear();
  if (new Date(year, month, day).getTime() < now.getTime() - PAST_GRACE_DAYS * 86_400_000) year++;
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** "7:00p" → "19:00", "11:30a" → "11:30", "12:15p" → "12:15". */
export function parseTime(text: string): string | null {
  const m = /^(\d{1,2}):(\d{2})\s*([ap])/i.exec(text.trim());
  if (!m) return null;
  const hour = (Number(m[1]) % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
  return `${pad(hour)}:${m[2]}`;
}

export type FilmPage = Omit<Film, 'key' | 'title'> & {
  showtimes: Omit<Showtime, 'filmKey'>[];
};

/** A film's page: details from its description, and every showing. */
export function parseFilmPage(html: string, now = new Date()): FilmPage {
  // Showtimes: one block per day, its date then its times (each a ticket link).
  const showtimes: FilmPage['showtimes'] = [];
  const list = html.slice(html.indexOf('class="showtimes detail'));
  for (const block of list.split('class="listitem').slice(1)) {
    const date = /<span class="date" >([^<]+)<\/span>/.exec(block)?.[1];
    const day = date && parseDate(date, now);
    if (!day) continue;
    for (const [, href, text] of block.matchAll(/<a href='([^']+)'[^>]*>([^<]+)<\/a>/g)) {
      const time = parseTime(text);
      if (time) showtimes.push({ start: `${day}T${time}:00`, bookUrl: decodeEntities(href) });
    }
  }

  // The description: paragraphs, then "CAST: …", "DIRECTOR: …", "RUN TIME: …" lines.
  const snippet = /<p class="snippet" >([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '';
  const image = /<img[^>]*src="(https:\/\/img\.cnmhstng\.com\/images\/[^"]+)"/.exec(snippet)?.[1];
  const labelled: Record<string, string> = {};
  const synopsis: string[] = [];
  for (const part of snippet.split(/(?:<br\s*\/?>\s*){2,}/i)) {
    const text = textOf(part.replace(/<br\s*\/?>/gi, ' '));
    const field = /^(CAST|DIRECTOR|RUN TIME):\s*(.+)$/i.exec(text);
    if (field) labelled[field[1].toUpperCase()] = field[2];
    else if (text) synopsis.push(text);
  }
  if (labelled.CAST) synopsis.push(`Cast: ${labelled.CAST}`);

  const infocons = /<div class="infocons[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  const rating = [...infocons.matchAll(/<span class="rating[^"]*"[^>]*>([^<]+)<\/span>/g)]
    .map((m) => textOf(m[1]))
    .find((text) => text && !/min$/i.test(text));

  return {
    image,
    // The site's posters are 200×296.
    imageAspect: image ? 200 / 296 : undefined,
    meta: [labelled.DIRECTOR, labelled['RUN TIME'], rating].filter((item): item is string =>
      Boolean(item),
    ),
    synopsis,
    director: labelled.DIRECTOR,
    showtimes,
  };
}

/** A whole plugin for a CinemaHosting site, e.g. cinemaHostingPlugin('https://www.roxyvictoria.ca'). */
export function cinemaHostingPlugin(site: string): Main {
  return async (ctx) => {
    ctx.progress('Reading the film list');
    const list = parseFilmList(await ctx.http.text(`${site}/`));
    if (!list.length)
      throw new Error('No films found on the homepage — the site layout may have changed.');

    const films: Film[] = [];
    const showtimes: Showtime[] = [];
    for (const [i, { slug, title }] of list.entries()) {
      ctx.progress(`Read ${title}`, i, list.length);
      try {
        const page = parseFilmPage(await ctx.http.text(`${site}/movie/${slug}`));
        const { showtimes: shows, ...details } = page;
        films.push({ key: slug, title, url: `${site}/movie/${slug}`, ...details });
        for (const show of shows) showtimes.push({ ...show, filmKey: slug });
      } catch (err) {
        ctx.log(`"${title}" unavailable:`, err);
      }
    }
    ctx.progress('Read all films', list.length, list.length);
    return { films, showtimes };
  };
}
