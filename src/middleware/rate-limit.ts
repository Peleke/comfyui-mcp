/**
 * Rate Limiting Middleware
 *
 * Uses Upstash Redis for distributed rate limiting.
 * Supports per-API-key and per-IP limiting with configurable tiers.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { Context, Next } from "hono";

// ============================================================================
// Configuration
// ============================================================================

// Upstash Redis configuration
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Skip rate limiting if Redis not configured (development)
const SKIP_RATE_LIMIT = !REDIS_URL || !REDIS_TOKEN;

// Default limits (requests per window)
const DEFAULT_LIMITS = {
  // Per minute
  minute: 100,
  // Per hour
  hour: 1000,
  // Per day
  day: 10000,
};

// Tier-based limits (keyed by API key prefix)
const TIER_LIMITS: Record<string, { minute: number; hour: number }> = {
  free_: { minute: 10, hour: 100 },
  pro_: { minute: 100, hour: 1000 },
  enterprise_: { minute: 1000, hour: 10000 },
};

// ============================================================================
// Rate Limiter Setup
// ============================================================================

let redis: Redis | null = null;
let rateLimiter: Ratelimit | null = null;

function getRateLimiter(): Ratelimit | null {
  if (SKIP_RATE_LIMIT) {
    return null;
  }

  if (!rateLimiter) {
    redis = new Redis({
      url: REDIS_URL!,
      token: REDIS_TOKEN!,
    });

    rateLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(DEFAULT_LIMITS.minute, "1 m"),
      analytics: true,
      prefix: "comfyui-mcp",
    });
  }

  return rateLimiter;
}

// ============================================================================
// Types
// ============================================================================

export interface RateLimitConfig {
  /** Override requests per minute */
  requestsPerMinute?: number;
  /** Skip rate limiting entirely */
  skip?: boolean;
  /** Custom identifier function */
  getIdentifier?: (c: Context) => string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: number;
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Rate limiting middleware using Upstash Redis.
 *
 * Limits requests based on API key (from X-API-Key header) or IP address.
 * Returns 429 Too Many Requests when limit exceeded.
 *
 * Response headers:
 * - X-RateLimit-Limit: Total requests allowed in window
 * - X-RateLimit-Remaining: Requests remaining
 * - X-RateLimit-Reset: Unix timestamp when limit resets
 */
export function createRateLimitMiddleware(config?: RateLimitConfig) {
  const skip = config?.skip ?? SKIP_RATE_LIMIT;

  return async function rateLimitMiddleware(c: Context, next: Next) {
    // Skip if disabled or not configured
    if (skip) {
      if (SKIP_RATE_LIMIT) {
        console.warn("[rate-limit] Skipping - Upstash Redis not configured");
      }
      await next();
      return;
    }

    const limiter = getRateLimiter();
    if (!limiter) {
      await next();
      return;
    }

    // Get identifier (API key or IP)
    const identifier = config?.getIdentifier?.(c) ?? getDefaultIdentifier(c);

    // Get tier-specific limit
    const tierLimit = getTierLimit(identifier);

    // Check rate limit
    const { success, limit, remaining, reset } = await limiter.limit(identifier);

    // Set rate limit headers
    c.header("X-RateLimit-Limit", limit.toString());
    c.header("X-RateLimit-Remaining", remaining.toString());
    c.header("X-RateLimit-Reset", reset.toString());

    if (!success) {
      console.warn(`[rate-limit] Rate limit exceeded for: ${identifier}`);
      return c.json(
        {
          error: "Rate limit exceeded",
          retryAfter: Math.ceil((reset - Date.now()) / 1000),
        },
        429
      );
    }

    await next();
  };
}

/**
 * Get default identifier for rate limiting.
 * Prefers API key, falls back to IP address.
 */
function getDefaultIdentifier(c: Context): string {
  // Try API key first
  const apiKey = c.req.header("X-API-Key");
  if (apiKey) {
    return `api:${apiKey}`;
  }

  // Fall back to IP address
  const forwarded = c.req.header("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
  return `ip:${ip}`;
}

/**
 * Get tier-specific rate limit based on identifier prefix.
 */
function getTierLimit(identifier: string): { minute: number; hour: number } {
  // Check if identifier matches a tier prefix
  for (const [prefix, limits] of Object.entries(TIER_LIMITS)) {
    if (identifier.includes(prefix)) {
      return limits;
    }
  }

  return { minute: DEFAULT_LIMITS.minute, hour: DEFAULT_LIMITS.hour };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check rate limit status without consuming a request.
 * Useful for showing remaining quota to users.
 */
export async function getRateLimitStatus(identifier: string): Promise<RateLimitInfo | null> {
  const limiter = getRateLimiter();
  if (!limiter || !redis) {
    return null;
  }

  // Get current count from Redis
  const key = `comfyui-mcp:${identifier}`;
  const count = await redis.get<number>(key);

  return {
    limit: DEFAULT_LIMITS.minute,
    remaining: Math.max(0, DEFAULT_LIMITS.minute - (count || 0)),
    reset: Date.now() + 60000, // Approximate
  };
}

/**
 * Reset rate limit for an identifier.
 * Use with caution - mainly for admin/testing purposes.
 */
export async function resetRateLimit(identifier: string): Promise<boolean> {
  if (!redis) {
    return false;
  }

  const key = `comfyui-mcp:${identifier}`;
  await redis.del(key);
  return true;
}

// Default export for easy import
export const rateLimitMiddleware = createRateLimitMiddleware();
