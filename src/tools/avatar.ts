import { z } from "zod";
import { ComfyUIClient } from "../comfyui-client.js";
import { buildTxt2ImgWorkflow } from "../workflows/builder.js";
import { mkdir } from "fs/promises";
import { dirname, join, basename } from "path";
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

// ============================================================================
// Conventions
// ============================================================================

/**
 * Conventional locations in ComfyUI input folder:
 * - avatars/  -> Portrait images for lip-sync
 * - voices/   -> Voice reference audio for TTS cloning
 */
export const AVATAR_SUBFOLDER = "avatars";
export const VOICE_SUBFOLDER = "voices";

// ============================================================================
// Schemas
// ============================================================================

export const listAvatarsSchema = z.object({});

export const listVoicesCatalogSchema = z.object({});

export const createPortraitSchema = z.object({
  description: z.string().describe("Description of the person/character to generate"),
  style: z.enum(["realistic", "artistic", "anime", "furry"]).optional().default("realistic")
    .describe("Visual style for the portrait"),
  gender: z.enum(["male", "female", "androgynous"]).optional()
    .describe("Gender presentation (helps with prompting)"),
  age: z.string().optional().describe("Approximate age (e.g., '30s', 'elderly', 'young')"),
  expression: z.enum(["neutral", "slight_smile", "serious", "friendly"]).optional().default("neutral")
    .describe("Facial expression"),
  // Backend selection
  backend: z.enum(["flux_gguf", "flux_fp8", "sdxl"]).optional().default("sdxl")
    .describe("Model backend: flux_gguf (local quant), flux_fp8 (standard), sdxl (SDXL checkpoints)"),
  // Model specification
  model: z.string().optional().describe("Model to use (checkpoint for SDXL, GGUF for flux_gguf)"),
  // Generation params
  guidance: z.number().optional().default(7.0).describe("CFG scale (2 for Flux, 7 for SDXL)"),
  steps: z.number().optional().default(28).describe("Sampling steps"),
  seed: z.number().optional().describe("Random seed for reproducibility"),
  width: z.number().optional().default(768).describe("Image width"),
  height: z.number().optional().default(1024).describe("Image height (portrait orientation)"),
  output_path: z.string().describe("Full path to save the portrait image"),
  upload_to_cloud: z.boolean().optional().default(true)
    .describe("Upload to cloud storage if configured (default: true)"),
});

export const batchCreatePortraitsSchema = z.object({
  portraits: z.array(z.object({
    description: z.string(),
    style: z.enum(["realistic", "artistic", "anime", "furry"]).optional(),
    gender: z.enum(["male", "female", "androgynous"]).optional(),
    age: z.string().optional(),
    expression: z.enum(["neutral", "slight_smile", "serious", "friendly"]).optional(),
    model: z.string(),
    name: z.string().describe("Unique name for this portrait (used in filename)"),
  })).describe("List of portraits to generate"),
  backend: z.enum(["flux_gguf", "flux_fp8", "sdxl"]).optional().default("sdxl"),
  output_dir: z.string().describe("Directory to save all portraits"),
  steps: z.number().optional().default(28),
  guidance: z.number().optional().default(7.0),
});

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * List available avatar portraits from ComfyUI input/avatars folder
 */
