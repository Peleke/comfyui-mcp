#!/usr/bin/env node
/**
 * HTTP Server for comfyui-mcp
 * Exposes generation tools as REST endpoints for web clients
 *
 * Usage:
 *   npx @peleke/comfyui-mcp serve --port 3001
 *   COMFYUI_URL=https://pod-8188.proxy.runpod.net node dist/http-server.js
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { ComfyUIClient } from "./comfyui-client.js";
import { createPortrait, createPortraitSchema } from "./tools/avatar.js";
import { ttsGenerate, ttsGenerateSchema } from "./tools/tts.js";
import { lipSyncGenerate, lipSyncGenerateSchema } from "./tools/lipsync.js";
import { imagine, imagineSchema } from "./tools/imagine.js";
import { generateImage, generateImageSchema } from "./tools/generate.js";
import { upscaleImage, upscaleSchema } from "./tools/upscale.js";
import {
  generateWithControlNet,
  generateWithControlNetSchema,
  generateWithMultiControlNet,
  generateWithMultiControlNetSchema,
  preprocessControlImage,
  preprocessControlImageSchema,
} from "./tools/controlnet.js";
import {
  inpaint,
  inpaintSchema,
  outpaint,
  outpaintSchema,
} from "./tools/inpaint.js";
import { checkConnection, pingComfyUI } from "./tools/health.js";
import { listModels } from "./tools/list-models.js";
import { mkdir } from "fs/promises";
import { join, basename } from "path";
import { randomUUID } from "crypto";
import {
  getStorageProvider,
  isCloudStorageConfigured,
  generateRemotePath,
} from "./storage/index.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createRateLimitMiddleware } from "./middleware/rate-limit.js";
import {
  initPortraitQueue,
  getPortraitQueue,
  initTTSQueue,
  getTTSQueue,
  initLipsyncQueue,
  getLipsyncQueue,
  startQueueCleanup,
} from "./queues/index.js";

// ============================================================================
// Configuration
// ============================================================================

const COMFYUI_URL = process.env.COMFYUI_URL || "http://localhost:8188";
const COMFYUI_MODEL = process.env.COMFYUI_MODEL || "";
const OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR || "/tmp/comfyui-output";
const PORT = parseInt(process.env.PORT || "3001", 10);
const NODE_ENV = process.env.NODE_ENV || "development";

// CORS origins (comma-separated in production)
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(",") || ["*"];

// Initialize ComfyUI client (exported for queues)
export const client = new ComfyUIClient({
  url: COMFYUI_URL,
  outputDir: OUTPUT_DIR,
});

// Initialize middleware
const authMiddleware = createAuthMiddleware();
const rateLimitMiddleware = createRateLimitMiddleware();

// ============================================================================
// App Setup
// ============================================================================

const app = new Hono();

// CORS for web clients (restrictive in production)
app.use("/*", cors({
  origin: NODE_ENV === "production" ? CORS_ORIGINS : "*",
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Timestamp", "X-Signature"],
  exposeHeaders: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
}));

// Request logging
app.use("/*", async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`${c.req.method} ${c.req.path} - ${c.res.status} (${ms}ms)`);
});

// Rate limiting on all routes
app.use("/*", rateLimitMiddleware);

// Auth middleware on generation endpoints (skip health/info)
app.use("/portrait", authMiddleware);
app.use("/portrait/async", authMiddleware);
app.use("/tts", authMiddleware);
app.use("/tts/async", authMiddleware);
app.use("/lipsync", authMiddleware);
app.use("/lipsync/async", authMiddleware);
app.use("/imagine", authMiddleware);
app.use("/image", authMiddleware);
app.use("/upscale", authMiddleware);
app.use("/controlnet", authMiddleware);
app.use("/controlnet/*", authMiddleware);
app.use("/preprocess/*", authMiddleware);
app.use("/inpaint", authMiddleware);
app.use("/outpaint", authMiddleware);

// ============================================================================
// Health Endpoints
// ============================================================================

app.get("/health", async (c) => {
  try {
    const [ping, health] = await Promise.all([
      pingComfyUI(client),
      checkConnection({}, client),
    ]);

    return c.json({
      status: ping.reachable ? "healthy" : "unhealthy",
      latency_ms: ping.latency_ms,
      gpu: health.gpu,
      storage: health.storage,
      comfyui_version: health.system?.comfyui_version,
    });
  } catch (err) {
    return c.json({
      status: "unhealthy",
      error: err instanceof Error ? err.message : "Unknown error",
    }, 503);
  }
});

app.get("/ping", async (c) => {
  const result = await pingComfyUI(client);
  return c.json(result);
});

// ============================================================================
// Generation Endpoints
// ============================================================================

/**
 * POST /portrait - Generate a portrait image
 */
