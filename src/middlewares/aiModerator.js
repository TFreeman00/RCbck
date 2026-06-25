'use strict';

/**
 * /src/middlewares/aiModerator.js
 * Content moderation middleware for POST and PUT requests.
 *
 * Integration points:
 *   - Applied in routes/api.js before reviewController and forumController
 *     handlers so every user-submitted body is screened in one place.
 *   - Only intercepts POST and PUT; GET/DELETE pass through immediately.
 *   - Currently uses a local placeholder filter (wordlist + simple heuristics).
 *   - TODO: swap simulateAICheck() for a real moderation API call, e.g.:
 *       OpenAI Moderation:  POST https://api.openai.com/v1/moderations
 *       Perspective API:    POST https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze
 *     Both are REST calls — no Redis / external daemon required, compatible
 *     with Hostinger's outbound HTTP access.
 */

// ---------------------------------------------------------------------------
// Placeholder content filter
// Replace the body of this function with a real API call when ready.
// ---------------------------------------------------------------------------

// Expanded placeholder list — real deployment should use a maintained library
// such as `bad-words` (npm) or a remote moderation API.
const BLOCKED_PATTERNS = [
  /\bspam\b/i,
  /\bhate\b/i,
  /\bkill\s+yourself\b/i,
  // Add patterns here or pull from DB at startup.
];

/**
 * simulateAICheck(text)
 * Returns { flagged: boolean, reason: string|null }.
 *
 * Swap this function's internals for a real HTTP call to your chosen
 * moderation API without changing anything else in this file.
 */
async function simulateAICheck(text) {
  // ----- PLACEHOLDER: OpenAI Moderation API ---------------------------------
  // const { default: fetch } = await import('node-fetch');
  // const response = await fetch('https://api.openai.com/v1/moderations', {
  //   method:  'POST',
  //   headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  //   body:    JSON.stringify({ input: text }),
  // });
  // const data = await response.json();
  // const result = data.results?.[0];
  // return { flagged: result?.flagged ?? false, reason: result?.flagged ? 'AI flagged content' : null };
  // --------------------------------------------------------------------------

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return { flagged: true, reason: `Content matched blocked pattern: ${pattern.source}` };
    }
  }
  return { flagged: false, reason: null };
}

// ---------------------------------------------------------------------------
// Collect all text fields from the request body that should be screened.
// Reviews have `body`; forum posts have `body` and optionally `title`.
// ---------------------------------------------------------------------------
function extractTextFields(body = {}) {
  return [body.title, body.body, body.content]
    .filter(Boolean)
    .join(' ');
}

// ---------------------------------------------------------------------------
// aiModerator — Express middleware
// ---------------------------------------------------------------------------
async function aiModerator(req, res, next) {
  // Only screen mutating requests — reads are harmless.
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();

  const textToCheck = extractTextFields(req.body);

  // Nothing to check (e.g. a multipart upload with no text fields).
  if (!textToCheck.trim()) return next();

  try {
    const { flagged, reason } = await simulateAICheck(textToCheck);

    if (flagged) {
      return res.status(400).json({
        error: 'Content flagged by moderation filter.',
        reason,
      });
    }

    next();
  } catch (err) {
    // If the moderation check itself fails, log and allow through rather
    // than blocking all writes — adjust this policy to your risk tolerance.
    console.error('[aiModerator] Moderation check error:', err.message);
    next();
  }
}

module.exports = { aiModerator, simulateAICheck };
