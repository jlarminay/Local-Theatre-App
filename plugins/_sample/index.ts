// A made-up theatre for developing the multi-theatre UI: dev-only (the "_"
// folder keeps it out of phone builds), no network, and every film exercises
// a case the Vic doesn't — wide and tall images, no image, no seat counts,
// notes instead of ticket links, missing details, a title the Vic also shows.

import type { Film, Main, Showtime } from '../sdk/types.ts';

/** A placeholder poster as an SVG data URI. */
function poster(title: string, width: number, height: number, hue: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},60%,45%)"/><stop offset="1" stop-color="hsl(${hue + 50},60%,22%)"/>` +
    `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>` +
    `<text x="50%" y="50%" fill="white" font-family="sans-serif" font-size="${Math.round(height / 9)}" ` +
    `text-anchor="middle" dominant-baseline="middle">${title}</text>` +
    `<text x="50%" y="88%" fill="white" opacity=".7" font-family="monospace" font-size="${Math.round(height / 18)}" ` +
    `text-anchor="middle">${width}×${height}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Local wall time `days` from today at `time` ("19:30"), e.g. "2026-10-23T19:30:00". */
function at(days: number, time: string): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${time}:00`;
}

const films: Film[] = [
  {
    key: 'wide',
    title: 'The Widescreen Picture',
    url: 'https://example.com/widescreen',
    image: poster('Widescreen', 1600, 900, 200),
    imageAspect: 16 / 9,
    meta: ['Jane Director', 'Canada', '2025', '104 min'],
    synopsis: ['A 16:9 image, like most theatres other than the Vic publish.'],
  },
  {
    key: 'no-image',
    title: 'A Film With No Image or Details',
  },
  {
    key: 'tall',
    title: 'Portrait Poster',
    image: poster('Portrait', 600, 900, 320),
    imageAspect: 2 / 3,
    meta: ['PG', 'Drama'],
    synopsis: ['A classic 2:3 one-sheet poster.', 'With a second paragraph.'],
    flags: ['Members only'],
  },
  {
    key: 'long',
    title:
      'An Extremely Long Film Title That Has To Truncate Gracefully In Day Rows: The Director’s Cut',
    image: poster('Long title', 1280, 720, 30),
    imageAspect: 16 / 9,
  },
  {
    // Also on at the Vic: shows how one film at two theatres looks.
    key: 'crow',
    title: 'Winter of the Crow',
    image: poster('Winter of the Crow', 1600, 900, 260),
    imageAspect: 16 / 9,
    meta: ['PG', 'Drama', '2025', '112 min'],
    synopsis: ['Also at the Vic: combined with its listing, or separate with Combine films off.'],
  },
];

const showtimes: Showtime[] = [
  { filmKey: 'wide', start: at(0, '19:30'), note: 'Tickets at the door' },
  { filmKey: 'wide', start: at(2, '16:00'), note: 'Tickets at the door' },
  { filmKey: 'no-image', start: at(1, '19:30'), bookUrl: 'https://example.com/tickets' },
  { filmKey: 'tall', start: at(1, '21:15'), seatsLeft: 4, bookUrl: 'https://example.com/tickets' },
  { filmKey: 'tall', start: at(3, '19:00'), seatsLeft: 0, soldOut: true },
  { filmKey: 'long', start: at(2, '19:30') },
  { filmKey: 'crow', start: at(4, '19:30'), note: 'Pay what you can' },
];

const main: Main = async () => ({ films, showtimes });

export default main;
