// The contract between the app and a theatre plugin. A plugin is a folder in
// plugins/ with a manifest.json and an index.ts whose default export is a Main.
//
// Plugins run in the background runner's QuickJS engine: no DOM, no
// DOMParser, no Node APIs. Use ctx.http for requests and the helpers in
// sdk/html.ts for HTML.

export const API_VERSION = 1;

export interface Manifest {
  /** Folder name, and the prefix of the app-wide film keys ("vic:385117"). */
  id: string;
  /** Full name, e.g. "The Vic". */
  name: string;
  /** Tag text, e.g. "VIC". */
  shortName: string;
  /** Tag colour, "#rrggbb". */
  color: string;
  version: string;
  /** Who wrote the plugin, shown in the theatre's info in Settings. */
  author?: string;
  /** When the plugin last changed, "YYYY-MM-DD". */
  updated?: string;
  apiVersion: typeof API_VERSION;
  /** Linked from Settings ("Data from"). */
  homepage: string;
  /** Who runs the theatre, if not obvious from its name; named in the About disclaimer. */
  owner?: string;
  /** Hosts ctx.http may fetch. */
  domains: string[];
  /**
   * Posters: when the user has a TMDB key, the app shows The Movie Database's
   * posters for every theatre ("database", the default). "theatre" opts this
   * plugin out, e.g. when its own artwork is better. Users can also choose
   * "Use own images" per theatre.
   */
  posterSource?: 'theatre' | 'database';
  /**
   * Event wording in this theatre's titles, cut out when looking films up on
   * The Movie Database: series names ("Fright Fest"), version notes
   * ("Director's Cut"). A trailing "*" also cuts everything after ("w/*" for
   * "w/ Q&A"). Curly and straight apostrophes are treated alike.
   */
  titleExtras?: string[];
  /**
   * How long a run may take before the host stops it, in seconds (default 60,
   * max 300). For slow sites; the user waits on in-app refreshes, so keep it modest.
   */
  timeoutSeconds?: number;
  /** Whether it's switched on for a fresh install. Default true. */
  enabledByDefault?: boolean;
}

export interface Ctx {
  http: {
    /** GET, resolving to the body. Rejects on a non-2xx status or a host not in `domains`. */
    text(url: string): Promise<string>;
    json<T = unknown>(url: string): Promise<T>;
  };
  /** Small per-plugin storage kept between runs (JSON values only). */
  store: {
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown): void;
  };
  /**
   * 'background' is the periodic new-film check: return what you can from
   * `store` and skip detail requests. 'foreground' is a refresh the user sees.
   */
  mode: 'foreground' | 'background';
  log(...args: unknown[]): void;
  /**
   * What the plugin is doing now, shown in the app's refresh progress window,
   * e.g. progress('Reading the calendar') or progress('Fetching film details', 3, 12).
   * Optional to call; cheap enough to call per item.
   */
  progress(step: string, done?: number, total?: number): void;
  /** When the host will stop this run (epoch ms): budget slow work against it. */
  deadline: number;
}

export interface Film {
  /** Unique within the plugin. The host prefixes "<id>:". */
  key: string;
  title: string;
  /** The film's page on the theatre's site. */
  url?: string;
  image?: string;
  imageSrcset?: string;
  /** Width / height: 1 = square, 16/9 = wide. */
  imageAspect?: number;
  /** Short facts shown on one line: "PG", "Documentary", "2026", "102 min". */
  meta?: string[];
  synopsis?: string[];
  /** Highlighted notes, e.g. "Membership required". */
  flags?: string[];
  /**
   * True while the plugin hasn't fetched this film's details yet but will on
   * a later refresh (e.g. a time budget ran out). The app holds poster
   * lookups until then, since the details carry the release year.
   */
  detailsPending?: boolean;
}

export interface Showtime {
  filmKey: string;
  /** Theatre-local wall time with no offset, "2026-10-23T19:30:00". */
  start: string;
  bookUrl?: string;
  /** Omit when the theatre doesn't publish it. */
  seatsLeft?: number;
  soldOut?: boolean;
  /** Shown instead of a ticket link, e.g. "Tickets at the door". */
  note?: string;
}

export interface ScrapeResult {
  films: Film[];
  showtimes: Showtime[];
}

/** The default export of a plugin's index.ts. */
export type Main = (ctx: Ctx) => Promise<ScrapeResult>;
