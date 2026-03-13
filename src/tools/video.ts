import { z } from "zod";
import { ComfyUIClient } from "../comfyui-client.js";
import { buildI2VWorkflow } from "../workflows/builder.js";
import { mkdir } from "fs/promises";
import { dirname, basename } from "path";
import {
  getStorageProvider,
  isCloudStorageConfigured,
  generateRemotePath,
} from "../storage/index.js";
import {
  ProgressOptions,
  createProgressEmitter,
  wrapComfyUIProgress,
  generateTaskId,
} from "../progress.js";
import {
  getBackendFor,
  isRunPodConfigured,
} from "../backend/index.js";

// ============================================================================
// Schemas
// ============================================================================

export const imageToVideoSchema = z.object({
  source_image: z.string().describe("Filename of source image in ComfyUI input folder"),
  output_path: z.string().describe("Full path to save the output video"),
  backend: z.enum(["auto", "local", "runpod"]).optional().default("auto")
    .describe("Backend to use: 'auto' picks RunPod if configured, 'local' forces local ComfyUI, 'runpod' forces RunPod"),
  motion_backend: z.enum(["animatediff_v3", "animatediff_lcm"]).optional().default("animatediff_v3")
    .describe("AnimateDiff backend: 'animatediff_v3' for quality (20 steps), 'animatediff_lcm' for speed (6 steps)"),
  checkpoint: z.string().optional()
    .describe("SD1.5 checkpoint model (default: v1-5-pruned-emaonly.safetensors)"),
  prompt: z.string().optional()
    .describe("Text prompt to guide the animation (optional)"),
  negative_prompt: z.string().optional()
    .describe("Negative prompt (optional)"),
  width: z.number().optional().default(512)
    .describe("Output video width (default: 512)"),
  height: z.number().optional().default(512)
    .describe("Output video height (default: 512)"),
  frames: z.number().optional().default(16)
    .describe("Number of frames to generate (default: 16)"),
  fps: z.number().optional().default(8)
    .describe("Output video FPS (default: 8)"),
  steps: z.number().optional()
    .describe("Sampling steps (default: 6 for LCM, 20 for v3)"),
  cfg_scale: z.number().optional()
    .describe("CFG scale (default: 1.8 for LCM, 7.0 for v3)"),
  seed: z.number().optional()
    .describe("Random seed for reproducibility"),
  motion_scale: z.number().optional().default(1.0)
    .describe("Motion intensity scale (default: 1.0)"),
  upload_to_cloud: z.boolean().optional().default(true)
    .describe("Upload to cloud storage if configured (default: true)"),
});

export const listAnimateDiffModelsSchema = z.object({});

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Generate a video from a source image using AnimateDiff
 * Optionally uploads to cloud storage if configured
 */
