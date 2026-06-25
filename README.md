# RCbck

AI-powered news scraping and processing pipeline built with Node.js, TypeScript, BullMQ, MySQL, and Playwright.

## Features

- **Database** – MySQL 8.x with Knex.js migrations; `articles` table with embedding support (JSON column for 1536-dim vectors), `sources` table with ENUM type and utf8mb4 charset
- **Queue system** – BullMQ / Redis with two queues (`raw-ingestion-queue`, `ai-processing-queue`), retry logic (3 attempts, exponential backoff), and a `QueueManager` helper class
- **RSS ingestion** – `RssParserService` reads feeds, deduplicates by URL against the DB, and enqueues new items
- **Dynamic scraping** – `DynamicScraperService` uses Playwright (headless Chromium) with user-agent rotation, network-idle waiting, and noise-element removal
- **AI processing** – cosine-similarity deduplication against recent article embeddings, OpenAI embedding + LLM categorisation (breaking-news flag, category, tags, 3-sentence summary)
- **REST API** – Express server with `GET /api/news` (latest 50 articles, filterable by category)
- **Scheduler** – `node-cron` job every 15 minutes to enqueue active sources
- **Graceful shutdown** – SIGTERM/SIGINT handlers close workers, queues, and DB connections cleanly

## Requirements

- Node.js ≥ 18
- MySQL 8.x
- Redis

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env

# 3. Create the database schema
npm run migrate

# 4. Start the server (development)
npm run dev

# 5. Build and start (production)
npm run build
npm start
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DB_HOST` | MySQL host | `localhost` |
| `DB_PORT` | MySQL port | `3306` |
| `DB_USER` | MySQL user | `root` |
| `DB_PASSWORD` | MySQL password | *(empty)* |
| `DB_NAME` | MySQL database name | `rc_news` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `OPENAI_API_KEY` | OpenAI API key for embeddings + LLM | *(required)* |
| `PORT` | HTTP server port | `3000` |

## API

### `GET /api/news`

Returns the latest 50 processed articles sorted by `published_at` descending.

**Query parameters:**

| Parameter | Type | Description |
|---|---|---|
| `category` | string | Filter articles by category |

**Example response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Breaking: New Anime Season Announced",
      "source_url": "https://example.com/article",
      "summary": "Three-sentence executive summary…",
      "category": "anime",
      "published_at": "2026-06-25T12:00:00.000Z",
      "created_at": "2026-06-25T12:01:00.000Z"
    }
  ],
  "total": 1
}
```

## Project Structure

```
src/
├── db/
│   ├── connection.ts        # Knex connection singleton
│   └── migrate.ts           # Database migration script
├── queues/
│   ├── redisConfig.ts       # Redis connection from REDIS_URL
│   └── queueManager.ts      # Queue instances + QueueManager class
├── routes/
│   └── newsRoutes.ts        # GET /api/news
├── services/
│   ├── rssParserService.ts  # RSS feed ingestion
│   ├── dynamicScraperService.ts  # Playwright scraper
│   └── aiProcessingService.ts   # Embedding + LLM pipeline
├── utils/
│   └── cosineSimilarity.ts  # Pure JS cosine similarity
└── workers/
    ├── ingestionWorker.ts   # raw-ingestion-queue consumer
    └── aiWorker.ts          # ai-processing-queue consumer
```