app.post("/portrait", async (c) => {
  try {
    const body = await c.req.json();

    if (!body.description) {
      return c.json({ error: "description is required" }, 400);
    }

    // Generate output path if not provided
    const outputPath = body.output_path || join(OUTPUT_DIR, `portrait_${randomUUID()}.png`);
    await mkdir(OUTPUT_DIR, { recursive: true });

    const input = createPortraitSchema.parse({
      ...body,
      output_path: outputPath,
      upload_to_cloud: body.upload_to_cloud ?? true,
    });

    const result = await createPortrait(input, client);

    return c.json({
      success: true,
      localPath: result.image,
      signedUrl: result.remote_url,
      prompt: result.prompt,
      model: result.model,
      taskId: result.taskId,
    });
  } catch (err) {
    console.error("Portrait generation failed:", err);
    return c.json({
      error: err instanceof Error ? err.message : "Generation failed",
    }, 500);
  }
});

/**
 * POST /tts - Text-to-speech with voice cloning
 */
app.post("/tts", async (c) => {
  try {
    const body = await c.req.json();

    if (!body.text) {
      return c.json({ error: "text is required" }, 400);
    }
    if (!body.voice_reference) {
      return c.json({ error: "voice_reference is required" }, 400);
    }

    const outputPath = body.output_path || join(OUTPUT_DIR, `tts_${randomUUID()}.wav`);
    await mkdir(OUTPUT_DIR, { recursive: true });

    const input = ttsGenerateSchema.parse({
      ...body,
      output_path: outputPath,
      upload_to_cloud: body.upload_to_cloud ?? true,
    });

    const result = await ttsGenerate(input, client);

    return c.json({
      success: true,
      localPath: result.audio,
      signedUrl: result.remote_url,
      taskId: result.taskId,
    });
  } catch (err) {
    console.error("TTS generation failed:", err);
    return c.json({
      error: err instanceof Error ? err.message : "Generation failed",
    }, 500);
  }
});

/**
 * POST /lipsync - Generate lip-sync video
 */
app.post("/lipsync", async (c) => {
  try {
    const body = await c.req.json();

    if (!body.portrait_image) {
      return c.json({ error: "portrait_image is required" }, 400);
    }
    if (!body.audio) {
      return c.json({ error: "audio is required" }, 400);
    }

    const outputPath = body.output_path || join(OUTPUT_DIR, `lipsync_${randomUUID()}.mp4`);
    await mkdir(OUTPUT_DIR, { recursive: true });

    const input = lipSyncGenerateSchema.parse({
      ...body,
      output_path: outputPath,
      upload_to_cloud: body.upload_to_cloud ?? true,
    });

    const result = await lipSyncGenerate(input, client);

    return c.json({
      success: true,
      localPath: result.video,
      signedUrl: result.remote_url,
      taskId: result.taskId,
    });
  } catch (err) {
    console.error("Lipsync generation failed:", err);
    return c.json({
      error: err instanceof Error ? err.message : "Generation failed",
    }, 500);
  }
});

/**
 * POST /imagine - High-level image generation (auto prompt crafting)
 */
