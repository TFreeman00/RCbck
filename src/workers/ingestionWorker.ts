import { Worker, Job } from 'bullmq';
import { redisConnection } from '../queues/redisConfig';
import {
  RAW_INGESTION_QUEUE,
  RawIngestionJobPayload,
} from '../queues/queueManager';
import { RssParserService } from '../services/rssParserService';
import { DynamicScraperService } from '../services/dynamicScraperService';

/**
 * Worker that consumes jobs from the raw-ingestion-queue.
 *
 * For each job it delegates to the appropriate parser service based on the
 * sourceType field in the payload (either 'rss' or 'scraper').
 */
export const ingestionWorker = new Worker(
  RAW_INGESTION_QUEUE,
  async (job: Job<RawIngestionJobPayload>) => {
    const { sourceId, sourceType, url } = job.data;
    console.log(`[ingestionWorker] Received job ${job.id} – source #${sourceId} (${sourceType}): ${url}`);

    try {
      if (sourceType === 'rss') {
        const rssService = new RssParserService();
        await rssService.processFeed(url);
      } else {
        const scraperService = new DynamicScraperService();
        await scraperService.scrapeUrl(url);
      }

      console.log(`[ingestionWorker] Job ${job.id} completed successfully.`);
    } catch (err) {
      console.error(`[ingestionWorker] Job ${job.id} failed:`, err);
      throw err; // re-throw so BullMQ handles retries
    }
  },
  {
    connection: redisConnection,
    concurrency: 3,
  },
);

ingestionWorker.on('failed', (job, err) => {
  console.error(`[ingestionWorker] Job ${job?.id} permanently failed:`, err);
});
