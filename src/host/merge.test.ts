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
  test('from a trailing year in the title, else a year item in meta', () => {
    assert.equal(filmYear(film('a', 'Suspiria (1977)')), 1977);
    assert.equal(filmYear(film('a', 'Suspiria', ['R', 'Horror', '2018', '152 min'])), 2018);
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

  test('different known years stay apart; an unknown year still merges', () => {
    assert.equal(groupFilms([film('a', 'Suspiria 1977'), film('b', 'Suspiria (2018)')]).length, 2);
    assert.equal(groupFilms([film('a', 'Suspiria 1977'), film('b', 'Suspiria')]).length, 1);
  });

  test('never merges two listings from the same theatre', () => {
    const groups = groupFilms([film('a', 'Dune'), film('a', 'Dune'), film('b', 'Dune')]);
    assert.deepEqual(titles(groups), [['a:Dune', 'b:Dune'], ['a:Dune']]);
  });
});