app.post("/imagine", async (c) => {
  try {
    const body = await c.req.json();

    if (!body.description) {
      return c.json({ error: "description is required" }, 400);
    }

    const outputPath = body.output_path || join(OUTPUT_DIR, `imagine_${randomUUID()}.png`);
    await mkdir(OUTPUT_DIR, { recursive: true });

    const input = imagineSchema.parse({
      ...body,
      output_path: outputPath,
    });

    const result = await imagine(client, input, COMFYUI_MODEL);

    // Upload to cloud storage if configured
    let signedUrl: string | undefined;
    const uploadToCloud = body.upload_to_cloud ?? true;
    if (uploadToCloud && isCloudStorageConfigured()) {
      try {
        const storage = getStorageProvider();
        const remotePath = generateRemotePath("images", basename(outputPath));
        const uploadResult = await storage.upload(result.imagePath, remotePath);
        signedUrl = uploadResult.signedUrl || uploadResult.url || undefined;
      } catch (uploadErr) {
        console.error("Cloud upload failed:", uploadErr);
      }
    }

    return c.json({
      success: true,
      localPath: result.imagePath,
      signedUrl,
      prompt: result.prompt.positive,
      negativePrompt: result.prompt.negative,
      modelFamily: result.modelFamily,
      seed: result.seed,
      pipelineSteps: result.pipelineSteps,
      settings: result.settings,
    });
  } catch (err) {
    console.error("Imagine generation failed:", err);
    return c.json({
      error: err instanceof Error ? err.message : "Generation failed",
    }, 500);
  }
});

/**
 * POST /image - Direct image generation (lower level)
 */
app.post("/image", async (c) => {
  try {
    const body = await c.req.json();

    if (!body.prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }

    const outputPath = body.output_path || join(OUTPUT_DIR, `image_${randomUUID()}.png`);
    await mkdir(OUTPUT_DIR, { recursive: true });

    const input = generateImageSchema.parse({
      prompt: body.prompt,
      negative_prompt: body.negative_prompt,
      width: body.width ?? 512,
      height: body.height ?? 768,
      steps: body.steps ?? 28,
      cfg_scale: body.cfg_scale ?? 7,
      sampler: body.sampler ?? "euler_ancestral",
      scheduler: body.scheduler ?? "normal",
      model: body.model,
      seed: body.seed,
      loras: body.loras,
      output_path: outputPath,
    });

    const result = await generateImage(client, input, COMFYUI_MODEL);

    // Upload to cloud storage if configured
    let signedUrl: string | undefined;
    const uploadToCloud = body.upload_to_cloud ?? true;
    if (uploadToCloud && isCloudStorageConfigured()) {
      try {
        const storage = getStorageProvider();
        const remotePath = generateRemotePath("images", basename(outputPath));
        const uploadResult = await storage.upload(result.path, remotePath);
        signedUrl = uploadResult.signedUrl || uploadResult.url || undefined;
      } catch (uploadErr) {
        console.error("Cloud upload failed:", uploadErr);
      }
    }

    return c.json({
      success: true,
      localPath: result.path,
      signedUrl,
      seed: result.seed,
    });
  } catch (err) {
    console.error("Image generation failed:", err);
    return c.json({
      error: err instanceof Error ? err.message : "Generation failed",
    }, 500);
  }
});

/**
 * POST /upscale - Upscale an image using AI upscaling models
 */
app.post("/upscale", async (c) => {
  try {
    const body = await c.req.json();

    if (!body.input_image) {
      return c.json({ error: "input_image is required" }, 400);
    }

    const outputPath = body.output_path || join(OUTPUT_DIR, `upscale_${randomUUID()}.png`);
    await mkdir(OUTPUT_DIR, { recursive: true });

    const input = upscaleSchema.parse({
      input_image: body.input_image,
      upscale_model: body.upscale_model ?? "RealESRGAN_x4plus.pth",
      target_width: body.target_width,
      target_height: body.target_height,
      output_path: outputPath,
    });

    const result = await upscaleImage(client, input);

    // Upload to cloud storage if configured
    let signedUrl: string | undefined;
    const uploadToCloud = body.upload_to_cloud ?? true;
    if (uploadToCloud && isCloudStorageConfigured()) {
      try {
        const storage = getStorageProvider();
        const remotePath = generateRemotePath("images", basename(outputPath));
        const uploadResult = await storage.upload(result.path, remotePath);
        signedUrl = uploadResult.signedUrl || uploadResult.url || undefined;
      } catch (uploadErr) {
        console.error("Cloud upload failed:", uploadErr);
      }
    }

    return c.json({
      success: true,
      localPath: result.path,
      signedUrl,
      message: result.message,
    });
  } catch (err) {
    console.error("Upscale failed:", err);
    return c.json({
      error: err instanceof Error ? err.message : "Upscale failed",
    }, 500);
  }
});