export async function listAvatars(
  _args: z.infer<typeof listAvatarsSchema>,
  client: ComfyUIClient
): Promise<{
  avatars: Array<{
    filename: string;
    subfolder: string;
  }>;
  convention: string;
}> {
  const objectInfo = await client.getObjectInfo();

  // Get images from LoadImage node
  let avatars: Array<{ filename: string; subfolder: string }> = [];

  if (objectInfo.LoadImage?.input?.required?.image) {
    const imageOptions = objectInfo.LoadImage.input.required.image;
    if (Array.isArray(imageOptions) && Array.isArray(imageOptions[0])) {
      // Filter for images in avatars subfolder or common portrait formats
      const allImages = imageOptions[0] as string[];
      avatars = allImages
        .filter((img: string) => {
          const lower = img.toLowerCase();
          // Include if in avatars folder OR is an image file
          return (
            img.startsWith(`${AVATAR_SUBFOLDER}/`) ||
            lower.endsWith(".png") ||
            lower.endsWith(".jpg") ||
            lower.endsWith(".jpeg") ||
            lower.endsWith(".webp")
          );
        })
        .map((img: string) => ({
          filename: img.includes("/") ? img.split("/").pop()! : img,
          subfolder: img.includes("/") ? img.split("/").slice(0, -1).join("/") : "",
        }));
    }
  }

  return {
    avatars,
    convention: `Place portrait images in ComfyUI/input/${AVATAR_SUBFOLDER}/ for organization`,
  };
}

/**
 * List available voice references from ComfyUI input/voices folder
 * More structured than list_voices - shows catalog with metadata
 */
export async function listVoicesCatalog(
  _args: z.infer<typeof listVoicesCatalogSchema>,
  client: ComfyUIClient
): Promise<{
  voices: Array<{
    filename: string;
    subfolder: string;
    format: string;
  }>;
  convention: string;
}> {
  const objectInfo = await client.getObjectInfo();

  let voices: Array<{ filename: string; subfolder: string; format: string }> = [];

  // Check LoadAudio for audio files
  if (objectInfo.LoadAudio?.input?.required?.audio) {
    const audioOptions = objectInfo.LoadAudio.input.required.audio;
    if (Array.isArray(audioOptions) && Array.isArray(audioOptions[0])) {
      const allAudio = audioOptions[0] as string[];
      voices = allAudio
        .filter((audio: string) => {
          const lower = audio.toLowerCase();
          return (
            lower.endsWith(".wav") ||
            lower.endsWith(".mp3") ||
            lower.endsWith(".flac") ||
            lower.endsWith(".ogg")
          );
        })
        .map((audio: string) => {
          const ext = audio.split(".").pop()?.toLowerCase() || "unknown";
          return {
            filename: audio.includes("/") ? audio.split("/").pop()! : audio,
            subfolder: audio.includes("/") ? audio.split("/").slice(0, -1).join("/") : "",
            format: ext,
          };
        });
    }
  }

  return {
    voices,
    convention: `Place voice reference audio (10-30s samples) in ComfyUI/input/${VOICE_SUBFOLDER}/ for organization`,
  };
}

/**
 * Build prompt for portrait generation based on style
 */
function buildPortraitPrompt(args: {
  description: string;
  style?: "realistic" | "artistic" | "anime" | "furry";
  gender?: "male" | "female" | "androgynous";
  age?: string;
  expression?: "neutral" | "slight_smile" | "serious" | "friendly";
}): { positive: string; negative: string } {
  const { description, style = "realistic", gender, age, expression = "neutral" } = args;

  const promptParts: string[] = [];

  // Style prefix
  switch (style) {
    case "realistic":
      promptParts.push("professional portrait photograph, high resolution, 85mm lens, f/1.8, studio lighting");
      break;
    case "artistic":
      promptParts.push("artistic portrait, painterly style, dramatic lighting, fine art");
      break;
    case "anime":
      promptParts.push("anime style portrait, detailed face, clean linework, vibrant colors, masterpiece, best quality");
      break;
    case "furry":
      promptParts.push("anthro portrait, detailed fur texture, expressive eyes, professional furry art");
      break;
  }

  // Core description
  promptParts.push(description);

  // Demographics if specified
  if (gender) {
    promptParts.push(gender === "androgynous" ? "androgynous features" : `${gender} presenting`);
  }
  if (age) {
    promptParts.push(`${age} years old`);
  }

  // Expression
  const expressionMap: Record<string, string> = {
    neutral: "neutral expression, relaxed face",
    slight_smile: "subtle smile, warm expression",
    serious: "serious expression, composed",
    friendly: "friendly expression, approachable",
  };
  promptParts.push(expressionMap[expression]);

  // Lip-sync optimized framing
  promptParts.push("front-facing portrait, looking directly at camera, clear view of face and lips");
  promptParts.push("head and shoulders framing, centered composition");
  promptParts.push("even lighting on face, no harsh shadows");

  // Build negative prompt based on style
  let negative: string;
  switch (style) {
    case "realistic":
      negative = "cartoon, anime, illustration, painting, bad quality, blurry, deformed, ugly, bad anatomy";
      break;
    case "anime":
      negative = "photorealistic, 3d render, bad quality, worst quality, low quality, blurry, deformed";
      break;
    case "furry":
      negative = "human, realistic human, bad quality, blurry, deformed, ugly, bad anatomy";
      break;
    default:
      negative = "bad quality, blurry, deformed, ugly, bad anatomy";
  }

  return {
    positive: promptParts.join(", "),
    negative,
  };
}

