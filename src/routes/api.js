'use strict';

/**
 * /src/routes/api.js
 * Main API router — mounts all feature sub-routes under /api.
 *
 * Middleware chain for protected, user-submitted routes:
 *   authenticate  →  aiModerator  →  controller handler
 *
 * Integration points:
 *   - Mounted in app.js at the /api prefix.
 *   - authenticate populates req.user before any controller runs.
 *   - aiModerator screens POST/PUT bodies for disallowed content before the
 *     controller writes anything to MySQL.
 */

const { Router }         = require('express');
const { authenticate }   = require('../middlewares/auth');
const { aiModerator }    = require('../middlewares/aiModerator');
const reviewController   = require('../controllers/reviewController');
const forumController    = require('../controllers/forumController');
const igdbService        = require('../services/igdbService');
const anilistService     = require('../services/anilistService');

const router = Router();

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

// Public: fetch reviews for a specific game or anime entry.
router.get('/reviews/:mediaType/:mediaId', reviewController.getReviews);

// Protected: create a review — auth + AI moderation required.
router.post('/reviews', authenticate, aiModerator, reviewController.createReview);

// Protected: delete own review (or admin deletes any).
router.delete('/reviews/:id', authenticate, reviewController.deleteReview);

// ---------------------------------------------------------------------------
// Forum threads & comments
// ---------------------------------------------------------------------------

// Public: paginated thread list.
router.get('/forum/threads', forumController.getThreads);

// Public: all comments for a thread (flat list, client reconstructs tree).
router.get('/forum/threads/:threadId/comments', forumController.getComments);

// Protected: post a comment / reply — auth + AI moderation required.
router.post(
  '/forum/threads/:threadId/comments',
  authenticate,
  aiModerator,
  forumController.createComment
);

// ---------------------------------------------------------------------------
// Game data (IGDB) — Cache-Aside via MySQL + in-memory layer
// ---------------------------------------------------------------------------

// GET /api/games/:igdbId
// Returns game details.  Hit in-memory cache first, then MySQL, then IGDB.
router.get('/games/:igdbId', async (req, res) => {
  try {
    const data = await igdbService.getGame(req.params.igdbId);
    return res.json(data);
  } catch (err) {
    console.error('[api/games]', err.message);
    return res.status(502).json({ error: 'Failed to fetch game data.' });
  }
});

// ---------------------------------------------------------------------------
// Anime data (AniList) — Cache-Aside via MySQL + in-memory layer
// ---------------------------------------------------------------------------

// GET /api/anime/:anilistId
// Returns anime details.  Hit in-memory cache first, then MySQL, then AniList.
router.get('/anime/:anilistId', async (req, res) => {
  try {
    const data = await anilistService.getAnime(req.params.anilistId);
    return res.json(data);
  } catch (err) {
    console.error('[api/anime]', err.message);
    return res.status(502).json({ error: 'Failed to fetch anime data.' });
  }
});

module.exports = router;
