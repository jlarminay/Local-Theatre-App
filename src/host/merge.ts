// Spots the same film listed by more than one theatre, so the app can show it
// once. Deliberately conservative: titles must match exactly after
// normalising case, accents, punctuation, "&"/"and", a leading "The/A/An" and
// a trailing year. Series prefixes ("Fright Fest – Suspiria") are kept, since
// stripping them is where wrong merges come from. A theatre's own listings
// are never merged with each other.
//
// Films whose release years (from meta) are both known and more than
// YEAR_SLACK apart stay separate: Suspiria 1977 vs 2018. Years in titles
// don't count, since theatres add the screening year ("Rocky Horror Picture
// Show 2026"), and some get release years slightly wrong (Cinecenta lists The
// Shining as 1978).

type Mergeable = { key: string; theatre: string; title: string; meta?: string[] };

const YEAR_ONLY = /^\s*(19\d\d|20\d\d)\s*$/;
const YEAR_SLACK = 2;
const TRAILING_YEAR = /\s*\(?\b(19\d\d|20\d\d)\b\)?\s*$/;

/** The comparable form of a title: "The Rocky Horror Picture Show (1975)" → "rocky horror picture show". */
export function titleKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(TRAILING_YEAR, '')
    .replace(/&/g, ' and ')
    .replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

/** The film's release year from its meta line ("PG · Drama · 2025 · 112 min"), if listed. */
export function filmYear(film: Mergeable): number | null {
  const year = film.meta?.find((item) => YEAR_ONLY.test(item));
  return year ? Number(year.trim()) : null;
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
            (g.year === null || year === null || Math.abs(g.year - year) <= YEAR_SLACK),
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