export async function imageToVideo(
  rawArgs: z.input<typeof imageToVideoSchema>,
  client: ComfyUIClient,
  progressOptions?: ProgressOptions
): Promise<{ video: string; frames: number; fps: number; remote_url?: string; taskId: string }> {
  // Parse and apply defaults
  const args = imageToVideoSchema.parse(rawArgs);
  const {
    source_image,
    output_path,
    backend,
    motion_backend,
    checkpoint,
    prompt,
    negative_prompt,
    width,
    height,
    frames,
    fps,
    steps,
    cfg_scale,
    seed,
    motion_scale,
    upload_to_cloud,
  } = args;

  // Set up progress tracking
  const taskId = progressOptions?.taskId ?? generateTaskId();
  const emit = createProgressEmitter(taskId, progressOptions?.onProgress);

  // Backend routing: use RunPod for GPU-heavy video generation when available
  const useRunPod = backend === "runpod" || (backend === "auto" && isRunPodConfigured());

  if (useRunPod) {
    emit("queued", 0, "Image-to-video generation queued (RunPod)");
    emit("starting", 5, "Sending to RunPod serverless");

    try {
      const runpodBackend = getBackendFor("img2video");
      const result = await (runpodBackend as any).imageToVideo({
        sourceImage: source_image,
        outputPath: output_path,
        backend: motion_backend,
        checkpoint,
        prompt,
        negativePrompt: negative_prompt,
        width,
        height,
        frames,
        fps,
        steps,
        cfgScale: cfg_scale,
        seed,
        motionScale: motion_scale,
      });

      if (!result.success) {
        emit("error", 0, result.error || "RunPod i2v failed");
        throw new Error(result.error || "RunPod image-to-video failed");
      }

      emit("complete", 100, "Image-to-video complete (RunPod)");

      // Return remote URL if available, local path otherwise
      const file = result.files[0];
      return {
        video: file?.localPath || output_path,
        frames,
        fps,
        remote_url: file?.remoteUrl || file?.signedUrl,
        taskId,
      };
    } catch (error) {
      emit("error", 0, error instanceof Error ? error.message : "RunPod error");
      throw error;
    }
  }

  // Local backend: use existing implementation
  emit("queued", 0, "Image-to-video generation queued (local)");
  emit("starting", 5, `Building AnimateDiff workflow (${motion_backend})`);

  // Build workflow
  const workflow = buildI2VWorkflow({
    sourceImage: source_image,
    backend: motion_backend,
    checkpoint,
    prompt,
    negativePrompt: negative_prompt,
    width,
    height,
    frames,
    fps,
    steps,
    cfgScale: cfg_scale,
    seed,
    motionScale: motion_scale,
    filenamePrefix: "ComfyUI_I2V",
  });

  emit("loading_model", 10, "Queueing workflow, loading models");

  // Execute workflow
  const { prompt_id } = await client.queuePrompt(workflow);

  emit("generating", 15, "Generation started");

  const history = await client.waitForCompletion(prompt_id, wrapComfyUIProgress(emit));

  if (!history || !history.outputs) {
    emit("error", 0, "No output from workflow");
    throw new Error("No output from workflow");
  }

  emit("post_processing", 85, "Processing video output");

  // Find video output (node "video_output" is VHS_VideoCombine)
  const videoOutput = history.outputs["video_output"] as any;

  if (!videoOutput?.gifs?.[0] && !videoOutput?.videos?.[0]) {
    emit("error", 0, "No video output found");
    throw new Error("No video output found in workflow result");
  }

  // VHS_VideoCombine outputs to "gifs" array despite being video
  const video = videoOutput?.gifs?.[0] || videoOutput?.videos?.[0];
  if (video) {
    await mkdir(dirname(output_path), { recursive: true });
    const videoData = await client.getVideo(video.filename, video.subfolder || "", video.type || "output");
    const fs = await import("fs/promises");
    await fs.writeFile(output_path, videoData);
  }

  // Upload to cloud storage if configured and requested
  let remote_url: string | undefined;
  if (upload_to_cloud && isCloudStorageConfigured()) {
    emit("uploading", 90, "Uploading to cloud storage");
    try {
      const storage = getStorageProvider();
      const remotePath = generateRemotePath("videos", basename(output_path));
      const result = await storage.upload(output_path, remotePath);
      remote_url = result.url || undefined;
    } catch (error) {
      // Log but don't fail the operation if cloud upload fails
      console.error("Cloud upload failed:", error);
    }
  }

  emit("complete", 100, "Image-to-video generation complete");

  return {
    video: output_path,
    frames,
    fps,
    remote_url,
    taskId,
  };
}

/**
 * List available AnimateDiff models
 */
export async function listAnimateDiffModels(
  _args: z.infer<typeof listAnimateDiffModelsSchema>,
  client: ComfyUIClient
): Promise<{
  animatediff_v3: { available: boolean; motion_model: string };
  animatediff_lcm: { available: boolean; motion_model: string };
  checkpoints: string[];
}> {
  const objectInfo = await client.getObjectInfo();

  // Check if AnimateDiff nodes are available
  const adeLoadAvailable = "ADE_LoadAnimateDiffModel" in objectInfo;
  const adeApplyAvailable = "ADE_ApplyAnimateLCMI2VModel" in objectInfo;
  const adeEvolvedAvailable = "ADE_UseEvolvedSampling" in objectInfo;

  const animateDiffAvailable = adeLoadAvailable && adeApplyAvailable && adeEvolvedAvailable;

  // Get available checkpoints
  let checkpoints: string[] = [];
  if (objectInfo.CheckpointLoaderSimple?.input?.required?.ckpt_name) {
    const ckptOptions = objectInfo.CheckpointLoaderSimple.input.required.ckpt_name;
    if (Array.isArray(ckptOptions) && Array.isArray(ckptOptions[0])) {
      checkpoints = ckptOptions[0].filter((m: string) =>
        m.includes("v1-5") || m.includes("sd15") || m.includes("Deliberate")
      );
    }
  }

  return {
    animatediff_v3: {
      available: animateDiffAvailable,
      motion_model: "v3_sd15_mm.ckpt",
    },
    animatediff_lcm: {
      available: animateDiffAvailable,
      motion_model: "AnimateLCM_sd15_i2v.ckpt",
    },
    checkpoints,
  };
}
