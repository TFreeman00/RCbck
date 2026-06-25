import { Queue, JobsOptions } from 'bullmq';
import { redisConnection } from './redisConfig';

// ── Queue Names ───────────────────────────────────────────────────────────────

export const RAW_INGESTION_QUEUE = 'raw-ingestion-queue';
export const AI_PROCESSING_QUEUE = 'ai-processing-queue';

// ── Default job options with retry / exponential backoff ─────────────────────

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000, // initial delay in ms; doubles on each retry
  },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

// ── Queue instances ───────────────────────────────────────────────────────────

export const rawIngestionQueue = new Queue(RAW_INGESTION_QUEUE, {
  connection: redisConnection,
  defaultJobOptions,
});

export const aiProcessingQueue = new Queue(AI_PROCESSING_QUEUE, {
  connection: redisConnection,
  defaultJobOptions,
});

// ── Job payload types ─────────────────────────────────────────────────────────

export interface RawIngestionJobPayload {
  sourceId: number;
  sourceType: 'rss' | 'scraper';
  url: string;
}

export interface AiProcessingJobPayload {
  title: string;
  link: string;
  rawText: string;
  publishedAt?: string;
}

// ── QueueManager ─────────────────────────────────────────────────────────────

/**
 * QueueManager provides a centralised, type-safe interface for adding jobs to
 * either queue.  All jobs automatically inherit the default retry/backoff
 * options defined above; callers may pass additional options to override them.
 */
export class QueueManager {
  /**
   * Adds a job to the raw-ingestion-queue.
   */
  static async addRawIngestionJob(
    payload: RawIngestionJobPayload,
    overrides?: JobsOptions,
  ): Promise<void> {
    await rawIngestionQueue.add('ingest', payload, overrides);
  }

  /**
   * Adds a job to the ai-processing-queue.
   */
  static async addAiProcessingJob(
    payload: AiProcessingJobPayload,
    overrides?: JobsOptions,
  ): Promise<void> {
    await aiProcessingQueue.add('process', payload, overrides);
  }

  /**
   * Gracefully closes both queue connections.
   * Should be called during application shutdown.
   */
  static async close(): Promise<void> {
    await Promise.all([
      rawIngestionQueue.close(),
      aiProcessingQueue.close(),
    ]);
  }
}
