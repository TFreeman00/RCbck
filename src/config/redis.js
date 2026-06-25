'use strict';

/**
 * /src/config/cache.js  (exported as config/redis.js for path compatibility)
 *
 * In-process TTL cache — a Redis-free solution for Hostinger hosting where
 * Redis is not available as a managed service.
 *
 * Design:
 *   - Backed by a plain JS Map: key → { value, expiresAt }.
 *   - A periodic sweep removes stale entries so memory doesn't grow unbounded.
 *   - API intentionally mirrors the subset of the redis client used by the
 *     services (get / set / del) so switching to Redis later only requires
 *     swapping this file, not every call site.
 *
 * Limitations vs Redis:
 *   - Cache is NOT shared between processes.  If you later move to a multi-
 *     process setup (e.g. PM2 cluster), each worker has its own cache island.
 *     For Hostinger single-process Node.js this is perfectly fine.
 *   - Cache is lost on process restart — cold starts will hit the external
 *     APIs (IGDB / AniList) once per cache key until MySQL fills the gap.
 *
 * Integration points:
 *   - igdbService.js and anilistService.js call cache.get() / cache.set()
 *     as the hot layer in their Cache-Aside pattern.
 *   - server.js uses the default Socket.io in-memory adapter (no redis-adapter
 *     needed for a single-process Hostinger deployment).
 */

// Default TTL: 24 hours in milliseconds (matches external API refresh window).
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// Sweep interval: purge expired entries every 10 minutes.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

const store = new Map();

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * set(key, value, ttlMs?)
 * Store a value with an optional TTL in milliseconds.
 * If ttlMs is omitted the DEFAULT_TTL_MS (24 h) is used.
 */
function set(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * get(key)
 * Returns the stored value, or null if missing / expired.
 */
function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key); // lazy eviction
    return null;
  }
  return entry.value;
}

/**
 * del(key)
 * Explicitly remove a single entry (e.g. after a DB write invalidates it).
 */
function del(key) {
  store.delete(key);
}

/**
 * flush()
 * Clears the entire cache — useful in tests or after a mass data update.
 */
function flush() {
  store.clear();
}

// ---------------------------------------------------------------------------
// Periodic sweep — keeps the Map from filling with stale entries indefinitely.
// ---------------------------------------------------------------------------
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, SWEEP_INTERVAL_MS);

// Don't let this timer prevent the Node.js process from exiting cleanly.
sweepTimer.unref();

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = { get, set, del, flush, DEFAULT_TTL_MS };
