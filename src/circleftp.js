'use strict';

/*
 * CircleFTP provider for Nuvio.
 * Original implementation based on the publicly documented CircleFTP API shape.
 * Runs on the viewer's device and returns source URLs; it does not host or proxy media.
 */

var PROVIDER_NAME = 'CircleFTP';
var DEFAULT_API_URL = 'http://new.circleftp.net:5000/api';
var TMDB_BASE = 'https://api.themoviedb.org/3';
var MAX_POSTS = 15;
var MAX_DETAILS = 12;
var REQUEST_TIMEOUT_MS = 7000;
var QUALITY_RANK = { '4K': 4, '1080p': 3, '720p': 2, '480p': 1, '360p': 0, 'Unknown': -1 };
var STOPWORDS = {
  a: true, an: true, the: true, of: true, and: true, in: true,
  on: true, at: true, to: true, for: true, with: true, from: true,
  movie: true, film: true
};
var TECH_WORDS = {
  '2160p': true, '1080p': true, '720p': true, '480p': true, '360p': true,
  '4k': true, 'uhd': true, 'fhd': true, 'hd': true, 'bluray': true,
  'brrip': true, 'webrip': true, 'webdl': true, 'hdtv': true,
  'x264': true, 'x265': true, 'h264': true, 'h265': true, 'hevc': true,
  'aac': true, 'dts': true, 'imax': true, 'hdr': true, 'proper': true,
  'extended': true, 'remastered': true, 'unrated': true, 'dual': true,
  'audio': true, 'dubbed': true, 'subbed': true
};

function getSettings() {
  if (typeof globalThis !== 'undefined' && globalThis.SCRAPER_SETTINGS) {
    return globalThis.SCRAPER_SETTINGS;
  }
  return {};
}

function log(message) {
  try {
    if (typeof console !== 'undefined' && console.log) console.log('[CircleFTP] ' + message);
  } catch (error) {
    // Logging should never break stream resolution.
  }
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function safeFetch(url, options, timeoutMs) {
  options = options || {};
  timeoutMs = timeoutMs || REQUEST_TIMEOUT_MS;
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var headers = {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
  };
  var suppliedHeaders = options.headers || {};
  Object.keys(suppliedHeaders).forEach(function (key) { headers[key] = suppliedHeaders[key]; });
  var fetchOptions = {};
  Object.keys(options).forEach(function (key) { fetchOptions[key] = options[key]; });
  fetchOptions.headers = headers;
  // Nuvio's fetch implementation understands this hint for larger media API responses.
  fetchOptions.skipSizeCheck = true;
  if (controller) fetchOptions.signal = controller.signal;

  var timeoutId;
  var request = Promise.resolve().then(function () { return fetch(url, fetchOptions); });
  var timeout = new Promise(function (resolve, reject) {
    timeoutId = setTimeout(function () {
      if (controller) {
        try { controller.abort(); } catch (error) { /* Ignore abort errors. */ }
      }
      reject(new Error('Request timed out after ' + timeoutMs + 'ms'));
    }, timeoutMs);
  });
  return Promise.race([request, timeout]).then(function (response) {
    clearTimeout(timeoutId);
    return response;
  }, function (error) {
    clearTimeout(timeoutId);
    throw error;
  });
}

function fetchJson(url, timeoutMs) {
  return safeFetch(url, { headers: { 'Accept': 'application/json' } }, timeoutMs).then(function (response) {
    if (!response || !response.ok) {
      throw new Error('HTTP ' + (response ? response.status : 'no response'));
    }
    return response.json();
  });
}

function parseYear(value) {
  if (typeof value === 'number' && isFinite(value)) return value;
  var match = String(value === null || value === undefined ? '' : value).match(/\b(19\d{2}|20\d{2})\b/);
  return match ? parseInt(match[1], 10) : null;
}

function normalizeTitle(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function significantWords(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9]+/).filter(function (word) {
    return word.length > 1 && !STOPWORDS[word] && !TECH_WORDS[word] && !/^(19|20)\d{2}$/.test(word);
  });
}

