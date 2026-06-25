'use strict';

/**
 * /src/controllers/forumController.js
 * Handles threaded forum post and comment CRUD.
 *
 * Integration points:
 *   - Routes in /src/routes/api.js mount these handlers.
 *   - Comment tree reads/writes delegate to /src/models/forumModel.js which
 *     encapsulates the Closure Table SQL logic.
 *   - aiModerator middleware screens POST/PUT bodies upstream.
 *   - auth middleware ensures req.user is set before these handlers run.
 */

const { pool }        = require('../config/db');
const forumModel      = require('../models/forumModel');

// ---------------------------------------------------------------------------
// GET /api/forum/threads
// Returns a paginated list of top-level threads (not comments).
// ---------------------------------------------------------------------------
async function getThreads(req, res) {
  const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
  const limit = Math.min(50, parseInt(req.query.limit || '20', 10));
  const offset = (page - 1) * limit;

  try {
    const [rows] = await pool.query(
      `SELECT t.id, t.title, t.user_id, u.username, t.created_at,
              (SELECT COUNT(*) FROM comment_closures cc WHERE cc.ancestor_id = t.id AND cc.depth > 0) AS reply_count
         FROM threads t
         JOIN users u ON u.id = t.user_id
        ORDER BY t.created_at DESC
        LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return res.json({ page, limit, threads: rows });
  } catch (err) {
    console.error('[forumController.getThreads]', err.message);
    return res.status(500).json({ error: 'Failed to fetch threads.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/forum/threads/:threadId/comments
// Returns the full flat list of comments for a thread, ordered by depth so
// the client can reconstruct the tree without recursive SQL.
// ---------------------------------------------------------------------------
async function getComments(req, res) {
  const { threadId } = req.params;

  try {
    // Closure table read: fetch every descendant of this thread root, along
    // with its depth so the front-end can indent accordingly.
    const [rows] = await pool.query(
      `SELECT c.id, c.user_id, u.username, c.body, c.created_at,
              cc.ancestor_id AS parent_id, cc.depth
         FROM comment_closures cc
         JOIN comments c ON c.id = cc.descendant_id
         JOIN users   u ON u.id  = c.user_id
        WHERE cc.ancestor_id = ? AND cc.depth = 1
        ORDER BY c.created_at ASC`,
      [threadId]
    );
    return res.json({ comments: rows });
  } catch (err) {
    console.error('[forumController.getComments]', err.message);
    return res.status(500).json({ error: 'Failed to fetch comments.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/forum/threads/:threadId/comments
// Adds a new comment (or reply) under a thread or existing comment.
// The parentId in the body determines tree placement via the Closure Table.
// ---------------------------------------------------------------------------
async function createComment(req, res) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorised.' });

  const { threadId }          = req.params;
  const { body, parentId }    = req.body;   // parentId defaults to the thread root

  if (!body || body.trim().length === 0) {
    return res.status(400).json({ error: 'Comment body is required.' });
  }

  try {
    // Delegate actual insertion + closure table wiring to the model layer.
    const commentId = await forumModel.insertComment({
      userId,
      body:     body.trim(),
      parentId: parentId ?? threadId,   // reply to thread root if no explicit parent
    });

    return res.status(201).json({ id: commentId, message: 'Comment created.' });
  } catch (err) {
    console.error('[forumController.createComment]', err.message);
    return res.status(500).json({ error: 'Failed to create comment.' });
  }
}

module.exports = { getThreads, getComments, createComment };