/**
 * POST /controlnet - Single ControlNet generation
 */
app.post("/controlnet", async (c) => {
  try {
    const body = await c.req.json();

    if (!body.prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }
    if (!body.control_image) {
      return c.json({ error: "control_image is required" }, 400);
    }
    if (!body.control_type) {
      return c.json({ error: "control_type is required" }, 400);
    }

    const outputPath = body.output_path || join(OUTPUT_DIR, `controlnet_${randomUUID()}.png`);
    await mkdir(OUTPUT_DIR, { recursive: true });

    const input = generateWithControlNetSchema.parse({
      ...body,
      output_path: outputPath,
    });

    const result = await generateWithControlNet(client, input, COMFYUI_MODEL);

    // Upload to cloud storage if configured
    let signedUrl: string | undefined;
    const uploadToCloud = body.upload_to_cloud ?? true;
    if (uploadToCloud && isCloudStorageConfigured()) {
      try {
        const storage = getStorageProvider();
        const remotePath = generateRemotePath("images", basename(outputPath));
        const uploadResult = await storage.upload(result.path, remotePath);
        signedUrl = uploadResult.signedUrl || uploadResult.url || undefined;
      } catch (uploadErr) {
        console.error("Cloud upload failed:", uploadErr);
      }
    }

    return c.json({
      success: true,
      localPath: result.path,
      signedUrl,
      seed: result.seed,
      controlType: result.control_type,
      message: result.message,
    });
  } catch (err) {
    console.error("ControlNet generation failed:", err);
    return c.json({
      error: err instanceof Error ? err.message : "ControlNet generation failed",
    }, 500);
  }
});

/**
 * POST /controlnet/multi - Multi-ControlNet stacking (1-5 conditions)
 */
app.post("/controlnet/multi", async (c) => {
  try {
    const body = await c.req.json();

    if (!body.prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }
    if (!body.controls || !Array.isArray(body.controls) || body.controls.length === 0) {
      return c.json({ error: "controls array is required (1-5 conditions)" }, 400);
    }

    const outputPath = body.output_path || join(OUTPUT_DIR, `controlnet_multi_${randomUUID()}.png`);
    await mkdir(OUTPUT_DIR, { recursive: true });

    const input = generateWithMultiControlNetSchema.parse({
      ...body,
      output_path: outputPath,
    });

    const result = await generateWithMultiControlNet(client, input, COMFYUI_MODEL);

    // Upload to cloud storage if configured
    let signedUrl: string | undefined;
    const uploadToCloud = body.upload_to_cloud ?? true;
    if (uploadToCloud && isCloudStorageConfigured()) {
      try {
        const storage = getStorageProvider();
        const remotePath = generateRemotePath("images", basename(outputPath));
        const uploadResult = await storage.upload(result.path, remotePath);
        signedUrl = uploadResult.signedUrl || uploadResult.url || undefined;
      } catch (uploadErr) {
        console.error("Cloud upload failed:", uploadErr);
      }
    }

    return c.json({
      success: true,
      localPath: result.path,
      signedUrl,
      seed: result.seed,
      controlTypes: result.control_types,
      message: result.message,
    });
  } catch (err) {
    console.error("Multi-ControlNet generation failed:", err);
    return c.json({
      error: err instanceof Error ? err.message : "Multi-ControlNet generation failed",
    }, 500);
  }
});

/**
 * POST /preprocess/:type - Control image preprocessing
 */
