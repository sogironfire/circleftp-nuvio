'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const provider = require('../providers/circleftp.js');
const t = provider.__test;

function jsonResponse(data, ok = true, status = 200) {
  return { ok, status, json: async () => data };
}

function withMocks(tctx, routes, settings) {
  const originalFetch = globalThis.fetch;
  const originalSettings = globalThis.SCRAPER_SETTINGS;
  const requested = [];
  globalThis.SCRAPER_SETTINGS = settings || {};
  globalThis.fetch = async (url) => {
    const text = String(url);
    requested.push(text);
    for (const route of routes) {
      if (route.test(text)) return typeof route.response === 'function' ? route.response(text) : route.response;
    }
    return jsonResponse({}, false, 404);
  };
  tctx.after(() => {
    globalThis.fetch = originalFetch;
    if (originalSettings === undefined) delete globalThis.SCRAPER_SETTINGS;
    else globalThis.SCRAPER_SETTINGS = originalSettings;
  });
  return requested;
}

test('extracts years from dates and release titles', () => {
  assert.equal(t.parseYear('2014-11-07'), 2014);
  assert.equal(t.parseYear('Interstellar (2014) IMAX 1080p'), 2014);
  assert.equal(t.parseYear('unknown'), null);
});

test('matches CircleFTP-style names and rejects mismatched years', () => {
  assert.equal(t.titleMatches('Interstellar (2014) IMAX 1080p BluRay Dual Audio', ['Interstellar'], 2014), true);
  assert.equal(t.titleMatches('Interstellar (2022) 1080p BluRay', ['Interstellar'], 2014), false);
  assert.equal(t.titleMatches('Avatar The Last Airbender (2005) 1080p', ['Avatar: The Last Airbender'], 2005), true);
});

test('extracts common video qualities', () => {
  assert.equal(t.extractQuality('Movie 2160p HDR'), '4K');
  assert.equal(t.extractQuality('Interstellar 1080p BluRay'), '1080p');
  assert.equal(t.extractQuality('Movie 720p'), '720p');
  assert.equal(t.extractQuality('movie.mkv'), 'Unknown');
});

test('extracts common episode labels and episode ranges', () => {
  assert.deepEqual(t.extractEpisodeNumbers('Show S01E03 1080p'), [3]);
  assert.deepEqual(t.extractEpisodeNumbers('Show 2x07 WEB-DL'), [7]);
  assert.deepEqual(t.extractEpisodeNumbers('Show Episode 12'), [12]);
  assert.deepEqual(t.extractEpisodeNumbers('Show E03-E05'), [3, 4, 5]);
});

test('creates only HTTP(S) stream objects and decodes the file name', () => {
  assert.equal(t.createStream('ftp://example.com/movie.mkv', '1080p'), null);
  const stream = t.createStream('http://index.circleftp.net/FILE/Interstellar%20%282014%29%201080p.mkv', '');
  assert.equal(stream.quality, '1080p');
  assert.match(stream.title, /Interstellar \(2014\) 1080p\.mkv/);
  assert.equal(stream.url.startsWith('http://index.circleftp.net/'), true);
  assert.ok(stream.headers['User-Agent']);
});

test('settings include the CircleFTP API URL and a user-supplied TMDB key', () => {
  const settings = provider.onSettings();
  assert.ok(settings.find((item) => item.key === 'circleApiUrl'));
  assert.ok(settings.find((item) => item.key === 'tmdbApiKey'));
});

test('numeric TMDB IDs return no streams if no key is configured', async (tctx) => {
  const originalSettings = globalThis.SCRAPER_SETTINGS;
  globalThis.SCRAPER_SETTINGS = {};
  tctx.after(() => {
    if (originalSettings === undefined) delete globalThis.SCRAPER_SETTINGS;
    else globalThis.SCRAPER_SETTINGS = originalSettings;
  });
  assert.deepEqual(await provider.getStreams('157336', 'movie'), []);
});

test('movie flow resolves TMDB metadata, searches CircleFTP and returns the DDL link', async (tctx) => {
  const ddl = 'http://index.circleftp.net/FILE/English%20%26%20Foreign%20Dubbed%20Movies/2014/Interstellar%20%282014%29%20IMAX%201080p.mkv';
  const requested = withMocks(tctx, [
    { test: (url) => url.includes('api.themoviedb.org/3/movie/157336'), response: jsonResponse({ title: 'Interstellar', original_title: 'Interstellar', release_date: '2014-11-07' }) },
    { test: (url) => url.includes('/posts?searchTerm=Interstellar'), response: jsonResponse({ posts: [{ id: 98603, type: 'singleVideo', name: 'Interstellar (2014) IMAX 1080p BluRay Dual Audio', quality: '1080p' }] }) },
    { test: (url) => url.endsWith('/posts/98603'), response: jsonResponse({ title: 'Interstellar (2014) IMAX 1080p BluRay Dual Audio', content: ddl }) }
  ], { tmdbApiKey: 'test-key', circleApiUrl: 'http://new.circleftp.net:5000/api' });

  const streams = await provider.getStreams('157336', 'movie');
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, ddl);
  assert.equal(streams[0].quality, '1080p');
  assert.ok(requested.some((url) => url.includes('/posts?searchTerm=Interstellar')));
  assert.ok(requested.some((url) => url.endsWith('/posts/98603')));
});

test('TV flow returns the requested season and episode', async (tctx) => {
  const ddl = 'http://index.circleftp.net/FILE/Show/S01E02%201080p.mkv';
  withMocks(tctx, [
    { test: (url) => url.includes('api.themoviedb.org/3/tv/12345'), response: jsonResponse({ name: 'Example Show', original_name: 'Example Show', first_air_date: '2020-01-01' }) },
    { test: (url) => url.includes('/posts?searchTerm=Example%20Show'), response: jsonResponse({ posts: [{ id: 11, type: 'series', name: 'Example Show (2020)', quality: '1080p' }] }) },
    { test: (url) => url.endsWith('/posts/11'), response: jsonResponse({ content: [{ seasonName: 'Season 1', episodes: [{ title: 'Example Show S01E02 1080p', link: ddl }] }] }) }
  ], { tmdbApiKey: 'test-key' });

  const streams = await provider.getStreams('12345', 'tv', 1, 2);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, ddl);
  assert.match(streams[0].title, /S01E02/);
});

test('unsupported content types fail softly', async () => {
  assert.deepEqual(await provider.getStreams('157336', 'person'), []);
});
