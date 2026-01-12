/**
 * TTS Generation Job Queue
 *
 * Async job processing for text-to-speech with voice cloning.
 */

import { SimpleQueue, getQueue } from "./simple-queue.js";
import { ttsGenerate, ttsGenerateSchema } from "../tools/tts.js";
import type { ComfyUIClient } from "../comfyui-client.js";
import type { z } from "zod";

// ============================================================================
// Types
// ============================================================================

export interface TTSJobPayload {
  /** TTS generation parameters */
  params: z.infer<typeof ttsGenerateSchema>;
  /** Optional webhook URL to notify on completion */
  callbackUrl?: string;
  /** User ID for tracking */
  userId?: string;
  /** Request ID for correlation */
  requestId?: string;
}

export interface TTSJobResult {
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

let ttsQueue: SimpleQueue<TTSJobPayload, TTSJobResult> | null = null;

/**
 * Initialize the TTS queue with the ComfyUI client.
 */
export function initTTSQueue(client: ComfyUIClient): SimpleQueue<TTSJobPayload, TTSJobResult> {
  if (ttsQueue) {
    return ttsQueue;
  }

  ttsQueue = getQueue<TTSJobPayload, TTSJobResult>(
    "tts",
    async (job) => {
      console.log(`[tts-queue] Processing: ${job.requestId || "unknown"}`);

      try {
        const result = await ttsGenerate(job.params, client);

        const jobResult: TTSJobResult = {
          status: "complete",
          result: {
            localPath: result.audio,
            signedUrl: result.remote_url,
          },
          requestId: job.requestId,
        };

        if (job.callbackUrl) {
          await notifyWebhook(job.callbackUrl, jobResult);
        }

        return jobResult;
      } catch (err) {
        const jobResult: TTSJobResult = {
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
    { concurrency: 2, maxRetries: 3, timeout: 3 * 60 * 1000 }
  );

  return ttsQueue;
}

/**
 * Get the TTS queue (must be initialized first).
 */
export function getTTSQueue(): SimpleQueue<TTSJobPayload, TTSJobResult> {
  if (!ttsQueue) {
    throw new Error("TTS queue not initialized. Call initTTSQueue first.");
  }
  return ttsQueue;
}

// ============================================================================
// Helpers
// ============================================================================

async function notifyWebhook(url: string, result: TTSJobResult): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    console.log(`[tts-queue] Webhook notified: ${url}`);
  } catch (err) {
    console.error(`[tts-queue] Webhook notification failed: ${url}`, err);
  }
}