/**
 * Generate a portrait image optimized for lip-sync
 * Supports multiple backends: Flux GGUF, Flux FP8, SDXL
 * Optionally uploads to cloud storage if configured
 */
export async function createPortrait(
  args: z.infer<typeof createPortraitSchema>,
  client: ComfyUIClient,
  progressOptions?: ProgressOptions
): Promise<{ image: string; prompt: string; model: string; remote_url?: string; taskId: string }> {
  const {
    description,
    style,
    gender,
    age,
    expression,
    backend,
    model,
    guidance,
    steps,
    seed,
    width,
    height,
    output_path,
    upload_to_cloud,
  } = args;

  // Set up progress tracking
  const taskId = progressOptions?.taskId ?? generateTaskId();
  const emit = createProgressEmitter(taskId, progressOptions?.onProgress);

  emit("queued", 0, "Portrait generation queued");
  emit("starting", 5, `Building ${backend} workflow`);

  // Build optimized portrait prompt
  const { positive: prompt, negative: negativePrompt } = buildPortraitPrompt({
    description,
    style,
    gender,
    age,
    expression,
  });

  const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);
  let workflow: Record<string, any>;
  let usedModel: string;

  if (backend === "flux_gguf") {
    // Flux GGUF workflow (for local quant models)
    usedModel = model || "flux1-schnell-Q8_0.gguf";
    workflow = buildFluxGGUFWorkflow({
      prompt,
      model: usedModel,
      guidance: guidance ?? 2.0,
      steps: steps ?? 4,
      seed: actualSeed,
      width: width ?? 768,
      height: height ?? 1024,
      filenamePrefix: "ComfyUI_Portrait",
    });
  } else if (backend === "flux_fp8") {
    // Standard Flux workflow (flux1-schnell-fp8.safetensors)
    usedModel = model || "flux1-schnell-fp8.safetensors";
    workflow = buildFluxFP8Workflow({
      prompt,
      model: usedModel,
      guidance: guidance ?? 2.0,
      steps: steps ?? 4,
      seed: actualSeed,
      width: width ?? 768,
      height: height ?? 1024,
      filenamePrefix: "ComfyUI_Portrait",
    });
  } else {
    // SDXL workflow (standard checkpoints like novaFurry, yiffinhell, perfectdeliberate)
    usedModel = model || "perfectdeliberate_v50.safetensors";
    workflow = buildTxt2ImgWorkflow({
      prompt,
      negativePrompt,
      model: usedModel,
      steps: steps ?? 28,
      cfgScale: guidance ?? 7.0,
      seed: actualSeed,
      width: width ?? 768,
      height: height ?? 1024,
      sampler: "euler_ancestral",
      scheduler: "normal",
      filenamePrefix: "ComfyUI_Portrait",
    });
  }

  emit("loading_model", 10, `Loading ${usedModel}`);

  // Execute workflow
  const { prompt_id } = await client.queuePrompt(workflow);

  emit("generating", 15, "Generating portrait");

  const history = await client.waitForCompletion(prompt_id, wrapComfyUIProgress(emit));

  if (!history || !history.outputs) {
    emit("error", 0, "No output from workflow");
    throw new Error("No output from workflow");
  }

  emit("post_processing", 85, "Processing image output");

  // Find image output (different node IDs for different backends)
  const outputNodeId = backend === "sdxl" ? "9" : "save";
  const imageOutput = history.outputs[outputNodeId] as any;

  if (!imageOutput?.images?.[0]) {
    emit("error", 0, "No image output found");
    throw new Error("No image output found in workflow result");
  }

  // Download and save image
  const image = imageOutput.images[0];
  await mkdir(dirname(output_path), { recursive: true });
  const imageData = await client.getImage(image.filename, image.subfolder || "", image.type || "output");
  const fs = await import("fs/promises");
  await fs.writeFile(output_path, imageData);

  // Upload to cloud storage if configured and requested
  let remote_url: string | undefined;
  if (upload_to_cloud && isCloudStorageConfigured()) {
    emit("uploading", 90, "Uploading to cloud storage");
    try {
      const storage = getStorageProvider();
      const remotePath = generateRemotePath("images", basename(output_path));
      const result = await storage.upload(output_path, remotePath);
      remote_url = result.url || undefined;
    } catch (error) {
      // Log but don't fail the operation if cloud upload fails
      console.error("Cloud upload failed:", error);
    }
  }

  emit("complete", 100, "Portrait generation complete");

  return {
    image: output_path,
    prompt,
    model: usedModel,
    remote_url,
    taskId,
  };
}

