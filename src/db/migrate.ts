/**
 * Database migration script.
 * Run with: npm run migrate
 *
 * Creates the `articles` and `sources` tables with utf8mb4 charset
 * to properly handle emojis and multibyte characters (e.g. Japanese text).
 */

import dotenv from 'dotenv';
dotenv.config();

import db from './connection';

async function migrate(): Promise<void> {
  console.log('Running database migrations…');

  // ── articles ────────────────────────────────────────────────────────────────
  const articlesExists = await db.schema.hasTable('articles');
  if (!articlesExists) {
    await db.schema.createTable('articles', (table) => {
      table.string('id', 36).primary().notNullable();
      table.string('title', 255).notNullable();
      table.string('source_url', 500).unique().notNullable();
      table.specificType('raw_content', 'LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci').nullable();
      table.text('summary').nullable();
      table.string('category', 100).nullable();
      table.dateTime('published_at').nullable();
      table.dateTime('created_at').notNullable().defaultTo(db.fn.now());
      // embedding column – stores a 1536-dimensional float array as JSON
      table.json('embedding').nullable();
    });

    // Ensure the table itself uses utf8mb4
    await db.raw('ALTER TABLE `articles` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    console.log('  ✓ Created table: articles');
  } else {
    console.log('  – Skipped: articles (already exists)');
  }

  // ── sources ─────────────────────────────────────────────────────────────────
  const sourcesExists = await db.schema.hasTable('sources');
  if (!sourcesExists) {
    await db.schema.createTable('sources', (table) => {
      table.increments('id').primary();
      table.string('name', 255).notNullable();
      table.string('url', 500).notNullable().unique();
      table.enu('type', ['rss', 'scraper'], {
        useNative: true,
        enumName: 'source_type',
      }).notNullable();
      table.boolean('is_active').notNullable().defaultTo(true);
    });

    await db.raw('ALTER TABLE `sources` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    console.log('  ✓ Created table: sources');
  } else {
    console.log('  – Skipped: sources (already exists)');
  }

  console.log('Migrations complete.');
}

migrate()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