function titleMatches(candidate, targetTitles, targetYear) {
  var candidateText = String(candidate || '');
  var candidateNorm = normalizeTitle(candidateText);
  if (!candidateNorm) return false;
  var candidateYear = parseYear(candidateText);
  if (targetYear && candidateYear && Math.abs(candidateYear - targetYear) > 1) return false;

  for (var i = 0; i < targetTitles.length; i += 1) {
    var target = String(targetTitles[i] || '').trim();
    var targetNorm = normalizeTitle(target);
    if (!targetNorm) continue;
    if (candidateNorm === targetNorm || candidateNorm.indexOf(targetNorm) === 0) return true;

    var targetWords = significantWords(target);
    var candidateWords = significantWords(candidateText);
    if (targetWords.length && targetWords.every(function (word) {
      return candidateWords.indexOf(word) !== -1;
    }) && candidateWords.length <= targetWords.length + 5) return true;
  }
  return false;
}

function getMetadata(tmdbId, mediaType, apiKey) {
  if (tmdbId && typeof tmdbId === 'object') {
    var objectTitle = tmdbId.title || tmdbId.name || '';
    var objectOriginal = tmdbId.originalTitle || tmdbId.original_title || tmdbId.originalName || tmdbId.original_name || objectTitle;
    return Promise.resolve({
      title: objectTitle,
      originalTitle: objectOriginal,
      year: parseYear(tmdbId.year || tmdbId.release_date || tmdbId.first_air_date),
      kind: mediaType === 'tv' ? 'tv' : 'movie'
    });
  }

  var idStr = String(tmdbId || '').trim();
  var kind = mediaType === 'tv' ? 'tv' : 'movie';
  if (!idStr) return Promise.resolve({ title: '', originalTitle: '', year: null, kind: kind });

  // Support direct-title calls for testing and for hosts that pass a title instead of an ID.
  if (!/^\d+$/.test(idStr) && !/^tt\d+$/i.test(idStr)) {
    return Promise.resolve({ title: idStr, originalTitle: idStr, year: null, kind: kind });
  }
  if (!apiKey) {
    log('TMDB API key is missing. Add it in CircleFTP provider settings.');
    return Promise.resolve({ title: '', originalTitle: '', year: null, kind: kind });
  }

  var isImdb = /^tt\d+$/i.test(idStr);
  var endpoint = isImdb
    ? TMDB_BASE + '/find/' + encodeURIComponent(idStr) + '?api_key=' + encodeURIComponent(apiKey) + '&external_source=imdb_id'
    : TMDB_BASE + '/' + kind + '/' + encodeURIComponent(idStr) + '?api_key=' + encodeURIComponent(apiKey) + '&append_to_response=external_ids';

  return fetchJson(endpoint, 5000).then(function (data) {
    var item = data;
    if (isImdb) {
      var candidates = kind === 'tv' ? (data.tv_results || data.tv_episode_results || []) : (data.movie_results || []);
      item = candidates[0] || {};
    }
    var date = item.release_date || item.first_air_date || '';
    var primary = item.title || item.name || item.original_title || item.original_name || '';
    var original = item.original_title || item.original_name || primary;
    return { title: primary, originalTitle: original, year: parseYear(date), kind: kind };
  }).catch(function (error) {
    log('TMDB lookup failed: ' + error.message);
    return { title: '', originalTitle: '', year: null, kind: kind };
  });
}

function searchPosts(apiUrl, query) {
  if (!query) return Promise.resolve([]);
  var url = trimSlash(apiUrl) + '/posts?searchTerm=' + encodeURIComponent(query) + '&order=desc';
  return fetchJson(url, 6000).then(function (data) {
    return data && Array.isArray(data.posts) ? data.posts : [];
  }).catch(function (error) {
    log('Search failed for "' + query + '": ' + error.message);
    return [];
  });
}

function getPostDetail(apiUrl, id) {
  if (id === undefined || id === null || id === '') return Promise.resolve(null);
  return fetchJson(trimSlash(apiUrl) + '/posts/' + encodeURIComponent(String(id)), 6000).catch(function (error) {
    log('Detail lookup failed for post ' + id + ': ' + error.message);
    return null;
  });
}

function extractQuality(value) {
  var text = String(value || '').toLowerCase();
  if (/2160p|\b4k\b|uhd/.test(text)) return '4K';
  if (/1080p|fhd/.test(text)) return '1080p';
  if (/720p/.test(text)) return '720p';
  if (/480p/.test(text)) return '480p';
  if (/360p/.test(text)) return '360p';
  return 'Unknown';
}

