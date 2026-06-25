'use strict';

/**
 * /src/sockets/chatHandler.js
 * Real-time chat handler with age-gating and AI content moderation.
 *
 * Integration points:
 *   - Attached to the Socket.io `io` instance in server.js:
 *       chatHandler.register(io);
 *   - Socket.io auth handshake: the client must pass a valid session token in
 *       socket.handshake.auth.token  (set by your front-end after SSO login).
 *   - verifyToken() from middlewares/auth.js validates the token and resolves
 *     the full user object (including `is_adult`) before any event fires.
 *   - No Redis — Socket.io uses its default in-memory adapter.
 *     Rooms ('adult_chat' / 'all_ages_chat') are tracked in the Socket.io
 *     server's own in-process room map.  This is perfectly suited for a
 *     single-process Hostinger Node.js deployment.
 *
 * Room routing:
 *   is_adult === true  →  socket joins 'adult_chat'
 *   is_adult === false →  socket joins 'all_ages_chat'
 *   Sockets are ONLY in one chat room at a time; sendMessage events are
 *   broadcast exclusively to that room — adult content never leaks.
 *
 * Message flow:
 *   client emits 'sendMessage'  →  moderateMessage()  →  io.to(room).emit('newMessage')
 *                                           ↓
 *                              if flagged: emit 'messageRejected' back to sender only
 */

const { verifyToken } = require('../middlewares/auth');

// ---------------------------------------------------------------------------
// moderateMessage(text)
// Placeholder moderation check for incoming Socket.io chat messages.
// Uses the same pattern as aiModerator.js but is async-friendly for the
// real-time path.
//
// TODO: replace with a real moderation API call (e.g. OpenAI Moderation)
//       for production.  The function signature won't change.
// ---------------------------------------------------------------------------
const BLOCKED_PATTERNS = [
  /\bspam\b/i,
  /\bhate\b/i,
  /\bkill\s+yourself\b/i,
];

async function moderateMessage(text) {
  // ---- PLACEHOLDER: OpenAI Moderation API ----------------------------------
  // const res  = await fetch('https://api.openai.com/v1/moderations', {
  //   method:  'POST',
  //   headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  //   body:    JSON.stringify({ input: text }),
  // });
  // const data   = await res.json();
  // const result = data.results?.[0];
  // return { flagged: result?.flagged ?? false };
  // --------------------------------------------------------------------------

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) return { flagged: true };
  }
  return { flagged: false };
}

// ---------------------------------------------------------------------------
// register(io)
// Attaches all Socket.io event listeners to the provided `io` server instance.
// Call this once from server.js after the io instance is created.
// ---------------------------------------------------------------------------
function register(io) {
  // ── Auth middleware for Socket.io handshake ──────────────────────────────
  // This runs before 'connection' fires — unauthenticated sockets are refused
  // here rather than after they've already established a connection.
  io.use(async (socket, next) => {
    const token    = socket.handshake.auth?.token;
    const provider = socket.handshake.auth?.provider || 'google';

    if (!token) {
      return next(new Error('Authentication token required.'));
    }

    try {
      // verifyToken resolves the full user row (id, username, role, is_adult).
      const user = await verifyToken(token, provider);
      // Attach the user to the socket so all event handlers can reference it.
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token.'));
    }
  });

  // ── Connection handler ───────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { id: userId, username, is_adult: isAdult } = socket.user;

    // Determine which chat room this socket belongs to based on age verification.
    // Socket.io's built-in .join() assigns the socket to the room's in-memory
    // set — no external adapter or Redis needed for single-process deployments.
    const chatRoom = isAdult ? 'adult_chat' : 'all_ages_chat';
    socket.join(chatRoom);

    console.log(
      `[chat] User ${username} (id=${userId}) connected → joined room '${chatRoom}'. Socket: ${socket.id}`
    );

    // Notify the client which room they landed in.
    socket.emit('roomAssigned', { room: chatRoom });

    // ── sendMessage ─────────────────────────────────────────────────────────
    // Expected payload: { text: string }
    // The message is moderated BEFORE it is broadcast so no other clients ever
    // see flagged content, even for a frame.
    socket.on('sendMessage', async (payload) => {
      const text = typeof payload?.text === 'string' ? payload.text.trim() : '';

      if (!text) return; // ignore empty messages silently

      try {
        const { flagged } = await moderateMessage(text);

        if (flagged) {
          // Emit rejection only back to the sender — other users are unaware.
          socket.emit('messageRejected', {
            reason: 'Your message was flagged by our content filter.',
          });
          console.warn(`[chat] Message from ${username} flagged and blocked.`);
          return;
        }

        // Broadcast the approved message to everyone in the same room,
        // including the sender (use io.to() not socket.to() for that).
        io.to(chatRoom).emit('newMessage', {
          userId,
          username,
          text,
          room:      chatRoom,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[chat] moderateMessage error:', err.message);
        // On moderation error, still deliver the message rather than silently
        // dropping it — adjust this policy to your risk tolerance.
        io.to(chatRoom).emit('newMessage', {
          userId,
          username,
          text,
          room:      chatRoom,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // ── typing indicator ────────────────────────────────────────────────────
    // Broadcast to others in the same room only (socket.to excludes sender).
    socket.on('typing', () => {
      socket.to(chatRoom).emit('userTyping', { username });
    });

    socket.on('stopTyping', () => {
      socket.to(chatRoom).emit('userStoppedTyping', { username });
    });

    // ── disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`[chat] User ${username} disconnected from '${chatRoom}'. Reason: ${reason}`);
    });
  });
}

module.exports = { register };
