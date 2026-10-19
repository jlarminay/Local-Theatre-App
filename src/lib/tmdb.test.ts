import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  backdropImages,
  checkKey,
  directorNames,
  fetchDetails,
  fillFromTmdb,
  findMovie,
  pickMovie,
  posterImages,
  posterQueries,
  stripExtras,
  type TmdbMovie,
} from './tmdb.ts';

const movie = (title: string, year: string, extra: Partial<TmdbMovie> = {}): TmdbMovie => ({
  id: Math.floor(Math.random() * 1e6),
  title,
  release_date: `${year}-01-01`,
  poster_path: `/${title.replace(/\W/g, '')}-${year}.jpg`,
  popularity: 1,
  ...extra,
});

describe('posterQueries', () => {
  test('strips event wording and tries both sides of a dash or colon', () => {
    assert.deepEqual(posterQueries('Fright Fest – Suspiria 1977'), [
      'Fright Fest – Suspiria',
      'Suspiria',
      'Fright Fest',
    ]);
    assert.deepEqual(posterQueries('The Room – Presented by Greg Sestero'), [
      'The Room – Presented by Greg Sestero',
      'Presented by Greg Sestero',
      'The Room',
    ]);
    assert.deepEqual(posterQueries('Mid/Evil Times w/ Q&A – DUFF'), ['Mid/Evil Times']);
    assert.deepEqual(posterQueries('Conan The Barbarian (CAMP! Series)'), ['Conan The Barbarian']);
    assert.deepEqual(posterQueries('Retromania: Manhunter'), [
      'Retromania: Manhunter',
      'Manhunter',
    ]);
    assert.deepEqual(posterQueries('Winter of the Crow'), ['Winter of the Crow']);
  });
});

describe('stripExtras (manifest titleExtras)', () => {
  const vic = ['Fright Fest', 'Retromania', 'CAMP! Series', "Director's Cut"];
  const cinecenta = ['DUFF', 'w/*', 'Presented by*'];
  test('cuts the theatre’s event wording and tidies separators', () => {
    assert.equal(
      stripExtras('Fright Fest – The Exorcist Director’s Cut 1973', vic),
      'The Exorcist 1973',
    );
    assert.equal(stripExtras('Fright Fest – Halloween 1978', vic), 'Halloween 1978');
    assert.equal(stripExtras('Retromania: Manhunter', vic), 'Manhunter');
    assert.equal(stripExtras('Conan The Barbarian (CAMP! Series)', vic), 'Conan The Barbarian');
    assert.equal(
      stripExtras('Castration: Movie Chapter 3 w/ Q&A – DUFF', cinecenta),
      'Castration: Movie Chapter 3',
    );
    assert.equal(stripExtras('The Room – Presented by Greg Sestero', cinecenta), 'The Room');
    assert.equal(stripExtras('Toronto Apartment – DUFF', cinecenta), 'Toronto Apartment');
    assert.equal(stripExtras('V for Vendetta (2026 Re-release)', ['Re-release']), 'V for Vendetta');
    assert.equal(
      stripExtras('Spirited Away - Studio Ghibli Fest (Subtitled)', ['Studio Ghibli Fest']),
      'Spirited Away (Subtitled)',
    );
  });

  test('whole words only, and the stripped title is searched first', () => {
    assert.equal(stripExtras('Duffy', ['DUFF']), 'Duffy');
    assert.equal(
      posterQueries('Fright Fest – The Exorcist Director’s Cut 1973', vic)[0],
      'The Exorcist',
    );
  });
});

describe('pickMovie', () => {
  test('needs an exact title; prefers the closest year, then popularity', () => {
    const results = [
      movie('Suspiria', '2018', { popularity: 50 }),
      movie('Suspiria', '1977', { popularity: 20 }),
      movie('Suspiria: The Making Of', '1977'),
    ];
    assert.equal(pickMovie(results, 'Suspiria', 1977)?.release_date, '1977-01-01');
    assert.equal(pickMovie(results, 'Suspiria', null)?.release_date, '2018-01-01');
    assert.equal(pickMovie(results, 'Suspiria', 1950), null);
    assert.equal(pickMovie(results, 'Suspiria Remastered', null), null);
  });

  test('allows a slightly wrong year (Cinecenta lists The Shining as 1978)', () => {
    assert.ok(pickMovie([movie('The Shining', '1980')], 'The Shining', 1978));
  });

  test('the most-voted film wins, not the closest year (an obscure 1978 "The Shining")', () => {
    const results = [
      movie('The Shining', '1978', { vote_count: 3, popularity: 2 }),
      movie('The Shining', '1980', { vote_count: 17000, popularity: 40 }),
    ];
    assert.equal(pickMovie(results, 'The Shining', 1978)?.release_date, '1980-01-01');
  });

  test('matches the title after a colon, only when the years agree', () => {
    const results = [
      movie('The Return of the King', '1980', { vote_count: 300 }),
      movie('The Lord of the Rings: The Return of the King', '2003', { vote_count: 25000 }),
    ];
    assert.equal(pickMovie(results, 'The Return of the King', 2004)?.release_date, '2003-01-01');
    // No year: only exact titles count.
    assert.equal(pickMovie(results, 'The Return of the King', null)?.release_date, '1980-01-01');
  });

  test('skips results without a poster', () => {
    assert.equal(pickMovie([movie('Dune', '2021', { poster_path: null })], 'Dune', 2021), null);
  });
});