app.post("/preprocess/:type", async (c) => {
  try {
    const controlType = c.req.param("type");
    const body = await c.req.json();

    if (!body.input_image) {
      return c.json({ error: "input_image is required" }, 400);
    }

    const validTypes = ["canny", "depth", "openpose", "scribble", "lineart", "semantic_seg"];
    if (!validTypes.includes(controlType)) {
      return c.json({
        error: `Invalid control type. Must be one of: ${validTypes.join(", ")}`,
      }, 400);
    }

    const outputPath = body.output_path || join(OUTPUT_DIR, `preprocess_${controlType}_${randomUUID()}.png`);
    await mkdir(OUTPUT_DIR, { recursive: true });

    const input = preprocessControlImageSchema.parse({
      input_image: body.input_image,
      control_type: controlType,
      preprocessor_options: body.preprocessor_options,
      output_path: outputPath,
    });

    const result = await preprocessControlImage(client, input);

    // Upload to cloud storage if configured
    let signedUrl: string | undefined;
    const uploadToCloud = body.upload_to_cloud ?? true;
    if (uploadToCloud && isCloudStorageConfigured()) {
      try {
        const storage = getStorageProvider();
        const remotePath = generateRemotePath("images", basename(outputPath));
        const uploadResult = await storage.upload(result.path, remotePath);
        signedUrl = uploadResult.signedUrl || uploadResult.url || undefined;
      } catch (uploadErr) {
        console.error("Cloud upload failed:", uploadErr);
      }
    }

    return c.json({
      success: true,
      localPath: result.path,
      signedUrl,
      message: result.message,
    });
  } catch (err) {
    console.error("Preprocess failed:", err);
    return c.json({
      error: err instanceof Error ? err.message : "Preprocess failed",
    }, 500);
  }
});

/**
 * POST /inpaint - Inpaint an image using a mask
 */
app.post("/inpaint", async (c) => {
  try {
    const body = await c.req.json();

    if (!body.prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }
    if (!body.source_image) {
      return c.json({ error: "source_image is required" }, 400);
    }
    if (!body.mask_image) {
      return c.json({ error: "mask_image is required" }, 400);
    }

    const outputPath = body.output_path || join(OUTPUT_DIR, `inpaint_${randomUUID()}.png`);
    await mkdir(OUTPUT_DIR, { recursive: true });

    const input = inpaintSchema.parse({
      ...body,
      output_path: outputPath,
    });

    const result = await inpaint(client, input, COMFYUI_MODEL);

    // Upload to cloud storage if configured
    let signedUrl: string | undefined;
    const uploadToCloud = body.upload_to_cloud ?? true;
    if (uploadToCloud && isCloudStorageConfigured()) {
      try {
        const storage = getStorageProvider();
        const remotePath = generateRemotePath("images", basename(outputPath));
        const uploadResult = await storage.upload(result.path, remotePath);
        signedUrl = uploadResult.signedUrl || uploadResult.url || undefined;
      } catch (uploadErr) {
        console.error("Cloud upload failed:", uploadErr);
      }
    }

    return c.json({
      success: true,
      localPath: result.path,
      signedUrl,
      seed: result.seed,
      message: result.message,
    });
  } catch (err) {
    console.error("Inpaint failed:", err);
    return c.json({
      error: err instanceof Error ? err.message : "Inpaint failed",
    }, 500);
  }
});

/**
 * POST /outpaint - Extend an image canvas
 */
app.post("/outpaint", async (c) => {
  try {
    const body = await c.req.json();

    if (!body.prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }
    if (!body.source_image) {
      return c.json({ error: "source_image is required" }, 400);
    }

    // Check at least one extend direction is specified
    const totalExtend =
      (body.extend_left ?? 0) +
      (body.extend_right ?? 0) +
      (body.extend_top ?? 0) +
      (body.extend_bottom ?? 0);

    if (totalExtend === 0) {
      return c.json({
        error: "At least one extend direction must be specified (extend_left, extend_right, extend_top, extend_bottom)",
      }, 400);
    }

    const outputPath = body.output_path || join(OUTPUT_DIR, `outpaint_${randomUUID()}.png`);
    await mkdir(OUTPUT_DIR, { recursive: true });

    const input = outpaintSchema.parse({
      ...body,
      output_path: outputPath,
    });

    const result = await outpaint(client, input, COMFYUI_MODEL);

    // Upload to cloud storage if configured
    let signedUrl: string | undefined;
    const uploadToCloud = body.upload_to_cloud ?? true;
    if (uploadToCloud && isCloudStorageConfigured()) {
      try {
        const storage = getStorageProvider();
        const remotePath = generateRemotePath("images", basename(outputPath));
        const uploadResult = await storage.upload(result.path, remotePath);
        signedUrl = uploadResult.signedUrl || uploadResult.url || undefined;
      } catch (uploadErr) {
        console.error("Cloud upload failed:", uploadErr);
      }
    }

    return c.json({
      success: true,
      localPath: result.path,
      signedUrl,
      seed: result.seed,
      message: result.message,
    });
  } catch (err) {
    console.error("Outpaint failed:", err);
    return c.json({
      error: err instanceof Error ? err.message : "Outpaint failed",
    }, 500);
  }
});