function getFilename(url) {
  var path = String(url || '').split(/[?#]/)[0];
  var last = path.split('/').pop() || path;
  try { return decodeURIComponent(last); } catch (error) { return last; }
}

function getPostTitle(post) {
  if (!post) return '';
  return String(post.name || post.title || post.filename || '');
}

function getPostType(post) {
  return String(post && post.type || '').toLowerCase();
}

function postYear(post) {
  if (post && post.year !== undefined && post.year !== null) {
    var year = parseYear(post.year);
    if (year !== null) return year;
  }
  return parseYear(getPostTitle(post));
}

function matchesPost(post, meta) {
  if (!post) return false;
  var desiredType = meta.kind === 'tv' ? 'series' : 'singlevideo';
  if (getPostType(post) !== desiredType) return false;
  var year = postYear(post);
  if (meta.year && year && Math.abs(year - meta.year) > 1) return false;
  return titleMatches(getPostTitle(post), [meta.title, meta.originalTitle], meta.year);
}

function uniquePosts(posts) {
  var seen = {};
  return (posts || []).filter(function (post) {
    if (!post) return false;
    var id = post.id === undefined || post.id === null ? getPostTitle(post) : String(post.id);
    if (!id || seen[id]) return false;
    seen[id] = true;
    return true;
  });
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function createStream(url, qualityHint, episodeLabel) {
  if (!isHttpUrl(url)) return null;
  var cleanUrl = url.trim();
  var filename = getFilename(cleanUrl);
  var quality = extractQuality(String(qualityHint || '') + ' ' + filename);
  return {
    name: PROVIDER_NAME,
    title: '[CircleFTP] ' + (episodeLabel ? episodeLabel + ' - ' : '') + quality + ' - ' + filename,
    url: cleanUrl,
    quality: quality,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    }
  };
}

function sortStreams(streams) {
  return streams.sort(function (a, b) {
    var rankA = QUALITY_RANK[a.quality] === undefined ? -1 : QUALITY_RANK[a.quality];
    var rankB = QUALITY_RANK[b.quality] === undefined ? -1 : QUALITY_RANK[b.quality];
    if (rankA !== rankB) return rankB - rankA;
    return a.title.localeCompare(b.title);
  });
}

function resolveMovie(posts, apiUrl) {
  return Promise.all(posts.slice(0, MAX_DETAILS).map(function (post) {
    return getPostDetail(apiUrl, post.id).then(function (detail) {
      if (!detail) return null;
      var url = typeof detail.content === 'string' ? detail.content : (detail.link || detail.url || '');
      if (!url && post && typeof post.content === 'string') url = post.content;
      return createStream(url, (post.quality || '') + ' ' + (detail.title || getPostTitle(post)));
    });
  })).then(function (results) {
    var seen = {};
    return sortStreams(results.filter(function (stream) {
      if (!stream || seen[stream.url]) return false;
      seen[stream.url] = true;
      return true;
    }));
  });
}

function extractSeasonNumber(value) {
  var match = String(value || '').match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function extractEpisodeNumbers(title) {
  var text = String(title || '');
  var match = text.match(/E\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/i);
  if (match) {
    var range = [];
    for (var n = parseInt(match[1], 10); n <= parseInt(match[2], 10) && range.length < 100; n += 1) range.push(n);
    return range;
  }
  match = text.match(/E(\d+)\s*-\s*E?(\d+)/i);
  if (match) {
    var eRange = [];
    for (var en = parseInt(match[1], 10); en <= parseInt(match[2], 10) && eRange.length < 100; en += 1) eRange.push(en);
    return eRange;
  }
  match = text.match(/E(\d+)E(\d+)/i);
  if (match) return [parseInt(match[1], 10), parseInt(match[2], 10)];
  match = text.match(/S\s*\d+[.\s:]*E\s*(?:pisode\s*)?(\d+)/i);
  if (match) return [parseInt(match[1], 10)];
  match = text.match(/\b\d+x(\d+)\b/i);
  if (match) return [parseInt(match[1], 10)];
  match = text.match(/Episode[.\s:]*?(\d+)/i);
  if (match) return [parseInt(match[1], 10)];
  match = text.match(/\bEp[.\s:]*(\d+)\b/i);
  if (match) return [parseInt(match[1], 10)];
  match = text.match(/\bE(\d+)\b/i);
  if (match) return [parseInt(match[1], 10)];
  return null;
}

function resolveSeries(posts, apiUrl, season, episode) {
  if (!isFinite(Number(season)) || !isFinite(Number(episode))) return Promise.resolve([]);
  var targetSeason = Number(season);
  var targetEpisode = Number(episode);
  return Promise.all(posts.slice(0, MAX_DETAILS).map(function (post) {
    return getPostDetail(apiUrl, post.id).then(function (detail) {
      if (!detail || !Array.isArray(detail.content)) return [];
      var found = [];
      detail.content.forEach(function (seasonEntry) {
        if (extractSeasonNumber(seasonEntry.seasonName) !== targetSeason) return;
        (Array.isArray(seasonEntry.episodes) ? seasonEntry.episodes : []).forEach(function (ep) {
          if (!ep || !ep.link) return;
          var numbers = extractEpisodeNumbers(ep.title);
          if (numbers && numbers.indexOf(targetEpisode) !== -1) {
            var label = 'S' + (targetSeason < 10 ? '0' : '') + targetSeason + 'E' + (targetEpisode < 10 ? '0' : '') + targetEpisode;
            var stream = createStream(ep.link, (post.quality || '') + ' ' + (ep.title || ''), label);
            if (stream) found.push(stream);
          }
        });
      });
      return found;
    });
  })).then(function (groups) {
    var seen = {};
    var streams = [];
    groups.forEach(function (group) {
      group.forEach(function (stream) {
        if (!seen[stream.url]) {
          seen[stream.url] = true;
          streams.push(stream);
        }
      });
    });
    return sortStreams(streams);
  });
}

function getMatchingPosts(meta, apiUrl) {
  var titles = [];
  if (meta.title) titles.push(meta.title);
  if (meta.originalTitle && meta.originalTitle !== meta.title) titles.push(meta.originalTitle);
  var seenTitles = {};
  titles = titles.filter(function (title) {
    var key = normalizeTitle(title);
    if (!key || seenTitles[key]) return false;
    seenTitles[key] = true;
    return true;
  });
  if (!titles.length) return Promise.resolve([]);
  return Promise.all(titles.map(function (title) { return searchPosts(apiUrl, title); })).then(function (groups) {
    var all = [];
    groups.forEach(function (group) { all = all.concat(group); });
    return uniquePosts(all).filter(function (post) { return matchesPost(post, meta); }).slice(0, MAX_POSTS);
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var settings = getSettings();
  var apiUrl = trimSlash(settings.circleApiUrl || DEFAULT_API_URL);
  var apiKey = String(settings.tmdbApiKey || '').trim();
  if (mediaType !== 'movie' && mediaType !== 'tv') return Promise.resolve([]);
  return getMetadata(tmdbId, mediaType, apiKey).then(function (meta) {
    if (!meta || (!meta.title && !meta.originalTitle)) {
      log('Could not resolve a title. Check the TMDB key and the requested media ID.');
      return [];
    }
    log('Searching "' + meta.title + '"' + (meta.year ? ' (' + meta.year + ')' : '') + ' [' + mediaType + ']');
    return getMatchingPosts(meta, apiUrl).then(function (posts) {
      if (!posts.length) {
        log('No matching posts found for ' + meta.title + (meta.year ? ' (' + meta.year + ')' : ''));
        return [];
      }
      return mediaType === 'tv'
        ? resolveSeries(posts, apiUrl, season, episode)
        : resolveMovie(posts, apiUrl);
    });
  }).catch(function (error) {
    log('Stream lookup failed: ' + error.message);
    return [];
  });
}

function onSettings() {
  return [
    { type: 'header', label: 'CircleFTP API' },
    {
      type: 'text',
      key: 'circleApiUrl',
      label: 'CircleFTP API Base URL',
      placeholder: DEFAULT_API_URL,
      defaultValue: DEFAULT_API_URL,
      description: 'Use the API base, not the website home page. Default: http://new.circleftp.net:5000/api'
    },
    { type: 'header', label: 'TMDB metadata' },
    {
      type: 'text',
      key: 'tmdbApiKey',
      label: 'TMDB API v3 key',
      placeholder: 'Enter your own TMDB API key',
      description: 'Required when Nuvio passes a numeric TMDB ID. Saved in your Nuvio provider settings; do not put it in this repository.'
    }
  ];
}

module.exports = {
  getStreams: getStreams,
  onSettings: onSettings,
  __test: {
    parseYear: parseYear,
    normalizeTitle: normalizeTitle,
    significantWords: significantWords,
    titleMatches: titleMatches,
    extractQuality: extractQuality,
    extractSeasonNumber: extractSeasonNumber,
    extractEpisodeNumbers: extractEpisodeNumbers,
    createStream: createStream,
    matchesPost: matchesPost,
    getMetadata: getMetadata
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.getStreams = getStreams;
  globalThis.onSettings = onSettings;
}
