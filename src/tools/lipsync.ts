import { z } from "zod";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  buildLipSyncWorkflow,
  buildTalkingAvatarWorkflow,
  LipSyncParams,
} from "../workflows/builder.js";
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

export const lipSyncGenerateSchema = z.object({
  portrait_image: z.string().describe("Filename of portrait image in ComfyUI input folder"),
  audio: z.string().describe("Filename of audio file in ComfyUI input folder"),
  model: z.enum(["sonic", "dice-talk", "hallo2", "sadtalker"]).optional().default("sonic")
    .describe("Lip-sync model to use"),
  backend: z.enum(["auto", "local", "runpod"]).optional().default("auto")
    .describe("Backend to use: 'auto' picks RunPod if configured (recommended for lipsync), 'local' forces local ComfyUI, 'runpod' forces RunPod"),
  // SONIC-specific parameters
  svd_checkpoint: z.string().optional().default("video/svd_xt_1_1.safetensors")
    .describe("SVD checkpoint (provides MODEL, CLIP_VISION, VAE)"),
  sonic_unet: z.string().optional().default("unet.pth").describe("SONIC unet model file"),
  ip_audio_scale: z.number().optional().default(1.0).describe("Audio influence scale (0.5-2.0)"),
  use_interframe: z.boolean().optional().default(true).describe("Use interframe interpolation"),
  dtype: z.enum(["fp16", "fp32", "bf16"]).optional().default("fp16").describe("Model precision"),
  min_resolution: z.number().optional().default(512).describe("Minimum resolution"),
  duration: z.number().optional().default(99999).describe("Maximum duration in seconds (99999 = use audio length)"),
  expand_ratio: z.number().optional().default(1).describe("Face crop expansion ratio"),
  inference_steps: z.number().optional().default(25).describe("Number of inference steps"),
  dynamic_scale: z.number().optional().default(1.0).describe("Dynamic scale factor"),
  fps: z.number().optional().default(25.0).describe("Output video FPS"),
  seed: z.number().optional().describe("Random seed for reproducibility"),
  output_path: z.string().describe("Full path to save the output video"),
  upload_to_cloud: z.boolean().optional().default(true)
    .describe("Upload to cloud storage if configured (default: true)"),
});

export const talkSchema = z.object({
  text: z.string().describe("Text to speak"),
  voice_reference: z.string().describe("Voice reference audio file in ComfyUI input folder"),
  voice_reference_text: z.string().optional().describe("Transcript of the voice reference"),
  portrait_image: z.string().describe("Portrait image in ComfyUI input folder"),
  backend: z.enum(["auto", "local", "runpod"]).optional().default("auto")
    .describe("Backend to use: 'auto' picks RunPod if configured (recommended for talk), 'local' forces local ComfyUI, 'runpod' forces RunPod"),
  // TTS params
  speed: z.number().optional().default(1.0).describe("Speech speed multiplier"),
  tts_seed: z.number().optional().describe("TTS random seed"),
  // LipSync params
  svd_checkpoint: z.string().optional().default("video/svd_xt_1_1.safetensors")
    .describe("SVD checkpoint for SONIC"),
  sonic_unet: z.string().optional().default("unet.pth"),
  inference_steps: z.number().optional().default(25),
  fps: z.number().optional().default(25.0),
  lipsync_seed: z.number().optional().describe("Lip-sync random seed"),
  output_path: z.string().describe("Full path to save the output video"),
  upload_to_cloud: z.boolean().optional().default(true)
    .describe("Upload to cloud storage if configured (default: true)"),
});

export const listLipSyncModelsSchema = z.object({});

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Generate a lip-synced video from portrait + audio
 * Optionally uploads to cloud storage if configured
 */
