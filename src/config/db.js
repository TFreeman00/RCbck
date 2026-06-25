'use strict';

/**
 * /src/config/db.js
 * MySQL connection pool configuration using mysql2/promise.
 *
 * Integration points:
 *   - All models and services import `pool` from this module to query the DB.
 *   - Uses a connection pool (not a single connection) so that concurrent
 *     requests each get their own transient connection from the pool without
 *     blocking each other — critical for the forum and review read/write paths.
 *   - Credentials are pulled from environment variables so that docker-compose,
 *     PM2, and local dev can all supply different values without code changes.
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

// createPool returns a pool object that manages a set of reusable TCP connections
// to MySQL.  Callers do `await pool.query(...)` — the pool handles checkout and
// return of individual connections automatically.
const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '3306', 10),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'rcbck',

  // Keep up to 10 live connections.  Tune based on expected concurrent users.
  connectionLimit: parseInt(process.env.DB_POOL_LIMIT || '10', 10),

  // Automatically reconnect dropped idle connections.
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,

  // Return dates as JS Date objects rather than strings.
  timezone: 'Z',
});

/**
 * Smoke-test helper — call once at startup to verify credentials are correct
 * before the server begins accepting traffic.
 */
async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('[DB] MySQL connection pool ready.');
    conn.release();
  } catch (err) {
    console.error('[DB] Failed to connect to MySQL:', err.message);
    // Surface the error so server.js can decide whether to exit.
    throw err;
  }
}

module.exports = { pool, testConnection };
