'use strict';

/**
 * /src/server.js
 * Server entry point — creates the HTTP server, attaches Socket.io, and
 * starts listening.
 *
 * Startup sequence:
 *   1. Load environment variables (.env via dotenv).
 *   2. Verify the MySQL connection pool is reachable.
 *   3. Run schema migrations (create tables if they don't exist).
 *   4. Build the Express app.
 *   5. Wrap it in an http.Server.
 *   6. Attach Socket.io with the local in-memory adapter (no Redis needed
 *      for Hostinger single-process Node.js deployment).
 *   7. Register the chatHandler event listeners.
 *   8. Begin accepting connections.
 *
 * Scaling note:
 *   If you later move to a multi-process setup (PM2 cluster), Socket.io's
 *   default in-memory adapter will NOT share room state between workers.
 *   At that point, introduce @socket.io/cluster-adapter (no Redis required)
 *   or switch to a dedicated WebSocket service.  For now, single-process is
 *   the right fit for Hostinger.
 */

require('dotenv').config();

const http         = require('http');
const { Server }   = require('socket.io');

const { createApp }      = require('./app');
const { pool, testConnection } = require('./config/db');
const { SCHEMA_COMMENTS, SCHEMA_CLOSURES } = require('./models/forumModel');
const chatHandler        = require('./sockets/chatHandler');

const PORT = parseInt(process.env.PORT || '3000', 10);

// ---------------------------------------------------------------------------
// runMigrations()
// Creates any missing tables.  This is a lightweight idempotent migration;
// for production consider a proper migration tool (e.g. db-migrate, Knex
// migrations) to handle schema changes safely.
// ---------------------------------------------------------------------------
async function runMigrations() {
  const cacheTableDefs = [
    // Forum Closure Table (from forumModel.js)
    SCHEMA_COMMENTS,
    SCHEMA_CLOSURES,

    // Users table — SSO upsert target in middlewares/auth.js
    `CREATE TABLE IF NOT EXISTS users (
       id          INT UNSIGNED     NOT NULL AUTO_INCREMENT PRIMARY KEY,
       external_id VARCHAR(128)     NOT NULL,
       provider    ENUM('google','apple') NOT NULL,
       email       VARCHAR(255)     NOT NULL,
       username    VARCHAR(64)      NULL,
       role        ENUM('user','admin') NOT NULL DEFAULT 'user',
       is_adult    TINYINT(1)       NOT NULL DEFAULT 0,
       created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
       UNIQUE KEY uq_ext (external_id, provider)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // Reviews table — used by reviewController.js
    `CREATE TABLE IF NOT EXISTS reviews (
       id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       user_id     INT UNSIGNED NOT NULL,
       media_type  ENUM('game','anime') NOT NULL,
       media_id    INT UNSIGNED NOT NULL,
       rating      TINYINT UNSIGNED NOT NULL,
       body        TEXT NOT NULL,
       is_approved TINYINT(1) NOT NULL DEFAULT 1,
       created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_media (media_type, media_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // Threads table — used by forumController.js
    `CREATE TABLE IF NOT EXISTS threads (
       id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
       user_id    INT UNSIGNED NOT NULL,
       title      VARCHAR(255) NOT NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       INDEX idx_user (user_id)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // IGDB MySQL cache — used by igdbService.js
    `CREATE TABLE IF NOT EXISTS igdb_cache (
       igdb_id   INT UNSIGNED NOT NULL PRIMARY KEY,
       payload   JSON         NOT NULL,
       cached_at DATETIME     NOT NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // AniList MySQL cache — used by anilistService.js
    `CREATE TABLE IF NOT EXISTS anilist_cache (
       anilist_id INT UNSIGNED NOT NULL PRIMARY KEY,
       payload    JSON         NOT NULL,
       cached_at  DATETIME     NOT NULL
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ];

  for (const sql of cacheTableDefs) {
    await pool.query(sql);
  }
  console.log('[migrations] All tables verified / created.');
}

// ---------------------------------------------------------------------------
// boot()  — top-level async entry point
// ---------------------------------------------------------------------------
async function boot() {
  // Step 1 — Verify DB connectivity before binding to a port.
  await testConnection();

  // Step 2 — Idempotent schema setup.
  await runMigrations();

  // Step 3 — Build Express app.
  const app = createApp();

  // Step 4 — Wrap in a raw http.Server so Socket.io can share the same port.
  const httpServer = http.createServer(app);

  // Step 5 — Attach Socket.io.
  // Uses the default in-memory adapter — zero external dependencies, works
  // perfectly for single-process Hostinger Node.js hosting.
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());

  const io = new Server(httpServer, {
    cors: {
      origin:      allowedOrigins,
      methods:     ['GET', 'POST'],
      credentials: true,
    },
    // Prefer WebSocket transport; fall back to long-polling if the client or
    // Hostinger's proxy blocks the upgrade.
    transports: ['websocket', 'polling'],
  });

  // Step 6 — Register chat event listeners.
  // chatHandler.register() wires the io.use() auth middleware and io.on('connection')
  // handler so all real-time logic is encapsulated in sockets/chatHandler.js.
  chatHandler.register(io);

  // Step 7 — Start listening.
  httpServer.listen(PORT, () => {
    console.log(`[server] RCbck backend running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  // Hostinger sends SIGTERM before restarting the process.  Close open
  // connections cleanly so in-flight requests finish rather than being cut off.
  const shutdown = async (signal) => {
    console.log(`[server] ${signal} received — shutting down gracefully…`);
    httpServer.close(async () => {
      await pool.end();
      console.log('[server] HTTP server and DB pool closed.  Goodbye.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

boot().catch((err) => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
