/**
 * API Authentication Middleware
 *
 * Implements API key + HMAC signature validation for service-to-service auth.
 * Prevents replay attacks and validates request integrity.
 */

import { createHmac } from "crypto";
import type { Context, Next } from "hono";

// ============================================================================
// Configuration
// ============================================================================

// Comma-separated list of valid API keys
const API_KEYS = (process.env.COMFYUI_API_KEYS || "").split(",").filter(Boolean);
const API_SECRET = process.env.COMFYUI_API_SECRET || "";

// Timestamp window for replay protection (5 minutes)
const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

// Skip auth in development if no keys configured
const SKIP_AUTH = process.env.NODE_ENV !== "production" && API_KEYS.length === 0;

// ============================================================================
// Types
// ============================================================================

export interface AuthConfig {
  /** Override API keys (for testing) */
  apiKeys?: string[];
  /** Override API secret (for testing) */
  apiSecret?: string;
  /** Skip auth entirely (development only) */
  skipAuth?: boolean;
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Validates API key and HMAC signature on requests.
 *
 * Required headers:
 * - X-API-Key: Valid API key from COMFYUI_API_KEYS
 * - X-Timestamp: Unix timestamp in milliseconds
 * - X-Signature: HMAC-SHA256 of "{timestamp}:{body}" using COMFYUI_API_SECRET
 */
export function createAuthMiddleware(config?: AuthConfig) {
  const apiKeys = config?.apiKeys || API_KEYS;
  const apiSecret = config?.apiSecret || API_SECRET;
  const skipAuth = config?.skipAuth ?? SKIP_AUTH;

  return async function authMiddleware(c: Context, next: Next) {
    // Skip auth in development if not configured
    if (skipAuth) {
      console.warn("[auth] Skipping auth - no API keys configured (dev mode)");
      await next();
      return;
    }

    // Check if API keys are configured
    if (apiKeys.length === 0) {
      console.error("[auth] No API keys configured - rejecting all requests");
      return c.json({ error: "Server misconfigured: no API keys" }, 500);
    }

    // Extract headers
    const apiKey = c.req.header("X-API-Key");
    const timestamp = c.req.header("X-Timestamp");
    const signature = c.req.header("X-Signature");

    // Validate API key presence
    if (!apiKey) {
      return c.json({ error: "Missing X-API-Key header" }, 401);
    }

    // Validate API key
    if (!apiKeys.includes(apiKey)) {
      console.warn(`[auth] Invalid API key attempted: ${apiKey.substring(0, 8)}...`);
      return c.json({ error: "Invalid API key" }, 401);
    }

    // Validate timestamp presence
    if (!timestamp) {
      return c.json({ error: "Missing X-Timestamp header" }, 401);
    }

    // Validate timestamp format and window
    const requestTime = parseInt(timestamp, 10);
    if (isNaN(requestTime)) {
      return c.json({ error: "Invalid X-Timestamp format" }, 401);
    }

    const now = Date.now();
    const age = Math.abs(now - requestTime);
    if (age > TIMESTAMP_WINDOW_MS) {
      console.warn(`[auth] Request expired: age=${age}ms, window=${TIMESTAMP_WINDOW_MS}ms`);
      return c.json({ error: "Request expired (timestamp too old or future)" }, 401);
    }

    // Validate signature presence
    if (!signature) {
      return c.json({ error: "Missing X-Signature header" }, 401);
    }

    // Validate HMAC signature
    if (!apiSecret) {
      console.error("[auth] No API secret configured - cannot verify signatures");
      return c.json({ error: "Server misconfigured: no API secret" }, 500);
    }

    // Get request body for signature verification
    const body = await c.req.text();

    // Compute expected signature: HMAC-SHA256("{timestamp}:{body}")
    const expectedSignature = createHmac("sha256", apiSecret)
      .update(`${timestamp}:${body}`)
      .digest("hex");

    // Timing-safe comparison to prevent timing attacks
    if (!timingSafeEqual(signature, expectedSignature)) {
      console.warn("[auth] Invalid signature");
      return c.json({ error: "Invalid signature" }, 401);
    }

    // Auth passed - continue to handler
    // Store parsed body for downstream handlers (since we already consumed it)
    if (body) {
      try {
        c.set("parsedBody", JSON.parse(body));
      } catch {
        // Not JSON, that's okay
      }
    }

    await next();
  };
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ============================================================================
// Client Helpers (for landline-landing to use)
// ============================================================================

/**
 * Generate auth headers for a request to comfyui-mcp service.
 * Use this in landline-landing when calling the service.
 *
 * @example
 * ```typescript
 * const headers = generateAuthHeaders(body, apiKey, apiSecret);
 * fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
 * ```
 */
export function generateAuthHeaders(
  body: unknown,
  apiKey: string,
  apiSecret: string
): Record<string, string> {
  const timestamp = Date.now().toString();
  const bodyString = typeof body === "string" ? body : JSON.stringify(body);

  const signature = createHmac("sha256", apiSecret)
    .update(`${timestamp}:${bodyString}`)
    .digest("hex");

  return {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
    "X-Timestamp": timestamp,
    "X-Signature": signature,
  };
}

// Default export for easy import
export const authMiddleware = createAuthMiddleware();