// ============================================================================
// Async Queue Endpoints
// ============================================================================

// Enable async mode via environment variable
const ASYNC_MODE = process.env.ENABLE_ASYNC_QUEUES === "true";

// Initialize queues if async mode enabled
if (ASYNC_MODE) {
  initPortraitQueue(client);
  initTTSQueue(client);
  initLipsyncQueue(client);
  startQueueCleanup();
  console.log("Async job queues initialized");
}

/**
 * POST /portrait/async - Queue portrait generation (async)
 */
app.post("/portrait/async", async (c) => {
  if (!ASYNC_MODE) {
    return c.json({ error: "Async mode not enabled. Set ENABLE_ASYNC_QUEUES=true" }, 503);
  }

  try {
    const body = await c.req.json();

    if (!body.description) {
      return c.json({ error: "description is required" }, 400);
    }

    const outputPath = body.output_path || join(OUTPUT_DIR, `portrait_${randomUUID()}.png`);
    await mkdir(OUTPUT_DIR, { recursive: true });

    const queue = getPortraitQueue();
    const job = await queue.enqueue({
      params: {
        ...body,
        output_path: outputPath,
        upload_to_cloud: body.upload_to_cloud ?? true,
      },
      callbackUrl: body.callbackUrl,
      requestId: randomUUID(),
    });

    return c.json({
      status: "queued",
      jobId: job.id,
      pollUrl: `/jobs/portrait/${job.id}`,
    });
  } catch (err) {
    console.error("Portrait queue failed:", err);
    return c.json({
      error: err instanceof Error ? err.message : "Queue failed",
    }, 500);
  }
});

/**
 * POST /tts/async - Queue TTS generation (async)
 */
app.post("/tts/async", async (c) => {
  if (!ASYNC_MODE) {
    return c.json({ error: "Async mode not enabled. Set ENABLE_ASYNC_QUEUES=true" }, 503);
  }

  try {
    const body = await c.req.json();

    if (!body.text) {
      return c.json({ error: "text is required" }, 400);
    }
    if (!body.voice_reference) {
      return c.json({ error: "voice_reference is required" }, 400);
    }

    const outputPath = body.output_path || join(OUTPUT_DIR, `tts_${randomUUID()}.wav`);
    await mkdir(OUTPUT_DIR, { recursive: true });

    const queue = getTTSQueue();
    const job = await queue.enqueue({
      params: {
        ...body,
        output_path: outputPath,
        upload_to_cloud: body.upload_to_cloud ?? true,
      },
      callbackUrl: body.callbackUrl,
      requestId: randomUUID(),
    });

    return c.json({
      status: "queued",
      jobId: job.id,
      pollUrl: `/jobs/tts/${job.id}`,
    });
  } catch (err) {
    console.error("TTS queue failed:", err);
    return c.json({
      error: err instanceof Error ? err.message : "Queue failed",
    }, 500);
  }
});

/**
 * POST /lipsync/async - Queue lipsync generation (async)
 */
app.post("/lipsync/async", async (c) => {
  if (!ASYNC_MODE) {
    return c.json({ error: "Async mode not enabled. Set ENABLE_ASYNC_QUEUES=true" }, 503);
  }

  try {
    const body = await c.req.json();

    if (!body.portrait_image) {
      return c.json({ error: "portrait_image is required" }, 400);
    }
    if (!body.audio) {
      return c.json({ error: "audio is required" }, 400);
    }

    const outputPath = body.output_path || join(OUTPUT_DIR, `lipsync_${randomUUID()}.mp4`);
    await mkdir(OUTPUT_DIR, { recursive: true });

    const queue = getLipsyncQueue();
    const job = await queue.enqueue({
      params: {
        ...body,
        output_path: outputPath,
        upload_to_cloud: body.upload_to_cloud ?? true,
      },
      callbackUrl: body.callbackUrl,
      requestId: randomUUID(),
    });

    return c.json({
      status: "queued",
      jobId: job.id,
      pollUrl: `/jobs/lipsync/${job.id}`,
    });
  } catch (err) {
    console.error("Lipsync queue failed:", err);
    return c.json({
      error: err instanceof Error ? err.message : "Queue failed",
    }, 500);
  }
});

