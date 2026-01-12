/**
 * Lip-sync Generation Job Queue
 *
 * Async job processing for lip-sync video generation.
 */

import { SimpleQueue, getQueue } from "./simple-queue.js";
import { lipSyncGenerate, lipSyncGenerateSchema } from "../tools/lipsync.js";
import type { ComfyUIClient } from "../comfyui-client.js";
import type { z } from "zod";

// ============================================================================
// Types
// ============================================================================

export interface LipsyncJobPayload {
  /** Lipsync generation parameters */
  params: z.infer<typeof lipSyncGenerateSchema>;
  /** Optional webhook URL to notify on completion */
  callbackUrl?: string;
  /** User ID for tracking */
  userId?: string;
  /** Request ID for correlation */
  requestId?: string;
}

export interface LipsyncJobResult {
  status: "complete" | "failed";
  result?: {
    localPath: string;
    signedUrl?: string;
  };
  error?: string;
  requestId?: string;
}

// ============================================================================
// Queue Setup
// ============================================================================

let lipsyncQueue: SimpleQueue<LipsyncJobPayload, LipsyncJobResult> | null = null;

/**
 * Initialize the lipsync queue with the ComfyUI client.
 * Note: Lip-sync is GPU-intensive, so we use lower concurrency.
 */
export function initLipsyncQueue(client: ComfyUIClient): SimpleQueue<LipsyncJobPayload, LipsyncJobResult> {
  if (lipsyncQueue) {
    return lipsyncQueue;
  }

  lipsyncQueue = getQueue<LipsyncJobPayload, LipsyncJobResult>(
    "lipsync",
    async (job) => {
      console.log(`[lipsync-queue] Processing: ${job.requestId || "unknown"}`);

      try {
        const result = await lipSyncGenerate(job.params, client);

        const jobResult: LipsyncJobResult = {
          status: "complete",
          result: {
            localPath: result.video,
            signedUrl: result.remote_url,
          },
          requestId: job.requestId,
        };

        if (job.callbackUrl) {
          await notifyWebhook(job.callbackUrl, jobResult);
        }

        return jobResult;
      } catch (err) {
        const jobResult: LipsyncJobResult = {
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown error",
          requestId: job.requestId,
        };

        if (job.callbackUrl) {
          await notifyWebhook(job.callbackUrl, jobResult);
        }

        throw err;
      }
    },
    // Lower concurrency for GPU-intensive work
    { concurrency: 1, maxRetries: 2, timeout: 10 * 60 * 1000 }
  );

  return lipsyncQueue;
}

/**
 * Get the lipsync queue (must be initialized first).
 */
export function getLipsyncQueue(): SimpleQueue<LipsyncJobPayload, LipsyncJobResult> {
  if (!lipsyncQueue) {
    throw new Error("Lipsync queue not initialized. Call initLipsyncQueue first.");
  }
  return lipsyncQueue;
}

// ============================================================================
// Helpers
// ============================================================================

async function notifyWebhook(url: string, result: LipsyncJobResult): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    console.log(`[lipsync-queue] Webhook notified: ${url}`);
  } catch (err) {
    console.error(`[lipsync-queue] Webhook notification failed: ${url}`, err);
  }
}
