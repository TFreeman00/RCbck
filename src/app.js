'use strict';

/**
 * /src/app.js
 * Express application factory — creates and configures the app instance.
 *
 * Kept separate from server.js so the app can be imported directly in tests
 * without binding to a port.
 *
 * Middleware stack (order matters):
 *   1. helmet       — sets security-related HTTP response headers.
 *   2. cors         — allows cross-origin requests from the configured origin.
 *   3. express.json — parses incoming JSON bodies (max 1 MB).
 *   4. Routes       — /auth and /api prefixes.
 *   5. 404 handler  — catches unmatched routes.
 *   6. Error handler — centralised error formatting.
 *
 * Integration points:
 *   - server.js calls createApp() and passes the returned `app` to
 *     http.createServer() before attaching Socket.io.
 *   - Routes import controllers/services directly; no global state lives here.
 */

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
require('dotenv').config();

const apiRouter  = require('./routes/api');
const authRouter = require('./routes/auth');

function createApp() {
  const app = express();

  // ── Security headers ─────────────────────────────────────────────────────
  // helmet sets X-Content-Type-Options, X-Frame-Options, HSTS, CSP, etc.
  // On Hostinger the reverse proxy may already add some headers; helmet is
  // additive so duplicate headers are not a problem.
  app.use(helmet());

  // ── CORS ─────────────────────────────────────────────────────────────────
  // Allow requests only from the configured frontend origin.
  // Socket.io has its own CORS config in server.js — keep them in sync.
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());

  app.use(
    cors({
      origin(origin, callback) {
        // Allow server-to-server requests (no Origin header) and listed origins.
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: origin ${origin} not allowed.`));
      },
      methods:          ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders:   ['Content-Type', 'Authorization', 'x-auth-provider'],
      credentials:      true,
    })
  );

  // ── Body parsing ─────────────────────────────────────────────────────────
  // Limit body size to 1 MB to reduce the impact of large-payload attacks.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // ── Health check ─────────────────────────────────────────────────────────
  // Simple liveness probe — useful for Hostinger process monitoring and any
  // future load-balancer health checks.
  app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

  // ── Routes ───────────────────────────────────────────────────────────────
  app.use('/auth', authRouter);
  app.use('/api',  apiRouter);

  // ── 404 handler ──────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found.' });
  });

  // ── Centralised error handler ─────────────────────────────────────────────
  // Express recognises a 4-argument function as an error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    // Don't expose internal stack traces to clients in production.
    const isDev    = process.env.NODE_ENV !== 'production';
    const status   = err.status || err.statusCode || 500;
    const message  = err.message || 'Internal server error.';

    console.error('[app] Unhandled error:', err);
    res.status(status).json({
      error: message,
      ...(isDev && { stack: err.stack }),
    });
  });

  return app;
}

module.exports = { createApp };
