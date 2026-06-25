import { Worker, Job } from 'bullmq';
import { redisConnection } from '../queues/redisConfig';
import {
  AI_PROCESSING_QUEUE,
  AiProcessingJobPayload,
} from '../queues/queueManager';
import { processArticle } from '../services/aiProcessingService';

/**
 * Worker that consumes jobs from the ai-processing-queue.
 *
 * For each job it runs the full AI pipeline:
 *   1. Generate an embedding for the incoming text.
 *   2. Deduplicate against recent articles using cosine similarity.
 *   3. If unique, call the LLM for categorisation / summarisation.
 *   4. Persist the enriched article to the database.
 */
export const aiWorker = new Worker(
  AI_PROCESSING_QUEUE,
  async (job: Job<AiProcessingJobPayload>) => {
    console.log(`[aiWorker] Received job ${job.id} – ${job.data.link}`);

    try {
      await processArticle(job.data);
      console.log(`[aiWorker] Job ${job.id} completed successfully.`);
    } catch (err) {
      console.error(`[aiWorker] Job ${job.id} failed:`, err);
      throw err; // re-throw so BullMQ handles retries
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
  },
);

aiWorker.on('failed', (job, err) => {
  console.error(`[aiWorker] Job ${job?.id} permanently failed:`, err);
});
