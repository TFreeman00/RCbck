import dotenv from 'dotenv';
dotenv.config();

import express, { Application } from 'express';
import { schedule } from 'node-cron';
import http from 'http';

import db from './db/connection';
import { QueueManager } from './queues/queueManager';
import { ingestionWorker } from './workers/ingestionWorker';
import { aiWorker } from './workers/aiWorker';
import newsRoutes from './routes/newsRoutes';

// ── Application setup ─────────────────────────────────────────────────────────

const app: Application = express();
app.use(express.json());

const PORT = Number(process.env.PORT ?? 3000);

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/api', newsRoutes);

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(app);

// ── Cron: ingest active sources every 15 minutes ─────────────────────────────

interface SourceRow {
  id: number;
  url: string;
  type: 'rss' | 'scraper';
}

schedule('*/15 * * * *', async () => {
  console.log('[cron] Running scheduled ingestion…');

  try {
    const sources = await db('sources')
      .where('is_active', true)
      .select<SourceRow[]>('id', 'url', 'type');

    if (sources.length === 0) {
      console.log('[cron] No active sources found.');
      return;
    }

    await Promise.all(
      sources.map((source) =>
        QueueManager.addRawIngestionJob({
          sourceId: source.id,
          sourceType: source.type,
          url: source.url,
        }),
      ),
    );

    console.log(`[cron] Enqueued ${sources.length} ingestion job(s).`);
  } catch (err) {
    console.error('[cron] Scheduled ingestion error:', err);
  }
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[shutdown] Received ${signal}. Shutting down gracefully…`);

  // 1. Stop accepting new HTTP requests
  server.close(() => {
    console.log('[shutdown] HTTP server closed.');
  });

  try {
    // 2. Close BullMQ workers (stop polling for new jobs)
    await Promise.all([
      ingestionWorker.close(),
      aiWorker.close(),
    ]);
    console.log('[shutdown] Workers closed.');

    // 3. Close queue connections
    await QueueManager.close();
    console.log('[shutdown] Queue connections closed.');

    // 4. Close database connection pool
    await db.destroy();
    console.log('[shutdown] Database connection closed.');

    process.exit(0);
  } catch (err) {
    console.error('[shutdown] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[server] RCbck API running on port ${PORT}`);
  console.log('[server] Workers and cron scheduler active.');
});

export { app, server };
