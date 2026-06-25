'use strict';

/**
 * /src/controllers/reviewController.js
 * Handles CRUD operations for game and anime reviews.
 *
 * Integration points:
 *   - Routes in /src/routes/api.js mount these handlers.
 *   - The aiModerator middleware runs BEFORE these handlers on POST/PUT routes,
 *     so by the time execution reaches here the body is already vetted.
 *   - Uses the shared MySQL pool from /src/config/db.js.
 *   - Future: emit a Socket.io event to the relevant room when a review is
 *     posted so live-viewers see it without refreshing.
 */

const { pool } = require('../config/db');

// ---------------------------------------------------------------------------
// GET /api/reviews/:mediaType/:mediaId
// Returns all approved reviews for a specific game or anime entry.
// ---------------------------------------------------------------------------
async function getReviews(req, res) {
  const { mediaType, mediaId } = req.params;

  // Validate mediaType to prevent unintended table scans via a bad enum value.
  if (!['game', 'anime'].includes(mediaType)) {
    return res.status(400).json({ error: 'mediaType must be "game" or "anime".' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.user_id, u.username, r.rating, r.body, r.created_at
         FROM reviews r
         JOIN users u ON u.id = r.user_id
        WHERE r.media_type = ? AND r.media_id = ? AND r.is_approved = 1
        ORDER BY r.created_at DESC`,
      [mediaType, mediaId]
    );
    return res.json({ reviews: rows });
  } catch (err) {
    console.error('[reviewController.getReviews]', err.message);
    return res.status(500).json({ error: 'Failed to fetch reviews.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/reviews
// Creates a new review.  Body arrives pre-screened by aiModerator middleware.
// ---------------------------------------------------------------------------
async function createReview(req, res) {
  // req.user is populated by the auth middleware upstream.
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorised.' });

  const { mediaType, mediaId, rating, body } = req.body;

  if (!mediaType || !mediaId || rating == null || !body) {
    return res.status(400).json({ error: 'mediaType, mediaId, rating, and body are required.' });
  }

  // Clamp rating to 1–10 range.
  const clampedRating = Math.min(10, Math.max(1, Number(rating)));

  try {
    const [result] = await pool.query(
      `INSERT INTO reviews (user_id, media_type, media_id, rating, body, is_approved, created_at)
       VALUES (?, ?, ?, ?, ?, 1, NOW())`,
      [userId, mediaType, mediaId, clampedRating, body]
    );
    return res.status(201).json({ id: result.insertId, message: 'Review created.' });
  } catch (err) {
    console.error('[reviewController.createReview]', err.message);
    return res.status(500).json({ error: 'Failed to create review.' });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/reviews/:id  (admin / owner only)
// ---------------------------------------------------------------------------
async function deleteReview(req, res) {
  const userId  = req.user?.id;
  const isAdmin = req.user?.role === 'admin';
  const { id }  = req.params;

  try {
    // Owners may delete their own reviews; admins may delete any.
    const whereClause = isAdmin ? 'WHERE id = ?' : 'WHERE id = ? AND user_id = ?';
    const params      = isAdmin ? [id] : [id, userId];

    const [result] = await pool.query(`DELETE FROM reviews ${whereClause}`, params);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Review not found or insufficient permissions.' });
    }
    return res.json({ message: 'Review deleted.' });
  } catch (err) {
    console.error('[reviewController.deleteReview]', err.message);
    return res.status(500).json({ error: 'Failed to delete review.' });
  }
}

module.exports = { getReviews, createReview, deleteReview };