describe('findMovie', () => {
  test('tries queries in order until one matches, with the key in the right place', async () => {
    const urls: string[] = [];
    const get = async (url: string, headers: Record<string, string>) => {
      urls.push(url);
      assert.equal(headers.Authorization, 'Bearer eyJtoken');
      const query = new URL(url).searchParams.get('query');
      const results =
        query === 'Suspiria' ? [movie('Suspiria', '1977', { backdrop_path: '/still.jpg' })] : [];
      return { status: 200, text: JSON.stringify({ results }) };
    };
    const found = await findMovie(get, 'eyJtoken', 'Fright Fest – Suspiria 1977', 1977);
    assert.equal(found?.poster, '/Suspiria-1977.jpg');
    assert.equal(found?.backdrop, '/still.jpg');
    assert.equal(typeof found?.id, 'number');
    assert.equal(urls.length, 2);
  });

  test('a v3 key goes in the URL; a rejected key is an error', async () => {
    const get = async (url: string) => {
      assert.match(url, /api_key=abc123/);
      return { status: 401, text: '' };
    };
    await assert.rejects(findMovie(get, 'abc123', 'Dune', null), /rejected the API key/);
  });

  test('nothing matching gives null', async () => {
    const get = async () => ({ status: 200, text: '{"results":[]}' });
    assert.equal(await findMovie(get, 'k', 'Toronto Apartment – DUFF', 2026), null);
  });
});

test('posterImages', () => {
  const images = posterImages('/x.jpg');
  assert.equal(images.image, 'https://image.tmdb.org/t/p/w342/x.jpg');
  assert.equal(images.imageAspect, 2 / 3);
  assert.equal(images.imageSrcset.split(', ').length, 3);
  assert.equal(backdropImages('/b.jpg').imageAspect, 16 / 9);
});

describe('checkKey', () => {
  test('accepts a working key, rejects a refused one', async () => {
    await checkKey(async () => ({ status: 200, text: '{}' }), 'eyJgood');
    await assert.rejects(
      checkKey(async () => ({ status: 401, text: '' }), 'bad'),
      /rejected this key/,
    );
  });
});

describe('director matching', () => {
  const fatherland = [
    movie('Fatherland', '1994', { id: 1, vote_count: 200 }),
    movie('Fatherland', '2026', { id: 2, vote_count: 4 }),
  ];
  const credits: Record<number, string> = { 1: 'Christopher Menaul', 2: 'Pawel Pawlikowski' };
  function fakeGet(results: TmdbMovie[]) {
    const urls: string[] = [];
    const get = async (url: string) => {
      urls.push(url);
      const id = /\/movie\/(\d+)\/credits/.exec(url)?.[1];
      const body = id
        ? {
            crew: [
              { job: 'Director', name: credits[Number(id)] },
              { job: 'Writer', name: 'X' },
            ],
          }
        : { results };
      return { status: 200, text: JSON.stringify(body) };
    };
    return { get, urls };
  }

  test('several films with the title: the director picks the right one (accents aside)', async () => {
    const { get } = fakeGet(fatherland);
    const found = await findMovie(get, 'eyJk', 'Fatherland', null, [], 'Paweł Pawlikowski');
    assert.equal(found?.poster, '/Fatherland-2026.jpg');
  });

  test('one candidate: no credits requested', async () => {
    const { get, urls } = fakeGet([fatherland[1]]);
    await findMovie(get, 'eyJk', 'Fatherland', null, [], 'Someone Else');
    assert.equal(urls.filter((u) => u.includes('/credits')).length, 0);
  });

  test('no director matches: the most-voted film stands', async () => {
    const { get } = fakeGet(fatherland);
    const found = await findMovie(get, 'eyJk', 'Fatherland', null, [], 'Nobody Known');
    assert.equal(found?.poster, '/Fatherland-1994.jpg');
  });

  test('several directors listed', () => {
    assert.deepEqual(directorNames('Jillian Frank & Avalon Fast'), [
      'jillian frank',
      'avalon fast',
    ]);
    assert.deepEqual(directorNames('Joel Coen, Ethan Coen'), ['joel coen', 'ethan coen']);
  });
});

describe('filling gaps from TMDB', () => {
  const details = {
    year: 2026,
    runtime: 82,
    genres: ['Drama', 'History', 'War'],
    overview: 'TMDB’s summary.',
  };

  test('adds year, runtime and two genres when the theatre gave none', () => {
    const { meta, synopsis } = fillFromTmdb(
      ['Paweł Pawlikowski'],
      ['The theatre’s text.'],
      details,
    );
    assert.deepEqual(meta, ['Paweł Pawlikowski', 'Drama', 'History', '2026', '82 min']);
    assert.deepEqual(synopsis, ['The theatre’s text.']);
  });

  test('never duplicates what the theatre gave (the Vic lists genre, year and runtime)', () => {
    const vic = ['PG', 'Drama', '2025', '112 min'];
    assert.deepEqual(fillFromTmdb(vic, ['x'], details).meta, vic);
  });

  test('the overview only when the theatre has no description; nothing without details', () => {
    assert.deepEqual(fillFromTmdb(undefined, [], details).synopsis, ['TMDB’s summary.']);
    assert.deepEqual(fillFromTmdb(['A'], ['B'], null), { meta: ['A'], synopsis: ['B'] });
  });

  test('fetchDetails reads year, runtime, genres and overview', async () => {
    const get = async () => ({
      status: 200,
      text: JSON.stringify({
        release_date: '2026-05-20',
        runtime: 82,
        genres: [{ name: 'Drama' }, { name: 'War' }],
        overview: ' Summary. ',
      }),
    });
    assert.deepEqual(await fetchDetails(get, 'eyJk', 5), {
      year: 2026,
      runtime: 82,
      genres: ['Drama', 'War'],
      overview: 'Summary.',
    });
  });
});
