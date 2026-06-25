'use strict';

/**
 * /src/middlewares/auth.js
 * SSO token verification middleware (Google & Apple).
 *
 * Integration points:
 *   - Mount on any route that requires an authenticated user, e.g.:
 *       router.post('/reviews', authenticate, aiModerator, reviewController.createReview)
 *   - On success, populates `req.user` with { id, username, email, role, isAdult }
 *     so downstream controllers and Socket.io handshake handlers have a single
 *     source of truth for the caller's identity.
 *   - The Socket.io auth handshake (chatHandler.js) reuses the same logic by
 *     calling verifyToken() directly before upgrading to a WebSocket connection.
 *
 * TODO — replace the placeholder bodies with real SDK calls:
 *   Google: google-auth-library  →  OAuth2Client.verifyIdToken()
 *   Apple:  apple-signin-auth    →  appleSignin.verifyIdToken()
 */

const { pool } = require('../config/db');

// ---------------------------------------------------------------------------
// verifyToken(token, provider)
// Shared verification logic extracted so it can be called from both the HTTP
// middleware below AND the Socket.io auth hook in chatHandler.js.
// ---------------------------------------------------------------------------
async function verifyToken(token, provider = 'google') {
  if (!token) throw new Error('No token provided.');

  let externalUserId;
  let email;

  if (provider === 'google') {
    // ---- PLACEHOLDER: Google ID Token verification -------------------------
    // const { OAuth2Client } = require('google-auth-library');
    // const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    // const ticket = await client.verifyIdToken({
    //   idToken:  token,
    //   audience: process.env.GOOGLE_CLIENT_ID,
    // });
    // const payload = ticket.getPayload();
    // externalUserId = payload.sub;
    // email          = payload.email;
    // -----------------------------------------------------------------------

    // Stub — remove when real SDK is wired in.
    externalUserId = `google_stub_${token.slice(-8)}`;
    email          = 'stub@example.com';
  } else if (provider === 'apple') {
    // ---- PLACEHOLDER: Apple ID Token verification -------------------------
    // const appleSignin = require('apple-signin-auth');
    // const payload = await appleSignin.verifyIdToken(token, {
    //   audience:       process.env.APPLE_CLIENT_ID,
    //   ignoreExpiration: false,
    // });
    // externalUserId = payload.sub;
    // email          = payload.email;
    // -----------------------------------------------------------------------

    externalUserId = `apple_stub_${token.slice(-8)}`;
    email          = 'stub@apple.com';
  } else {
    throw new Error(`Unknown SSO provider: ${provider}`);
  }

  // Upsert the user into our database so we always have a local user row
  // regardless of which SSO provider was used.  This is the only place that
  // should insert into `users` for SSO-authenticated callers.
  const [rows] = await pool.query(
    `INSERT INTO users (external_id, provider, email, created_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE email = VALUES(email)`,
    [externalUserId, provider, email]
  );

  // Re-fetch the full user row (including id, role, isAdult) after upsert.
  const [[user]] = await pool.query(
    'SELECT id, username, email, role, is_adult FROM users WHERE external_id = ? AND provider = ?',
    [externalUserId, provider]
  );

  if (!user) throw new Error('User record not found after upsert.');
  return user;
}

// ---------------------------------------------------------------------------
// authenticate — Express middleware
// Expects: Authorization: Bearer <token>  or  x-auth-provider: apple|google
// ---------------------------------------------------------------------------
async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const provider   = (req.headers['x-auth-provider'] || 'google').toLowerCase();

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    req.user = await verifyToken(token, provider);
    next();
  } catch (err) {
    console.warn('[auth] Token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

module.exports = { authenticate, verifyToken };
