/**
 * Redis client — used for quote caching.
 * Gracefully degrades if Redis is unavailable (caching simply skipped).
 */
import Redis from "ioredis";
import { logger } from "../utils/logger";

let client: Redis | null = null;
let available = false;

export function getRedis(): Redis | null {
  return available ? client : null;
}

export async function connectRedis(): Promise<void> {
  if (!process.env.REDIS_URL) {
    logger.warn("REDIS_URL not set — caching disabled");
    return;
  }

  try {
    client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 3000,
    });

    client.on("error", (err) => {
      logger.warn({ err: err.message }, "Redis error — caching degraded");
      available = false;
    });

    await client.connect();
    available = true;
    logger.info("✓ Redis connected");
  } catch (err) {
    logger.warn({ err }, "Redis unavailable — running without cache");
    available = false;
  }
}

/** Cache get — returns null if Redis unavailable or key missing */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!available || !client) return null;
  try {
    const val = await client.get(key);
    return val ? (JSON.parse(val) as T) : null;
  } catch {
    return null;
  }
}

/** Cache set — silently skipped if Redis unavailable */
export async function cacheSet(key: string, value: unknown, ttlSec = 25): Promise<void> {
  if (!available || !client) return;
  try {
    await client.setex(key, ttlSec, JSON.stringify(value));
  } catch {
    // non-fatal
  }
}