export async function lipSyncGenerate(
  rawArgs: z.input<typeof lipSyncGenerateSchema>,
  client: ComfyUIClient,
  progressOptions?: ProgressOptions
): Promise<{ video: string; duration?: number; remote_url?: string; taskId: string }> {
  // Parse and apply defaults
  const args = lipSyncGenerateSchema.parse(rawArgs);
  const {
    portrait_image,
    audio,
    model,
    backend,
    svd_checkpoint,
    sonic_unet,
    ip_audio_scale,
    use_interframe,
    dtype,
    min_resolution,
    duration,
    expand_ratio,
    inference_steps,
    dynamic_scale,
    fps,
    seed,
    output_path,
    upload_to_cloud,
  } = args;

  // Set up progress tracking
  const taskId = progressOptions?.taskId ?? generateTaskId();
  const emit = createProgressEmitter(taskId, progressOptions?.onProgress);

  // Backend routing: use RunPod for GPU-heavy lipsync when available
  const useRunPod = backend === "runpod" || (backend === "auto" && isRunPodConfigured());

  if (useRunPod) {
    emit("queued", 0, "Lip-sync generation queued (RunPod)");
    emit("starting", 5, "Sending to RunPod serverless");

    try {
      const runpodBackend = getBackendFor("lipsync"); // Returns RunPodBackend
      const result = await runpodBackend.lipsync({
        portraitImage: portrait_image,
        audio,
        duration,
        inferenceSteps: inference_steps,
        fps,
        seed,
        outputPath: output_path,
      });

      if (!result.success) {
        emit("error", 0, result.error || "RunPod lipsync failed");
        throw new Error(result.error || "RunPod lipsync failed");
      }

      emit("complete", 100, "Lip-sync complete (RunPod)");

      // Return remote URL if available, local path otherwise
      const file = result.files[0];
      return {
        video: file?.localPath || output_path,
        duration,
        remote_url: file?.remoteUrl || file?.signedUrl,
        taskId,
      };
    } catch (error) {
      emit("error", 0, error instanceof Error ? error.message : "RunPod error");
      throw error;
    }
  }

  // Local backend: use existing implementation
  emit("queued", 0, "Lip-sync generation queued (local)");

  // Only SONIC is implemented for now
  if (model !== "sonic") {
    emit("error", 0, `Model '${model}' is not supported`);
    throw new Error(`Model '${model}' is not yet implemented. Only 'sonic' is currently supported.`);
  }

  emit("starting", 5, "Building SONIC workflow");

  // Build workflow
  const workflow = buildLipSyncWorkflow({
    portraitImage: portrait_image,
    audio,
    model,
    svdCheckpoint: svd_checkpoint,
    sonicUnet: sonic_unet,
    ipAudioScale: ip_audio_scale,
    useInterframe: use_interframe,
    dtype,
    minResolution: min_resolution,
    duration,
    expandRatio: expand_ratio,
    inferenceSteps: inference_steps,
    dynamicScale: dynamic_scale,
    fps,
    seed,
    filenamePrefix: "ComfyUI_LipSync",
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

  // Find video output (node "9" is VHS_VideoCombine)
  const videoOutput = history.outputs["9"] as any;

  if (!videoOutput?.gifs?.[0] && !videoOutput?.videos?.[0]) {
    // Check for images (some nodes output as images)
    const imageOutput = Object.values(history.outputs).find(
      (output: any) => output.images && output.images.length > 0
    );
    if (!imageOutput) {
      emit("error", 0, "No video output found");
      throw new Error("No video or image output found in workflow result");
    }
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

  emit("complete", 100, "Lip-sync video generation complete");

  return {
    video: output_path,
    duration: duration,
    remote_url,
    taskId,
  };
}

/**
 * Full pipeline: Text → TTS → LipSync → Video
 * Optionally uploads to cloud storage if configured
 */
export async function talk(
  rawArgs: z.input<typeof talkSchema>,
  client: ComfyUIClient,
  progressOptions?: ProgressOptions
): Promise<{ video: string; text: string; remote_url?: string; taskId: string }> {
  // Parse and apply defaults
  const args = talkSchema.parse(rawArgs);
  const {
    text,
    voice_reference,
    voice_reference_text,
    portrait_image,
    speed,
    tts_seed,
    svd_checkpoint,
    sonic_unet,
    inference_steps,
    fps,
    lipsync_seed,
    output_path,
    upload_to_cloud,
  } = args;

  // Set up progress tracking
  const taskId = progressOptions?.taskId ?? generateTaskId();
  const emit = createProgressEmitter(taskId, progressOptions?.onProgress);

  emit("queued", 0, "Talking avatar generation queued");
  emit("starting", 5, "Building TTS + LipSync workflow");

  // Build combined workflow
  const workflow = buildTalkingAvatarWorkflow({
    text,
    voiceReference: voice_reference,
    voiceReferenceText: voice_reference_text,
    portraitImage: portrait_image,
    speed,
    ttsSeed: tts_seed,
    svdCheckpoint: svd_checkpoint,
    sonicUnet: sonic_unet,
    inferenceSteps: inference_steps,
    fps,
    lipSyncSeed: lipsync_seed,
    filenamePrefix: "ComfyUI_TalkingAvatar",
  });

  emit("loading_model", 10, "Queueing workflow, loading models");

  // Execute workflow
  const { prompt_id } = await client.queuePrompt(workflow);

  emit("generating", 15, "Generation started (TTS + LipSync)");

  const history = await client.waitForCompletion(prompt_id, wrapComfyUIProgress(emit));

  if (!history || !history.outputs) {
    emit("error", 0, "No output from workflow");
    throw new Error("No output from workflow");
  }

  emit("post_processing", 85, "Processing video output");

  // Find video output (node "output" is VHS_VideoCombine)
  const videoOutput = history.outputs["output"] as any;

  if (!videoOutput?.gifs?.[0] && !videoOutput?.videos?.[0]) {
    emit("error", 0, "No video output found");
    throw new Error("No video output found in workflow result");
  }

  // VHS_VideoCombine outputs to "gifs" array despite being video
  const video = videoOutput?.gifs?.[0] || videoOutput?.videos?.[0];
  await mkdir(dirname(output_path), { recursive: true });
  const videoData = await client.getVideo(video.filename, video.subfolder || "", video.type || "output");
  const fs = await import("fs/promises");
  await fs.writeFile(output_path, videoData);

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

  emit("complete", 100, "Talking avatar generation complete");

  return {
    video: output_path,
    text,
    remote_url,
    taskId,
  };
}

/**
 * List available lip-sync models
 */
export async function listLipSyncModels(
  _args: z.infer<typeof listLipSyncModelsSchema>,
  client: ComfyUIClient
): Promise<{
  sonic: { available: boolean; models: string[] };
  "dice-talk": { available: boolean; models: string[] };
  hallo2: { available: boolean; models: string[] };
  sadtalker: { available: boolean; models: string[] };
}> {
  const objectInfo = await client.getObjectInfo();

  // Check which models are available based on node presence
  const sonicAvailable = "SONICTLoader" in objectInfo;
  const diceTalkAvailable = "DICETalkLoader" in objectInfo;
  const hallo2Available = "Hallo2Loader" in objectInfo;
  const sadtalkerAvailable = "SadTalkerLoader" in objectInfo;

  // Get SONIC models from folder_paths if available
  let sonicModels: string[] = [];
  if (sonicAvailable && objectInfo.SONICTLoader?.input?.required?.sonic_unet) {
    const unetOptions = objectInfo.SONICTLoader.input.required.sonic_unet;
    if (Array.isArray(unetOptions) && Array.isArray(unetOptions[0])) {
      sonicModels = unetOptions[0].filter((m: string) => m !== "none");
    }
  }

  return {
    sonic: {
      available: sonicAvailable,
      models: sonicModels,
    },
    "dice-talk": {
      available: diceTalkAvailable,
      models: [],
    },
    hallo2: {
      available: hallo2Available,
      models: [],
    },
    sadtalker: {
      available: sadtalkerAvailable,
      models: [],
    },
  };
}
