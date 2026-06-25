'use strict';

/**
 * /src/services/igdbService.js
 * Fetches game data from the IGDB REST API using a MySQL Cache-Aside pattern.
 *
 * Cache-Aside flow (no Redis — MySQL is the sole cache store):
 * ┌─ 1. Read from `igdb_cache` table ─────────────────────────────────────┐
 * │   Hit?  cached_at within 24 h  →  return cached row immediately.      │
 * │   Miss? cached_at older than 24 h, or row absent  →  continue.        │
 * └──────────────────────────────────────────────────────────────────────┘
 * ┌─ 2. Fetch from IGDB API ──────────────────────────────────────────────┐
 * │   POST https://api.igdb.com/v4/games  (Twitch OAuth bearer token)     │
 * └──────────────────────────────────────────────────────────────────────┘
 * ┌─ 3. Append monetisation affiliate tags ───────────────────────────────┐
 * │   Inject affiliate links (e.g. Amazon, Humble Bundle) into the        │
 * │   `buy_links` array before persisting and returning the payload.      │
 * └──────────────────────────────────────────────────────────────────────┘
 * ┌─ 4. Upsert into `igdb_cache` ─────────────────────────────────────────┐
 * │   INSERT … ON DUPLICATE KEY UPDATE so repeated fetches refresh the    │
 * │   row rather than creating duplicates.                                │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * MySQL cache table (add to your migration):
 * ─────────────────────────────────────────────────────────────────────────
 *   CREATE TABLE IF NOT EXISTS igdb_cache (
 *     igdb_id    INT UNSIGNED NOT NULL PRIMARY KEY,
 *     payload    JSON         NOT NULL,
 *     cached_at  DATETIME     NOT NULL
 *   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Required env vars:
 *   IGDB_CLIENT_ID      — Twitch developer app client ID
 *   IGDB_CLIENT_SECRET  — Twitch developer app client secret
 *   AFFILIATE_AMAZON_TAG — Amazon Associates tag (e.g. "rcbck-20")
 *   AFFILIATE_HUMBLE_TAG — Humble Bundle referral (e.g. "rcbck")
 */

const { pool }      = require('../config/db');
const CACHE_TTL_MS  = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Twitch OAuth — IGDB requires a client-credentials access token.
// The token is cached in memory for its lifetime (~60 days) so we don't hit
// the token endpoint on every request.
// ---------------------------------------------------------------------------
let _twitchToken    = null;
let _twitchTokenExp = 0;

async function getTwitchToken() {
  if (_twitchToken && Date.now() < _twitchTokenExp) return _twitchToken;

  // ---- PLACEHOLDER: Twitch OAuth token exchange ---------------------------
  // const res  = await fetch('https://id.twitch.tv/oauth2/token', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  //   body: new URLSearchParams({
  //     client_id:     process.env.IGDB_CLIENT_ID,
  //     client_secret: process.env.IGDB_CLIENT_SECRET,
  //     grant_type:    'client_credentials',
  //   }),
  // });
  // const data   = await res.json();
  // _twitchToken    = data.access_token;
  // _twitchTokenExp = Date.now() + (data.expires_in - 300) * 1000; // 5-min buffer
  // return _twitchToken;
  // -------------------------------------------------------------------------

  // Stub: returns a placeholder token string until real credentials are set.
  _twitchToken    = 'stub_twitch_token';
  _twitchTokenExp = Date.now() + 60 * 60 * 1000;
  return _twitchToken;
}

// ---------------------------------------------------------------------------
// appendAffiliateLinks(gameData)
// Injects affiliate purchase links into the data object before it is cached
// and returned to the client.  Swap the URL templates for real ones.
// ---------------------------------------------------------------------------
function appendAffiliateLinks(gameData) {
  const slug = encodeURIComponent(gameData.slug || gameData.name || gameData.id);

  gameData.buy_links = [
    {
      store:  'Amazon',
      url:    `https://www.amazon.com/s?k=${slug}&tag=${process.env.AFFILIATE_AMAZON_TAG || 'rcbck-20'}`,
      source: 'affiliate',
    },
    {
      store:  'Humble Bundle',
      url:    `https://www.humblebundle.com/store/search?search=${slug}&partner=${process.env.AFFILIATE_HUMBLE_TAG || 'rcbck'}`,
      source: 'affiliate',
    },
  ];

  return gameData;
}

// ---------------------------------------------------------------------------
// fetchFromIGDB(igdbId)
// Raw API call — returns a plain JS object or throws on failure.
// ---------------------------------------------------------------------------
async function fetchFromIGDB(igdbId) {
  // ---- PLACEHOLDER: IGDB REST request -------------------------------------
  // const token = await getTwitchToken();
  // const res   = await fetch('https://api.igdb.com/v4/games', {
  //   method:  'POST',
  //   headers: {
  //     'Client-ID':     process.env.IGDB_CLIENT_ID,
  //     'Authorization': `Bearer ${token}`,
  //     'Content-Type':  'text/plain',
  //   },
  //   // IGDB uses an Apicalypse query language in the POST body.
  //   body: `fields id,name,slug,summary,cover.url,first_release_date,genres.name,platforms.name,rating;
  //          where id = ${igdbId};
  //          limit 1;`,
  // });
  // if (!res.ok) throw new Error(`IGDB API error: ${res.status} ${res.statusText}`);
  // const [game] = await res.json();
  // if (!game)   throw new Error(`Game ${igdbId} not found on IGDB.`);
  // return game;
  // -------------------------------------------------------------------------

  // Stub game object — replace with real fetch above.
  return {
    id:                 Number(igdbId),
    name:               `Stub Game ${igdbId}`,
    slug:               `stub-game-${igdbId}`,
    summary:            'Placeholder summary from IGDB stub.',
    rating:             75.5,
    first_release_date: Math.floor(Date.now() / 1000),
  };
}

// ---------------------------------------------------------------------------
// getGame(igdbId)  — public entry point called by routes/api.js
// ---------------------------------------------------------------------------
async function getGame(igdbId) {
  const id = Number(igdbId);

  // ── Step 1: Check MySQL cache ──────────────────────────────────────────
  const [[cached]] = await pool.query(
    'SELECT payload, cached_at FROM igdb_cache WHERE igdb_id = ?',
    [id]
  );

  if (cached) {
    const ageMs = Date.now() - new Date(cached.cached_at).getTime();
    if (ageMs < CACHE_TTL_MS) {
      // Cache is fresh — return without hitting IGDB.
      const data = typeof cached.payload === 'string'
        ? JSON.parse(cached.payload)
        : cached.payload;
      data._source = 'mysql_cache';
      return data;
    }
    // Cache exists but is stale — fall through to re-fetch.
  }

  // ── Step 2: Fetch from IGDB API ────────────────────────────────────────
  const gameData = await fetchFromIGDB(id);

  // ── Step 3: Append affiliate links ─────────────────────────────────────
  appendAffiliateLinks(gameData);

  // ── Step 4: Upsert into MySQL cache ────────────────────────────────────
  await pool.query(
    `INSERT INTO igdb_cache (igdb_id, payload, cached_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), cached_at = NOW()`,
    [id, JSON.stringify(gameData)]
  );

  gameData._source = 'igdb_api';
  return gameData;
}

module.exports = { getGame };
