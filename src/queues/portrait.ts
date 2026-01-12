/**
 * Portrait Generation Job Queue
 *
 * Async job processing for portrait generation.
 */

import { SimpleQueue, getQueue } from "./simple-queue.js";
import { createPortrait, createPortraitSchema } from "../tools/avatar.js";
import type { ComfyUIClient } from "../comfyui-client.js";
import type { z } from "zod";

// ============================================================================
// Types
// ============================================================================

export interface PortraitJobPayload {
  /** Portrait generation parameters */
  params: z.infer<typeof createPortraitSchema>;
  /** Optional webhook URL to notify on completion */
  callbackUrl?: string;
  /** User ID for tracking */
  userId?: string;
  /** Request ID for correlation */
  requestId?: string;
}

export interface PortraitJobResult {
  status: "complete" | "failed";
  result?: {
    localPath: string;
    signedUrl?: string;
    prompt: string;
    model: string;
  };
  error?: string;
  requestId?: string;
}

// ============================================================================
// Queue Setup
// ============================================================================

let portraitQueue: SimpleQueue<PortraitJobPayload, PortraitJobResult> | null = null;

/**
 * Initialize the portrait queue with the ComfyUI client.
 * Must be called before using the queue.
 */
export function initPortraitQueue(client: ComfyUIClient): SimpleQueue<PortraitJobPayload, PortraitJobResult> {
  if (portraitQueue) {
    return portraitQueue;
  }

  portraitQueue = getQueue<PortraitJobPayload, PortraitJobResult>(
    "portrait",
    async (job) => {
      console.log(`[portrait-queue] Processing: ${job.requestId || "unknown"}`);

      try {
        const result = await createPortrait(job.params, client);

        const jobResult: PortraitJobResult = {
          status: "complete",
          result: {
            localPath: result.image,
            signedUrl: result.remote_url,
            prompt: result.prompt,
            model: result.model,
          },
          requestId: job.requestId,
        };

        // Notify via webhook if provided
        if (job.callbackUrl) {
          await notifyWebhook(job.callbackUrl, jobResult);
        }

        return jobResult;
      } catch (err) {
        const jobResult: PortraitJobResult = {
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
    { concurrency: 2, maxRetries: 3, timeout: 5 * 60 * 1000 }
  );

  return portraitQueue;
}

/**
 * Get the portrait queue (must be initialized first).
 */
export function getPortraitQueue(): SimpleQueue<PortraitJobPayload, PortraitJobResult> {
  if (!portraitQueue) {
    throw new Error("Portrait queue not initialized. Call initPortraitQueue first.");
  }
  return portraitQueue;
}

// ============================================================================
// Helpers
// ============================================================================

async function notifyWebhook(url: string, result: PortraitJobResult): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    console.log(`[portrait-queue] Webhook notified: ${url}`);
  } catch (err) {
    console.error(`[portrait-queue] Webhook notification failed: ${url}`, err);
  }
}
