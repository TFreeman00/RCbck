'use strict';

/**
 * /src/routes/auth.js
 * Authentication routes — SSO callback and token exchange endpoints.
 *
 * Integration points:
 *   - Mounted in app.js at the /auth prefix.
 *   - POST /auth/google and POST /auth/apple accept the ID token from the
 *     client (obtained after the user completes the SSO flow in the browser/
 *     mobile app), verify it server-side via verifyToken(), and return a
 *     short-lived session identifier the client stores for subsequent requests.
 *   - No Redis sessions — Hostinger-compatible.  Session state is kept in
 *     a signed JWT or a MySQL `sessions` table (your choice; stub below uses JWT).
 *   - TODO: install `jsonwebtoken` and set JWT_SECRET in your .env file to
 *     activate the JWT signing block.
 */

const { Router }       = require('express');
const { verifyToken }  = require('../middlewares/auth');
const { authenticate } = require('../middlewares/auth');

const router = Router();

// ---------------------------------------------------------------------------
// Shared helper — issues a lightweight JWT after successful SSO verification.
// Swap for a DB session row if you prefer server-side session management.
// ---------------------------------------------------------------------------
function issueJwt(user) {
  // ---- PLACEHOLDER: JWT signing ------------------------------------------
  // const jwt = require('jsonwebtoken');
  // return jwt.sign(
  //   { id: user.id, role: user.role, isAdult: user.is_adult },
  //   process.env.JWT_SECRET,
  //   { expiresIn: '7d' }
  // );
  // -------------------------------------------------------------------------

  // Stub — returns a readable object until jsonwebtoken is wired in.
  return Buffer.from(JSON.stringify({ id: user.id, role: user.role, stub: true })).toString('base64');
}

// ---------------------------------------------------------------------------
// POST /auth/google
// Body: { idToken: "<google id token>" }
// Verifies the Google ID token, upserts the user, returns a session token.
// ---------------------------------------------------------------------------
router.post('/google', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken is required.' });

  try {
    const user       = await verifyToken(idToken, 'google');
    const sessionJwt = issueJwt(user);
    return res.json({ token: sessionJwt, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.warn('[auth/google]', err.message);
    return res.status(401).json({ error: 'Google token verification failed.' });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/apple
// Body: { idToken: "<apple id token>" }
// ---------------------------------------------------------------------------
router.post('/apple', async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: 'idToken is required.' });

  try {
    const user       = await verifyToken(idToken, 'apple');
    const sessionJwt = issueJwt(user);
    return res.json({ token: sessionJwt, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.warn('[auth/apple]', err.message);
    return res.status(401).json({ error: 'Apple token verification failed.' });
  }
});

// ---------------------------------------------------------------------------
// GET /auth/me
// Returns the current authenticated user's profile.
// Requires a valid Bearer token issued by /auth/google or /auth/apple.
// ---------------------------------------------------------------------------
router.get('/me', authenticate, (req, res) => {
  const { id, username, email, role, is_adult } = req.user;
  return res.json({ id, username, email, role, isAdult: Boolean(is_adult) });
});

module.exports = router;
