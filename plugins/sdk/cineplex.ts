// Shared by Cineplex theatres (SilverCity, Cineplex Odeon, …): each plugin is
// cineplexPlugin(<locationId>). One request returns every upcoming showing at
// that theatre, with seats remaining, sold out, format (IMAX, UltraAVX, 3D…)
// and a ticket link.
//
// Cineplex has no public API: this is the one its own website uses. It needs
// the subscription key that cineplex.com's own pages send. The key isn't in
// this code: each user enters it in Settings (manifest "keys": "cineplex"),
// and it's kept only on their device. Cineplex's terms allow personal,
// non-commercial use only; keep it that way.
// To find the key: open cineplex.com, and search its scripts for
// "ocpApimSubscriptionKey" (it's the 32-character value next to showtimesApi).
//
// To find a theatre's location id: its cineplex.com page embeds it as
// "theatreId" in the page data (SilverCity Victoria is 1417).

import type { Film, Main, Showtime } from './types.ts';

const API = 'https://apis.cineplex.com/prod/cpx/theatrical/api/v1';
/** The key every Cineplex location's manifest declares in "keys". */
export const CINEPLEX_KEY = 'cineplex';

type ApiSession = {
  vistaSessionId: number;
  /** Theatre-local, "2026-10-19T16:20:00". */
  showStartDateTime: string;
  isInThePast?: boolean;
  isShowtimeEnabledOnline?: boolean;
  seatsRemaining?: number;
  isSoldOut?: boolean;
  ticketingUrl?: string;
};

type ApiMovie = {
  id: number;
  name: string;
  runtimeInMinutes?: number;
  genres?: string[];
  localRating?: string | null;
  detailPageUrl?: string;
  smallPosterImageUrl?: string;
  mediumPosterImageUrl?: string;
  largePosterImageUrl?: string;
  hasPosterImage?: boolean;
  experiences?: { experienceTypes?: string[]; sessions?: ApiSession[] }[];
};

export type ApiShowtimes = { theatreId: number; dates?: { movies?: ApiMovie[] }[] }[];

/** "IMAX · 3D" from a session's experience types; nothing for plain "Regular". */
const formatNote = (types: string[] = []) =>
  types.filter((type) => !/^regular$/i.test(type)).join(' · ') || undefined;

/** Films and showtimes from one theatre's showtimes response. */
export function parseShowtimes(data: ApiShowtimes): { films: Film[]; showtimes: Showtime[] } {
  const films = new Map<string, Film>();
  const showtimes: Showtime[] = [];
  for (const theatre of data)
    for (const date of theatre.dates ?? [])
      for (const movie of date.movies ?? []) {
        const key = String(movie.id);
        if (!films.has(key)) {
          // Cineplex's posters are 3:4 (130×193 is the odd one out, so it's left out).
          const posters =
            movie.hasPosterImage === false
              ? []
              : [
                  [movie.mediumPosterImageUrl, 320],
                  [movie.largePosterImageUrl, 768],
                ].filter((p): p is [string, number] => Boolean(p[0]));
          films.set(key, {
            key,
            title: movie.name.trim(),
            url: movie.detailPageUrl,
            image: posters[posters.length - 1]?.[0],
            imageSrcset: posters.length
              ? posters.map(([url, w]) => `${url} ${w}w`).join(', ')
              : undefined,
            imageAspect: posters.length ? 768 / 1024 : undefined,
            meta: [
              ...(movie.genres ?? []),
              movie.runtimeInMinutes ? `${movie.runtimeInMinutes} min` : '',
              movie.localRating ?? '',
            ].filter(Boolean),
          });
        }
        for (const experience of movie.experiences ?? [])
          for (const session of experience.sessions ?? []) {
            if (session.isInThePast || !session.showStartDateTime) continue;
            showtimes.push({
              filmKey: key,
              start: session.showStartDateTime.slice(0, 19),
              bookUrl: session.isShowtimeEnabledOnline === false ? undefined : session.ticketingUrl,
              seatsLeft: session.seatsRemaining,
              soldOut: Boolean(session.isSoldOut),
              note: formatNote(experience.experienceTypes),
            });
          }
      }
  return { films: [...films.values()], showtimes };
}

/** A whole plugin for one Cineplex theatre, e.g. cineplexPlugin(1417) for SilverCity Victoria. */
export function cineplexPlugin(locationId: number): Main {
  return async (ctx) => {
    const key = ctx.key(CINEPLEX_KEY);
    if (!key) throw new Error('Needs a Cineplex key: add it in Settings.');
    ctx.progress('Reading the showtimes');
    let data: ApiShowtimes;
    try {
      data = await ctx.http.json<ApiShowtimes>(
        `${API}/showtimes?language=en&locationId=${locationId}`,
        { headers: { 'Ocp-Apim-Subscription-Key': key } },
      );
    } catch (err) {
      if (/returned 401/.test(String(err)))
        throw new Error(
          'Cineplex refused the key: it may be wrong, or Cineplex changed it. Check it in Settings.',
        );
      throw err;
    }
    if (!Array.isArray(data)) throw new Error('Cineplex returned no showtimes list.');
    return parseShowtimes(data);
  };
}
