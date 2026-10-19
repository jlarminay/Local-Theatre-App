// Spots the same film listed by more than one theatre, so the app can show it
// once. Deliberately conservative: titles must match exactly after
// normalising case, accents, punctuation, "&"/"and", a leading "The/A/An" and
// a trailing year. Series prefixes ("Fright Fest – Suspiria") are kept, since
// stripping them is where wrong merges come from. Films whose years are both
// known and differ ("Suspiria 1977" vs "Suspiria (2018)") stay apart, and a
// theatre's own listings are never merged with each other.

type Mergeable = { key: string; theatre: string; title: string; meta?: string[] };

const YEAR_ONLY = /^\s*(19\d\d|20\d\d)\s*$/;
const TRAILING_YEAR = /\s*\(?\b(19\d\d|20\d\d)\b\)?\s*$/;

/** The comparable form of a title: "The Rocky Horror Picture Show (1975)" → "rocky horror picture show". */
export function titleKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(TRAILING_YEAR, '')
    .replace(/&/g, ' and ')
    .replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

/** The film's year, from its title or its meta line, if it has one. */
export function filmYear(film: Mergeable): number | null {
  const fromTitle = TRAILING_YEAR.exec(film.title)?.[1];
  if (fromTitle) return Number(fromTitle);
  // Meta lines list the year on its own ("PG · Drama · 2025 · 112 min").
  const fromMeta = film.meta?.find((item) => YEAR_ONLY.test(item));
  return fromMeta ? Number(fromMeta.trim()) : null;
}

/**
 * Groups films that are the same film at different theatres. Each group keeps
 * the input order, and groups are in the order of their first film.
 */
export function groupFilms<F extends Mergeable>(films: F[]): F[][] {
  const groups: { title: string; films: F[]; theatres: Set<string>; year: number | null }[] = [];
  for (const film of films) {
    const title = titleKey(film.title);
    const year = filmYear(film);
    const group = title
      ? groups.find(
          (g) =>
            g.title === title &&
            !g.theatres.has(film.theatre) &&
            (g.year === null || year === null || g.year === year),
        )
      : undefined;
    if (group) {
      group.films.push(film);
      group.theatres.add(film.theatre);
      group.year ??= year;
    } else {
      groups.push({ title, films: [film], theatres: new Set([film.theatre]), year });
    }
  }
  return groups.map((g) => g.films);
}
