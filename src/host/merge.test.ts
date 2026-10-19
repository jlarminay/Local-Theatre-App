import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { filmYear, groupFilms, titleKey } from './merge.ts';

const film = (theatre: string, title: string, meta?: string[]) => ({
  key: `${theatre}:${title}`,
  theatre,
  title,
  meta,
});
const titles = (groups: { theatre: string; title: string }[][]) =>
  groups.map((g) => g.map((f) => `${f.theatre}:${f.title}`));

describe('titleKey', () => {
  test('ignores case, accents, punctuation, a leading article and a trailing year', () => {
    assert.equal(titleKey('The Rocky Horror Picture Show (1975)'), 'rocky horror picture show');
    assert.equal(titleKey('Rocky Horror Picture Show 2026'), 'rocky horror picture show');
    assert.equal(titleKey('Filipiñana'), 'filipinana');
    assert.equal(titleKey('Harold & Maude'), titleKey('Harold and Maude'));
    assert.equal(titleKey('Breaking Dawn – Part 1'), titleKey('Breaking Dawn - Part 1'));
    assert.equal(titleKey('Director’s Cut'), titleKey("Director's Cut"));
  });

  test('keeps series prefixes, so they never match the plain title', () => {
    assert.notEqual(titleKey('Fright Fest – Suspiria 1977'), titleKey('Suspiria'));
  });
});

describe('filmYear', () => {
  test('a year item in meta; titles don’t count (theatres add the screening year)', () => {
    assert.equal(filmYear(film('a', 'Suspiria', ['R', 'Horror', '2018', '152 min'])), 2018);
    assert.equal(filmYear(film('a', 'Rocky Horror Picture Show 2026')), null);
    assert.equal(filmYear(film('a', 'Suspiria', ['R', '152 min'])), null);
  });
});

describe('groupFilms', () => {
  test('merges the same film across theatres, in order', () => {
    const groups = groupFilms([
      film('vic', 'Winter of the Crow', ['PG', 'Drama', '2025']),
      film('vic', 'History of Concrete'),
      film('cc', 'Winter of the Crow', ['2025', '112 min']),
    ]);
    assert.deepEqual(titles(groups), [
      ['vic:Winter of the Crow', 'cc:Winter of the Crow'],
      ['vic:History of Concrete'],
    ]);
  });

  test('release years far apart stay separate; close or unknown years merge', () => {
    const suspiria = (theatre: string, year: string) => film(theatre, 'Suspiria', [year]);
    assert.equal(groupFilms([suspiria('a', '1977'), suspiria('b', '2018')]).length, 2);
    assert.equal(groupFilms([suspiria('a', '1980'), suspiria('b', '1978')]).length, 1);
    assert.equal(groupFilms([film('a', 'Suspiria 1977'), film('b', 'Suspiria')]).length, 1);
    // The Vic's screening-year title vs Cinecenta's (slightly wrong) release year.
    const rocky = groupFilms([
      film('vic', 'Rocky Horror Picture Show 2026', ['18A', '1975', '100 min']),
      film('cc', 'The Rocky Horror Picture Show', ['Jim Sharman', '1974', '100 min']),
    ]);
    assert.equal(rocky.length, 1);
  });

  test('a theatre’s titleExtras are cut before comparing', () => {
    const extras = (f: { theatre: string }) => (f.theatre === 'vic' ? ['Fright Fest'] : []);
    const groups = groupFilms(
      [film('vic', 'Fright Fest – Suspiria 1977', ['1977']), film('cc', 'Suspiria', ['1977'])],
      extras,
    );
    assert.equal(groups.length, 1);
    // Without them, the prefix keeps them apart.
    assert.equal(
      groupFilms([film('vic', 'Fright Fest – Suspiria 1977'), film('cc', 'Suspiria')]).length,
      2,
    );
  });

  test('never merges two listings from the same theatre', () => {
    const groups = groupFilms([film('a', 'Dune'), film('a', 'Dune'), film('b', 'Dune')]);
    assert.deepEqual(titles(groups), [['a:Dune', 'b:Dune'], ['a:Dune']]);
  });
});
