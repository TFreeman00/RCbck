'use strict';

/**
 * /src/services/anilistService.js
 * Fetches anime data from the AniList GraphQL API using a MySQL Cache-Aside pattern.
 *
 * Cache-Aside flow (no Redis — MySQL is the sole cache store):
 * ┌─ 1. Read from `anilist_cache` table ──────────────────────────────────┐
 * │   Hit?  cached_at within 24 h  →  return cached row immediately.      │
 * │   Miss? cached_at older than 24 h, or row absent  →  continue.        │
 * └──────────────────────────────────────────────────────────────────────┘
 * ┌─ 2. Fetch from AniList GraphQL API ───────────────────────────────────┐
 * │   POST https://graphql.anilist.co  with a MediaQuery body.            │
 * │   AniList is free and unauthenticated for public media queries.       │
 * └──────────────────────────────────────────────────────────────────────┘
 * ┌─ 3. Append monetisation affiliate tags ───────────────────────────────┐
 * │   Inject streaming / merch affiliate links (e.g. Crunchyroll,        │
 * │   RightStuf/Nozomi) into `stream_links` before persisting.            │
 * └──────────────────────────────────────────────────────────────────────┘
 * ┌─ 4. Upsert into `anilist_cache` ──────────────────────────────────────┐
 * │   INSERT … ON DUPLICATE KEY UPDATE refreshes the row on every fetch. │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * MySQL cache table (add to your migration):
 * ─────────────────────────────────────────────────────────────────────────
 *   CREATE TABLE IF NOT EXISTS anilist_cache (
 *     anilist_id INT UNSIGNED NOT NULL PRIMARY KEY,
 *     payload    JSON         NOT NULL,
 *     cached_at  DATETIME     NOT NULL
 *   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Required env vars (optional — AniList public queries need no key):
 *   AFFILIATE_CRUNCHYROLL_REF — Crunchyroll referral code
 *   AFFILIATE_NOZOMI_TAG      — Nozomi/RightStuf affiliate tag
 */

const { pool }     = require('../config/db');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// AniList GraphQL query — requests the fields we store and display.
// AniList's public API allows ~90 requests/min without authentication.
// ---------------------------------------------------------------------------
const ANILIST_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      id
      title {
        romaji
        english
        native
      }
      description(asHtml: false)
      coverImage { large }
      bannerImage
      averageScore
      genres
      episodes
      status
      startDate { year month day }
      studios(isMain: true) { nodes { name } }
      externalLinks { site url }
    }
  }
`;

// ---------------------------------------------------------------------------
// appendAffiliateLinks(animeData)
// Injects affiliate streaming / merch links into the data object before it
// is cached and returned to the client.
// ---------------------------------------------------------------------------
function appendAffiliateLinks(animeData) {
  const title = encodeURIComponent(
    animeData.title?.english || animeData.title?.romaji || String(animeData.id)
  );

  animeData.stream_links = [
    {
      platform:  'Crunchyroll',
      url:       `https://www.crunchyroll.com/search?q=${title}&ref=${process.env.AFFILIATE_CRUNCHYROLL_REF || 'rcbck'}`,
      source:    'affiliate',
    },
    {
      platform:  'RightStuf / Nozomi',
      url:       `https://www.nozomientertainment.com/search/?q=${title}&aff=${process.env.AFFILIATE_NOZOMI_TAG || 'rcbck'}`,
      source:    'affiliate',
    },
  ];

  return animeData;
}

// ---------------------------------------------------------------------------
// fetchFromAniList(anilistId)
// Executes the GraphQL query against AniList's public endpoint.
// Returns the Media object or throws on network / API error.
// ---------------------------------------------------------------------------
async function fetchFromAniList(anilistId) {
  // ---- PLACEHOLDER: AniList GraphQL request --------------------------------
  // const res = await fetch('https://graphql.anilist.co', {
  //   method:  'POST',
  //   headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  //   body:    JSON.stringify({ query: ANILIST_QUERY, variables: { id: anilistId } }),
  // });
  //
  // if (!res.ok) throw new Error(`AniList HTTP error: ${res.status}`);
  //
  // const body = await res.json();
  // if (body.errors?.length) throw new Error(`AniList GQL error: ${body.errors[0].message}`);
  //
  // const media = body.data?.Media;
  // if (!media)  throw new Error(`Anime ${anilistId} not found on AniList.`);
  // return media;
  // -------------------------------------------------------------------------

  // Stub — replace the block above to activate real fetching.
  return {
    id:           Number(anilistId),
    title:        { romaji: `Stub Anime ${anilistId}`, english: null, native: null },
    description:  'Placeholder description from AniList stub.',
    averageScore: 82,
    genres:       ['Action', 'Adventure'],
    episodes:     12,
    status:       'FINISHED',
  };
}

// ---------------------------------------------------------------------------
// getAnime(anilistId)  — public entry point called by routes/api.js
// ---------------------------------------------------------------------------
async function getAnime(anilistId) {
  const id = Number(anilistId);

  // ── Step 1: Check MySQL cache ──────────────────────────────────────────
  const [[cached]] = await pool.query(
    'SELECT payload, cached_at FROM anilist_cache WHERE anilist_id = ?',
    [id]
  );

  if (cached) {
    const ageMs = Date.now() - new Date(cached.cached_at).getTime();
    if (ageMs < CACHE_TTL_MS) {
      // Cache hit — no external API call needed.
      const data = typeof cached.payload === 'string'
        ? JSON.parse(cached.payload)
        : cached.payload;
      data._source = 'mysql_cache';
      return data;
    }
    // Row is stale — fall through and re-fetch from AniList.
  }

  // ── Step 2: Fetch from AniList GraphQL ────────────────────────────────
  const animeData = await fetchFromAniList(id);

  // ── Step 3: Append affiliate / monetisation links ─────────────────────
  appendAffiliateLinks(animeData);

  // ── Step 4: Upsert into MySQL cache ───────────────────────────────────
  await pool.query(
    `INSERT INTO anilist_cache (anilist_id, payload, cached_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), cached_at = NOW()`,
    [id, JSON.stringify(animeData)]
  );

  animeData._source = 'anilist_api';
  return animeData;
}

module.exports = { getAnime };