/**
 * Batch generate multiple portraits with different models
 * Perfect for testing or creating a library of talking heads
 */
export async function batchCreatePortraits(
  args: z.infer<typeof batchCreatePortraitsSchema>,
  client: ComfyUIClient
): Promise<{
  results: Array<{
    name: string;
    image: string;
    prompt: string;
    model: string;
    success: boolean;
    error?: string;
    remote_url?: string;
  }>;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}> {
  const { portraits, backend, output_dir, steps, guidance } = args;

  await mkdir(output_dir, { recursive: true });

  const results: Array<{
    name: string;
    image: string;
    prompt: string;
    model: string;
    success: boolean;
    error?: string;
    remote_url?: string;
  }> = [];

  for (const portrait of portraits) {
    const outputPath = join(output_dir, `${portrait.name}.png`);

    try {
      const result = await createPortrait(
        {
          description: portrait.description,
          style: portrait.style ?? "realistic",
          gender: portrait.gender,
          age: portrait.age,
          expression: portrait.expression ?? "neutral",
          backend,
          model: portrait.model,
          steps,
          guidance,
          width: 768,
          height: 1024,
          output_path: outputPath,
          upload_to_cloud: true, // Always upload batch portraits to cloud
        },
        client
      );

      results.push({
        name: portrait.name,
        image: result.image,
        prompt: result.prompt,
        model: result.model,
        success: true,
        remote_url: result.remote_url,
      });

      console.error(`Generated: ${portrait.name} with ${portrait.model}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        name: portrait.name,
        image: outputPath,
        prompt: "",
        model: portrait.model,
        success: false,
        error: message,
      });

      console.error(`Failed: ${portrait.name} - ${message}`);
    }
  }

  return {
    results,
    summary: {
      total: portraits.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    },
  };
}

// ============================================================================
// Workflow Builders
// ============================================================================

interface FluxWorkflowParams {
  prompt: string;
  model: string;
  guidance: number;
  steps: number;
  seed: number;
  width: number;
  height: number;
  filenamePrefix: string;
}

/**
 * Build Flux GGUF workflow (for quantized models)
 */
function buildFluxGGUFWorkflow(params: FluxWorkflowParams): Record<string, any> {
  return {
    // Load GGUF Flux model
    "unet": {
      class_type: "UnetLoaderGGUF",
      inputs: {
        unet_name: params.model,
      },
    },

    // Load CLIP models (T5 + CLIP-L)
    "clip": {
      class_type: "DualCLIPLoader",
      inputs: {
        clip_name1: "t5xxl_fp16.safetensors",
        clip_name2: "clip_l.safetensors",
        type: "flux",
      },
    },

    // Load VAE
    "vae": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "ae.safetensors",
      },
    },

    // Encode prompt
    "prompt": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["clip", 0],
        text: params.prompt,
      },
    },

    // Flux guidance
    "guidance": {
      class_type: "FluxGuidance",
      inputs: {
        conditioning: ["prompt", 0],
        guidance: params.guidance,
      },
    },

    // Create empty latent
    "latent": {
      class_type: "EmptySD3LatentImage",
      inputs: {
        width: params.width,
        height: params.height,
        batch_size: 1,
      },
    },

    // Random noise
    "noise": {
      class_type: "RandomNoise",
      inputs: {
        noise_seed: params.seed,
      },
    },

    // Sampler selection
    "sampler_select": {
      class_type: "KSamplerSelect",
      inputs: {
        sampler_name: "euler",
      },
    },

    // Scheduler
    "scheduler": {
      class_type: "BasicScheduler",
      inputs: {
        model: ["unet", 0],
        scheduler: "simple",
        steps: params.steps,
        denoise: 1.0,
      },
    },

    // Guider
    "guider": {
      class_type: "BasicGuider",
      inputs: {
        model: ["unet", 0],
        conditioning: ["guidance", 0],
      },
    },

    // Advanced sampler
    "sampler": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["noise", 0],
        guider: ["guider", 0],
        sampler: ["sampler_select", 0],
        sigmas: ["scheduler", 0],
        latent_image: ["latent", 0],
      },
    },

    // Decode latent
    "decode": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["sampler", 0],
        vae: ["vae", 0],
      },
    },

    // Save image
    "save": {
      class_type: "SaveImage",
      inputs: {
        images: ["decode", 0],
        filename_prefix: params.filenamePrefix,
      },
    },
  };
}

/**
 * Build Flux FP8 workflow (for full precision flux checkpoints)
 * Uses CheckpointLoaderSimple instead of UnetLoaderGGUF
 */
function buildFluxFP8Workflow(params: FluxWorkflowParams): Record<string, any> {
  return {
    // Load Flux checkpoint
    "checkpoint": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: params.model,
      },
    },

    // Encode prompt using CLIP from checkpoint
    "prompt": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["checkpoint", 1],
        text: params.prompt,
      },
    },

    // Flux guidance
    "guidance": {
      class_type: "FluxGuidance",
      inputs: {
        conditioning: ["prompt", 0],
        guidance: params.guidance,
      },
    },

    // Create empty latent
    "latent": {
      class_type: "EmptySD3LatentImage",
      inputs: {
        width: params.width,
        height: params.height,
        batch_size: 1,
      },
    },

    // Random noise
    "noise": {
      class_type: "RandomNoise",
      inputs: {
        noise_seed: params.seed,
      },
    },

    // Sampler selection
    "sampler_select": {
      class_type: "KSamplerSelect",
      inputs: {
        sampler_name: "euler",
      },
    },

    // Scheduler
    "scheduler": {
      class_type: "BasicScheduler",
      inputs: {
        model: ["checkpoint", 0],
        scheduler: "simple",
        steps: params.steps,
        denoise: 1.0,
      },
    },

    // Guider
    "guider": {
      class_type: "BasicGuider",
      inputs: {
        model: ["checkpoint", 0],
        conditioning: ["guidance", 0],
      },
    },

    // Advanced sampler
    "sampler": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["noise", 0],
        guider: ["guider", 0],
        sampler: ["sampler_select", 0],
        sigmas: ["scheduler", 0],
        latent_image: ["latent", 0],
      },
    },

    // Decode latent
    "decode": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["sampler", 0],
        vae: ["checkpoint", 2],
      },
    },

    // Save image
    "save": {
      class_type: "SaveImage",
      inputs: {
        images: ["decode", 0],
        filename_prefix: params.filenamePrefix,
      },
    },
  };
}
