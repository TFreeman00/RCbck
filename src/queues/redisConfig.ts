import { ConnectionOptions } from 'bullmq';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Parses the REDIS_URL environment variable and returns a BullMQ-compatible
 * ConnectionOptions object.  Falls back to localhost:6379 if the variable is
 * not set.
 */
function parseRedisConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

  try {
    const parsed = new URL(url);
    const options: ConnectionOptions = {
      host: parsed.hostname || 'localhost',
      port: parsed.port ? Number(parsed.port) : 6379,
    };

    if (parsed.password) {
      (options as { password?: string }).password = parsed.password;
    }
    if (parsed.username) {
      (options as { username?: string }).username = parsed.username;
    }

    return options;
  } catch {
    // If parsing fails, return the raw string and let ioredis handle it
    return { host: 'localhost', port: 6379 };
  }
}

export const redisConnection: ConnectionOptions = parseRedisConnection();
