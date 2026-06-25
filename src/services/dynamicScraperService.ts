/// <reference lib="dom" />
import { chromium, Browser, BrowserContext } from 'playwright';
import { QueueManager, AiProcessingJobPayload } from '../queues/queueManager';

/**
 * A pool of real-world User-Agent strings used to rotate on each launch to
 * reduce the likelihood of bot detection.
 */
const USER_AGENTS: string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0',
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * CSS selectors for elements that should be excluded from extracted text.
 */
const NOISE_SELECTORS = ['nav', 'footer', 'aside', '.sidebar', '#sidebar', 'header'];

/**
 * DynamicScraperService uses Playwright to scrape JavaScript-rendered pages,
 * extract the main article text (filtering out navigation/footer noise), and
 * push the result into the ai-processing-queue.
 */
export class DynamicScraperService {
  /**
   * Launches a headless Chromium browser, navigates to `targetUrl`, waits for
   * network idle, strips noisy elements, and enqueues the extracted text.
   */
  async scrapeUrl(targetUrl: string): Promise<void> {
    console.log(`[DynamicScraperService] Scraping: ${targetUrl}`);

    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext({
        userAgent: randomUserAgent(),
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9,ja;q=0.8',
        },
      });

      const page = await context.newPage();

      // Navigate and wait until no more than 2 open network connections remain
      await page.goto(targetUrl, {
        waitUntil: 'networkidle',
        timeout: 30_000,
      });

      // Remove noisy DOM elements before extracting text
      await page.evaluate((selectors: string[]) => {
        for (const selector of selectors) {
          document.querySelectorAll(selector).forEach((el: Element) => el.remove());
        }
      }, NOISE_SELECTORS);

      // Extract the cleaned body text
      const rawText = await page.evaluate(() => document.body.innerText ?? '');
      const title = await page.title();

      if (!rawText.trim()) {
        console.warn(`[DynamicScraperService] No text content found at: ${targetUrl}`);
        return;
      }

      const payload: AiProcessingJobPayload = {
        title,
        link: targetUrl,
        rawText: rawText.trim(),
      };

      await QueueManager.addAiProcessingJob(payload);
      console.log(`[DynamicScraperService] Enqueued content from: ${targetUrl}`);
    } catch (err) {
      console.error(`[DynamicScraperService] Error scraping ${targetUrl}:`, err);
      throw err;
    } finally {
      await context?.close();
      await browser?.close();
    }
  }
}
