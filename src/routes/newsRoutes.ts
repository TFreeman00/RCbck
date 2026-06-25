import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import db from '../db/connection';

const router = Router();

const newsRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // max 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/**
 * GET /api/news
 *
 * Returns the latest 50 processed articles sorted by published_at DESC.
 * Supports an optional `category` query parameter for filtering.
 *
 * @example GET /api/news
 * @example GET /api/news?category=gaming
 */
router.get('/news', newsRateLimit, async (req: Request, res: Response) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;

    const query = db('articles')
      .select(
        'id',
        'title',
        'source_url',
        'summary',
        'category',
        'published_at',
        'created_at',
      )
      .orderBy('published_at', 'desc')
      .limit(50);

    if (category) {
      void query.where({ category });
    }

    const articles = await query;
    res.json({ data: articles, total: articles.length });
  } catch (err) {
    console.error('[GET /api/news] Database error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
