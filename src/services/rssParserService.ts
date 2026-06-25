import Parser from 'rss-parser';
import db from '../db/connection';
import { QueueManager, AiProcessingJobPayload } from '../queues/queueManager';

/**
 * RssParserService reads an RSS/Atom feed, deduplicates items against the
 * database (by source_url), and pushes new items into the ai-processing-queue.
 */
export class RssParserService {
  private parser: Parser;

  constructor() {
    this.parser = new Parser({
      timeout: 10_000,
      headers: {
        'User-Agent': 'RCbck-NewsBot/1.0 (+https://github.com/TFreeman00/RCbck)',
      },
    });
  }

  /**
   * Parses the given RSS feed URL and enqueues any articles that have not
   * already been stored in the database.
   */
  async processFeed(feedUrl: string): Promise<void> {
    console.log(`[RssParserService] Fetching feed: ${feedUrl}`);

    let feed: Parser.Output<Parser.Item>;
    try {
      feed = await this.parser.parseURL(feedUrl);
    } catch (err) {
      console.error(`[RssParserService] Failed to parse feed ${feedUrl}:`, err);
      throw err;
    }

    const items = feed.items ?? [];
    console.log(`[RssParserService] Found ${items.length} items in feed.`);

    for (const item of items) {
      const link = item.link ?? item.guid;
      if (!link) {
        console.warn('[RssParserService] Skipping item without link/guid.');
        continue;
      }

      try {
        const exists = await this.articleExists(link);
        if (exists) {
          console.log(`[RssParserService] Already stored: ${link}`);
          continue;
        }

        const payload: AiProcessingJobPayload = {
          title: item.title ?? '(no title)',
          link,
          rawText: item.contentSnippet ?? item.content ?? item.summary ?? '',
          publishedAt: item.pubDate ?? item.isoDate,
        };

        await QueueManager.addAiProcessingJob(payload);
        console.log(`[RssParserService] Enqueued: ${link}`);
      } catch (err) {
        console.error(`[RssParserService] Error processing item ${link}:`, err);
        // Continue with remaining items rather than aborting the whole feed
      }
    }
  }

  /**
   * Returns true if an article with the given URL already exists in the DB.
   */
  private async articleExists(url: string): Promise<boolean> {
    const row = await db('articles').where({ source_url: url }).first('id');
    return row !== undefined;
  }
}