/**
 * GET /jobs/:type/:id - Poll job status
 */
app.get("/jobs/:type/:id", async (c) => {
  if (!ASYNC_MODE) {
    return c.json({ error: "Async mode not enabled" }, 503);
  }

  const { type, id } = c.req.param();
  let job;

  try {
    switch (type) {
      case "portrait":
        job = getPortraitQueue().getJob(id);
        break;
      case "tts":
        job = getTTSQueue().getJob(id);
        break;
      case "lipsync":
        job = getLipsyncQueue().getJob(id);
        break;
      default:
        return c.json({ error: "Unknown job type" }, 400);
    }

    if (!job) {
      return c.json({ error: "Job not found" }, 404);
    }

    return c.json({
      id: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });
  } catch (err) {
    return c.json({
      error: err instanceof Error ? err.message : "Failed to get job status",
    }, 500);
  }
});

// ============================================================================
// Discovery Endpoints
// ============================================================================

app.get("/models", async (c) => {
  try {
    const models = await listModels(client);
    return c.json({ models });
  } catch (err) {
    return c.json({
      error: err instanceof Error ? err.message : "Failed to list models",
    }, 500);
  }
});

// ============================================================================
// Root / Info
// ============================================================================

app.get("/", (c) => {
  const info: Record<string, unknown> = {
    name: "comfyui-mcp",
    version: "1.0.0",
    description: "HTTP API for ComfyUI generation",
    endpoints: {
      "GET /health": "Health check with GPU info",
      "GET /ping": "Quick connectivity check",
      "GET /models": "List available models",
      "POST /portrait": "Generate portrait image (auth required)",
      "POST /portrait/async": "Queue portrait generation (auth required)",
      "POST /tts": "Text-to-speech with voice cloning (auth required)",
      "POST /tts/async": "Queue TTS generation (auth required)",
      "POST /lipsync": "Generate lip-sync video (auth required)",
      "POST /lipsync/async": "Queue lipsync generation (auth required)",
      "POST /imagine": "High-level image generation (auth required)",
      "POST /image": "Direct image generation (auth required)",
      "POST /upscale": "AI image upscaling (auth required)",
      "POST /controlnet": "Single ControlNet generation (auth required)",
      "POST /controlnet/multi": "Multi-ControlNet stacking (auth required)",
      "POST /preprocess/:type": "Control image preprocessing (auth required)",
      "POST /inpaint": "Inpaint image regions with mask (auth required)",
      "POST /outpaint": "Extend image canvas (auth required)",
    },
    async: {
      enabled: ASYNC_MODE,
      note: "Async endpoints return jobId; poll /jobs/:id or provide callbackUrl",
    },
    auth: {
      required: NODE_ENV === "production",
      headers: ["X-API-Key", "X-Timestamp", "X-Signature"],
    },
  };

  // Only expose config in development
  if (NODE_ENV !== "production") {
    info.config = {
      comfyui_url: COMFYUI_URL,
      output_dir: OUTPUT_DIR,
    };
  }

  return c.json(info);
});

// ============================================================================
// Start Server
// ============================================================================

function startServer(port: number = PORT) {
  console.log(`Starting comfyui-mcp HTTP server...`);
  console.log(`  ComfyUI URL: ${COMFYUI_URL}`);
  console.log(`  Output dir: ${OUTPUT_DIR}`);
  console.log(`  Port: ${port}`);

  serve({
    fetch: app.fetch,
    port,
  }, (info) => {
    console.log(`Server running at http://localhost:${info.port}`);
  });
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const portArg = process.argv.find(arg => arg.startsWith("--port="));
  const port = portArg ? parseInt(portArg.split("=")[1], 10) : PORT;
  startServer(port);
}

export { app, startServer };
