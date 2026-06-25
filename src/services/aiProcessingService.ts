import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection';
import { computeCosineSimilarity } from '../utils/cosineSimilarity';
import { AiProcessingJobPayload } from '../queues/queueManager';

const SIMILARITY_THRESHOLD = 0.85;
const HOURS_LOOKBACK = 48;
const EMBEDDING_MODEL = 'text-embedding-3-small'; // produces 1536-dim vectors
const LLM_MODEL = 'gpt-4o-mini';

// ── OpenAI client ─────────────────────────────────────────────────────────────

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ── Types for the LLM structured response ─────────────────────────────────────

interface LlmAnalysis {
  is_breaking_news: boolean;
  category: string;
  tags: string[];
  summary: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Calls the OpenAI Embeddings API and returns a 1536-dimensional float array
 * for the supplied text.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8192), // truncate to model's max context
  });
  return response.data[0].embedding;
}

/**
 * Queries the database for all articles published within the last 48 hours
 * that have an embedding, and returns them as an array of float arrays.
 */
async function fetchRecentEmbeddings(): Promise<number[][]> {
  const cutoff = new Date(Date.now() - HOURS_LOOKBACK * 60 * 60 * 1000);

  const rows: Array<{ embedding: string | null }> = await db('articles')
    .where('published_at', '>=', cutoff)
    .whereNotNull('embedding')
    .select('embedding');

  const embeddings: number[][] = [];
  for (const row of rows) {
    if (!row.embedding) continue;
    try {
      const parsed = JSON.parse(row.embedding) as unknown;
      if (Array.isArray(parsed)) {
        embeddings.push(parsed as number[]);
      }
    } catch {
      // Skip malformed rows
    }
  }
  return embeddings;
}

/**
 * Returns true if the new embedding is too similar (>= threshold) to any
 * recently stored article embedding.
 */
async function isDuplicate(newEmbedding: number[]): Promise<boolean> {
  const recentEmbeddings = await fetchRecentEmbeddings();

  for (const existing of recentEmbeddings) {
    const score = computeCosineSimilarity(newEmbedding, existing);
    if (score >= SIMILARITY_THRESHOLD) {
      return true;
    }
  }
  return false;
}

/**
 * Calls the LLM with a structured JSON output prompt and returns the parsed
 * analysis object.
 */
async function analyseWithLlm(title: string, text: string): Promise<LlmAnalysis> {
  const systemPrompt = `You are an AI news analyst. Analyse the provided article and respond ONLY with a valid JSON object matching this schema:
{
  "is_breaking_news": boolean,
  "category": string,
  "tags": string[],
  "summary": string  // exactly 3 sentences
}`;

  const userMessage = `Title: ${title}\n\nContent:\n${text.slice(0, 4000)}`;

  const response = await openai.chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content ?? '{}';
  return JSON.parse(content) as LlmAnalysis;
}

// ── Main pipeline function ────────────────────────────────────────────────────

/**
 * Full AI processing pipeline for a single article job:
 *
 *  1. Generate embedding for the raw text.
 *  2. Compare against recent articles; discard if similarity >= 0.85.
 *  3. If unique, run LLM categorisation / summarisation.
 *  4. Insert the enriched article into the database.
 */
export async function processArticle(payload: AiProcessingJobPayload): Promise<void> {
  const { title, link, rawText, publishedAt } = payload;

  // Step 1 – Generate embedding
  const embedding = await generateEmbedding(rawText);

  // Step 2 – Deduplication check
  const duplicate = await isDuplicate(embedding);
  if (duplicate) {
    console.log(`[aiProcessingService] Duplicate detected, discarding: ${link}`);
    return;
  }

  // Step 3 – LLM analysis
  const analysis = await analyseWithLlm(title, rawText);

  // Step 4 – Persist to database
  await db('articles').insert({
    id: uuidv4(),
    title,
    source_url: link,
    raw_content: rawText,
    summary: analysis.summary,
    category: analysis.category,
    published_at: publishedAt ? new Date(publishedAt) : new Date(),
    created_at: new Date(),
    embedding: JSON.stringify(embedding),
  });

  console.log(`[aiProcessingService] Saved article: ${link} (${analysis.category})`);
}
