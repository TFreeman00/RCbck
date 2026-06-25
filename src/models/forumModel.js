'use strict';

/**
 * /src/models/forumModel.js
 * MySQL Closure Table implementation for threaded forum comments.
 *
 * Why Closure Table?
 *   - Avoids recursive CTEs (not available in MySQL < 8.0, and expensive even
 *     where available) while still allowing fast arbitrary-depth tree reads.
 *   - Reading an entire subtree is a single JOIN query on comment_closures.
 *   - Inserting a reply copies the ancestor rows of the parent + self-reference
 *     in one INSERT … SELECT, keeping write logic simple.
 *
 * Schema (run once via your migration tool):
 * ─────────────────────────────────────────────────────────────────────────────
 *   CREATE TABLE IF NOT EXISTS comments (
 *     id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 *     user_id    INT UNSIGNED NOT NULL,
 *     body       TEXT         NOT NULL,
 *     created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
 *     INDEX idx_user (user_id)
 *   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 *
 *   CREATE TABLE IF NOT EXISTS comment_closures (
 *     ancestor_id   INT UNSIGNED NOT NULL,
 *     descendant_id INT UNSIGNED NOT NULL,
 *     depth         INT UNSIGNED NOT NULL DEFAULT 0,
 *     PRIMARY KEY (ancestor_id, descendant_id),
 *     INDEX idx_descendant (descendant_id)
 *   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Integration points:
 *   - forumController.js calls insertComment() and (optionally) getSubtree().
 *   - The pool from config/db.js is used directly; no ORM, no Redis.
 */

const { pool } = require('../config/db');

// ---------------------------------------------------------------------------
// Schema creation strings (export so migrate.js can run them at startup)
// ---------------------------------------------------------------------------
const SCHEMA_COMMENTS = `
  CREATE TABLE IF NOT EXISTS comments (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id    INT UNSIGNED NOT NULL,
    body       TEXT         NOT NULL,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const SCHEMA_CLOSURES = `
  CREATE TABLE IF NOT EXISTS comment_closures (
    ancestor_id   INT UNSIGNED NOT NULL,
    descendant_id INT UNSIGNED NOT NULL,
    depth         INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (ancestor_id, descendant_id),
    INDEX idx_descendant (descendant_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

// ---------------------------------------------------------------------------
// insertComment({ userId, body, parentId })
//
// Inserts a new comment and wires up the closure table in a single transaction:
//   1. Insert the new comment row → get its auto-increment id (newId).
//   2. Copy every row where descendant_id = parentId (i.e. all ancestors of
//      the parent, including the parent itself), incrementing depth by 1.
//   3. Insert the self-referencing row (newId → newId, depth 0).
//
// This means reading a subtree never requires recursion — just:
//   SELECT * FROM comment_closures WHERE ancestor_id = <root> ORDER BY depth
//
// Returns the new comment's id.
// ---------------------------------------------------------------------------
async function insertComment({ userId, body, parentId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Step 1 — insert the comment body.
    const [insertResult] = await conn.query(
      'INSERT INTO comments (user_id, body, created_at) VALUES (?, ?, NOW())',
      [userId, body]
    );
    const newId = insertResult.insertId;

    // Step 2 — copy ancestor paths from the parent.
    // "Give the new node all the ancestors its parent has, but one level deeper."
    // If parentId is null (root-level post) this INSERT … SELECT returns 0 rows,
    // which is fine — the self-reference in step 3 is the only closure row.
    if (parentId != null) {
      await conn.query(
        `INSERT INTO comment_closures (ancestor_id, descendant_id, depth)
         SELECT ancestor_id, ?, depth + 1
           FROM comment_closures
          WHERE descendant_id = ?`,
        [newId, parentId]
      );
    }

    // Step 3 — self-referencing row so the node appears as its own descendant
    // (standard closure table convention; simplifies subtree reads).
    await conn.query(
      'INSERT INTO comment_closures (ancestor_id, descendant_id, depth) VALUES (?, ?, 0)',
      [newId, newId]
    );

    await conn.commit();
    return newId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// getSubtree(rootId)
// Returns every comment that is a descendant of rootId (including itself),
// ordered by depth then creation time — no recursion, no CTEs.
// ---------------------------------------------------------------------------
async function getSubtree(rootId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.user_id, c.body, c.created_at, cc.depth, cc.ancestor_id AS parent_id
       FROM comment_closures cc
       JOIN comments c ON c.id = cc.descendant_id
      WHERE cc.ancestor_id = ?
      ORDER BY cc.depth ASC, c.created_at ASC`,
    [rootId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// deleteSubtree(rootId)
// Hard-deletes a comment and all its descendants (moderation use).
// ---------------------------------------------------------------------------
async function deleteSubtree(rootId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Collect all descendant ids (including root) first.
    const [descendants] = await conn.query(
      'SELECT descendant_id FROM comment_closures WHERE ancestor_id = ?',
      [rootId]
    );
    const ids = descendants.map((r) => r.descendant_id);

    if (ids.length > 0) {
      // Remove closure rows involving any of these nodes.
      await conn.query(
        'DELETE FROM comment_closures WHERE ancestor_id IN (?) OR descendant_id IN (?)',
        [ids, ids]
      );
      // Remove the comment rows themselves.
      await conn.query('DELETE FROM comments WHERE id IN (?)', [ids]);
    }

    await conn.commit();
    return ids.length;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  SCHEMA_COMMENTS,
  SCHEMA_CLOSURES,
  insertComment,
  getSubtree,
  deleteSubtree,
};
