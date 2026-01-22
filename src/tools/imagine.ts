import { z } from "zod";
import { basename } from "path";
import { ComfyUIClient } from "../comfyui-client.js";
import { PromptGenerator } from "../prompting/generator.js";
import { detectModelFamily } from "../prompting/model-detection.js";
import { executePipeline, ExecutePipelineInput } from "./pipeline.js";
import type { StylePreset, ModelFamily } from "../prompting/types.js";
import {
  getStorageProvider,
  isCloudStorageConfigured,
  generateRemotePath,
} from "../storage/index.js";
import { architectures } from "../architectures/index.js";

// Schema for LoRA configuration
const loraSchema = z.object({
  name: z.string().describe("LoRA filename"),
  strength_model: z.number().optional().default(1.0).describe("Model strength"),
  strength_clip: z.number().optional().default(1.0).describe("CLIP strength"),
});

// Schema for camera settings (for realistic photos)
const cameraSchema = z.object({
  focalLength: z.string().optional().describe("e.g., '85mm', '35mm'"),
  aperture: z.string().optional().describe("e.g., 'f/1.4', 'f/2.8'"),
  iso: z.string().optional().describe("e.g., 'ISO 100'"),
  shutterSpeed: z.string().optional().describe("e.g., '1/125'"),
});

/**
 * Schema for the /imagine skill
 * This is the main entry point for natural language → optimized image generation
 */
export const imagineSchema = z.object({
  // Core input - natural language description
  description: z
    .string()
    .describe(
      "Natural language description of what to generate. Be descriptive! e.g., 'A mystical forest at twilight with glowing mushrooms and a small fairy'"
    ),

  // Output
  output_path: z
    .string()
    .describe("Full path where the final image should be saved"),

  // Model selection (optional - will auto-detect or use default)
  model: z
    .string()
    .optional()
    .describe("Checkpoint model to use. If not specified, uses COMFYUI_MODEL env var"),
  model_family: z
    .enum(["illustrious", "pony", "sdxl", "flux", "sd15", "realistic", "z_image_turbo"])
    .optional()
    .describe(
      "Model family for prompt optimization. Auto-detected from model name if not specified"
    ),

  // Style and artistic direction
  style: z
    .enum([
      "anime",
      "realistic_photo",
      "digital_art",
      "oil_painting",
      "watercolor",
      "sketch",
      "3d_render",
      "pixel_art",
      "comic",
      "cinematic",
      "portrait",
      "landscape",
      "fantasy",
      "scifi",
      "horror",
    ])
    .optional()
    .describe("Style preset to apply"),

  artist_reference: z
    .string()
    .optional()
    .describe("Artist style reference, e.g., 'studio ghibli', 'makoto shinkai', 'greg rutkowski'"),

  // Content rating (for Pony models)
  rating: z
    .enum(["safe", "suggestive", "explicit"])
    .optional()
    .describe("Content rating (mainly affects Pony models)"),

  // Camera settings (for realistic photos)
  camera: cameraSchema.optional().describe("Camera settings for realistic photos"),

  // Technical overrides
  width: z.number().optional().describe("Image width (default: auto based on model)"),
  height: z.number().optional().describe("Image height (default: auto based on model)"),
  steps: z.number().optional().describe("Sampling steps (default: auto based on model)"),
  cfg_scale: z.number().optional().describe("CFG scale (default: auto based on model)"),
  sampler: z.string().optional().describe("Sampler (default: auto based on model)"),
  scheduler: z.string().optional().describe("Scheduler (default: normal)"),
  seed: z.number().optional().describe("Seed for reproducibility"),

  // LoRAs
  loras: z.array(loraSchema).optional().describe("LoRAs to apply"),
  auto_recommend_loras: z
    .boolean()
    .optional()
    .default(false)
    .describe("Automatically recommend LoRAs based on style"),

  // Pipeline options
  enable_hires_fix: z
    .boolean()
    .optional()
    .default(false)
    .describe("Enable hi-res fix (img2img pass for better details)"),
  hires_scale: z
    .number()
    .optional()
    .default(1.5)
    .describe("Scale factor for hi-res fix"),
  hires_denoise: z
    .number()
    .optional()
    .default(0.4)
    .describe("Denoise strength for hi-res fix (0.3-0.5 recommended)"),
  hires_steps: z
    .number()
    .optional()
    .default(20)
    .describe("Steps for hi-res fix pass"),

  enable_upscale: z
    .boolean()
    .optional()
    .default(false)
    .describe("Enable AI upscaling after generation"),
  upscale_model: z
    .string()
    .optional()
    .default("RealESRGAN_x4plus.pth")
    .describe("Upscale model to use"),

  // Quality preset shortcuts
  quality: z
    .enum(["draft", "standard", "high", "ultra"])
    .optional()
    .default("standard")
    .describe(
      "Quality preset: draft (fast), standard (balanced), high (better details), ultra (hi-res + upscale)"
    ),

  // Cloud storage upload
  upload_to_cloud: z
    .boolean()
    .optional()
    .default(true)
    .describe("Upload result to cloud storage and return signed URL"),
});

export type ImagineInput = z.infer<typeof imagineSchema>;

interface ImagineResult {
  success: boolean;
  imagePath: string;
  remote_url?: string;
  seed: number;
  prompt: {
    positive: string;
    negative: string;
  };
  modelFamily: ModelFamily;
  pipelineSteps: string[];
  message: string;
  settings: {
    width: number;
    height: number;
    steps: number;
    cfgScale: number;
    sampler: string;
    scheduler: string;
  };
}

/**
 * Apply quality preset to settings
 */
function applyQualityPreset(
  input: ImagineInput,
  modelFamily: ModelFamily
): {
  steps: number;
  enableHiresFix: boolean;
  enableUpscale: boolean;
  hiresScale: number;
  hiresDenoise: number;
  hiresSteps: number;
} {
  const quality = input.quality || "standard";

  // Base steps vary by model
  const baseSteps: Record<ModelFamily, Record<string, number>> = {
    flux: { draft: 4, standard: 8, high: 15, ultra: 20 },
    sdxl: { draft: 15, standard: 28, high: 40, ultra: 50 },
    illustrious: { draft: 15, standard: 28, high: 40, ultra: 50 },
    pony: { draft: 15, standard: 28, high: 40, ultra: 50 },
    realistic: { draft: 20, standard: 30, high: 45, ultra: 60 },
    sd15: { draft: 15, standard: 25, high: 35, ultra: 50 },
    z_image_turbo: { draft: 4, standard: 8, high: 10, ultra: 12 }, // Turbo model optimized for 8 steps
  };

  const steps = input.steps ?? baseSteps[modelFamily][quality];

  // Quality presets affect pipeline
  const presets = {
    draft: {
      enableHiresFix: false,
      enableUpscale: false,
      hiresScale: 1.5,
      hiresDenoise: 0.4,
      hiresSteps: 15,
    },
    standard: {
      enableHiresFix: false,
      enableUpscale: false,
      hiresScale: 1.5,
      hiresDenoise: 0.4,
      hiresSteps: 20,
    },
    high: {
      enableHiresFix: true,
      enableUpscale: false,
      hiresScale: 1.5,
      hiresDenoise: 0.35,
      hiresSteps: 20,
    },
    ultra: {
      enableHiresFix: true,
      enableUpscale: true,
      hiresScale: 1.5,
      hiresDenoise: 0.35,
      hiresSteps: 25,
    },
  };

  const preset = presets[quality];

  // User overrides take precedence
  return {
    steps,
    enableHiresFix: input.enable_hires_fix ?? preset.enableHiresFix,
    enableUpscale: input.enable_upscale ?? preset.enableUpscale,
    hiresScale: input.hires_scale ?? preset.hiresScale,
    hiresDenoise: input.hires_denoise ?? preset.hiresDenoise,
    hiresSteps: input.hires_steps ?? preset.hiresSteps,
  };
}

/**
 * The /imagine skill - transforms natural language into optimized image generation
 *
 * This is the main entry point for AI-assisted image generation. It:
 * 1. Auto-detects model family from model name
 * 2. Crafts optimized prompts using model-specific strategies
 * 3. Applies appropriate generation settings
 * 4. Executes the full pipeline (txt2img → optional hires fix → optional upscale)
 */
export async function imagine(
  client: ComfyUIClient,
  input: ImagineInput,
  defaultModel: string,
  availableLoras?: string[]
): Promise<ImagineResult> {
  // Determine model
  const model = input.model || defaultModel;
  if (!model) {
    throw new Error(
      "No model specified and COMFYUI_MODEL not set. Please provide a model or set the environment variable."
    );
  }

  // Detect or use specified model family
  let modelFamily: ModelFamily;
  if (input.model_family) {
    modelFamily = input.model_family;
  } else {
    const detection = detectModelFamily(model);
    modelFamily = detection.family;
    console.error(
      `Imagine: Auto-detected model family '${modelFamily}' (confidence: ${Math.round(detection.confidence * 100)}%)`
    );
  }

  // Initialize prompt generator
  const generator = new PromptGenerator();
  if (availableLoras && availableLoras.length > 0) {
    generator.setAvailableLoras(availableLoras);
  }

  // Generate optimized prompt
  console.error("Imagine: Crafting optimized prompt...");

  // Build style keywords from artist reference
  const styleKeywords: string[] = [];
  if (input.artist_reference) {
    styleKeywords.push(`style of ${input.artist_reference}`);
  }

  const generatedPrompt = generator.generate({
    description: input.description,
    modelFamily: modelFamily,
    modelName: model,
    style: input.style as StylePreset | undefined,
    rating: input.rating,
    camera: input.camera,
    styleKeywords: styleKeywords.length > 0 ? styleKeywords : undefined,
  });

  console.error(`Imagine: Generated prompt for ${modelFamily}:`);
  console.error(`  Positive: ${generatedPrompt.positive.substring(0, 100)}...`);
  if (generatedPrompt.negative) {
    console.error(`  Negative: ${generatedPrompt.negative.substring(0, 50)}...`);
  }

  // Apply quality preset
  const qualitySettings = applyQualityPreset(input, modelFamily);

  // Merge settings (user overrides > quality preset > model defaults)
  // Get architecture defaults for this model (used as final fallback)
  const archDefaults = architectures.getDefaults(model);

  // Merge settings: user overrides > quality preset > prompting strategy > architecture defaults
  const finalSettings = {
    width: input.width ?? generatedPrompt.recommendedSettings.width ?? archDefaults.width,
    height: input.height ?? generatedPrompt.recommendedSettings.height ?? archDefaults.height,
    steps: qualitySettings.steps,
    cfgScale: input.cfg_scale ?? generatedPrompt.recommendedSettings.cfgScale ?? archDefaults.cfgScale,
    sampler: input.sampler ?? generatedPrompt.recommendedSettings.sampler ?? archDefaults.sampler,
    scheduler: input.scheduler ?? generatedPrompt.recommendedSettings.scheduler ?? archDefaults.scheduler,
  };

  // Prepare LoRAs
  let loras = input.loras;
  if (input.auto_recommend_loras && generatedPrompt.recommendedLoras && availableLoras) {
    // Merge user LoRAs with recommended ones
    // LoraRecommendation has namePattern - we need to find matching available LoRAs
    const userLoraNames = new Set(loras?.map((l) => l.name) || []);
    const recommendedLoras: { name: string; strength_model: number; strength_clip: number }[] = [];

    for (const rec of generatedPrompt.recommendedLoras) {
      // Find a matching LoRA from available ones
      const matchingLora = availableLoras.find(
        (loraName) =>
          loraName.toLowerCase().includes(rec.namePattern.toLowerCase()) &&
          !userLoraNames.has(loraName)
      );
      if (matchingLora) {
        recommendedLoras.push({
          name: matchingLora,
          strength_model: rec.strengthModel,
          strength_clip: rec.strengthClip,
        });
        userLoraNames.add(matchingLora);
      }
    }

    loras = [...(loras || []), ...recommendedLoras];
    if (recommendedLoras.length > 0) {
      console.error(`Imagine: Added ${recommendedLoras.length} recommended LoRAs`);
    }
  }

  // Build pipeline input
  const pipelineInput: ExecutePipelineInput = {
    prompt: generatedPrompt.positive,
    negative_prompt: generatedPrompt.negative || undefined,
    model: model,
    output_path: input.output_path,
    width: finalSettings.width,
    height: finalSettings.height,
    steps: finalSettings.steps,
    cfg_scale: finalSettings.cfgScale,
    sampler: finalSettings.sampler,
    scheduler: finalSettings.scheduler,
    seed: input.seed,
    loras: loras,
    enable_hires_fix: qualitySettings.enableHiresFix,
    hires_scale: qualitySettings.hiresScale,
    hires_denoise: qualitySettings.hiresDenoise,
    hires_steps: qualitySettings.hiresSteps,
    enable_upscale: qualitySettings.enableUpscale,
    upscale_model: input.upscale_model,
  };

  console.error("Imagine: Starting pipeline execution...");
  console.error(
    `  Pipeline: txt2img${qualitySettings.enableHiresFix ? " → hires_fix" : ""}${qualitySettings.enableUpscale ? " → upscale" : ""}`
  );

  // Execute pipeline
  const pipelineResult = await executePipeline(client, pipelineInput, defaultModel);

  // Build result
  const pipelineSteps = pipelineResult.steps.map((s) => s.name);

  // Upload to cloud storage if configured and requested
  let remote_url: string | undefined;
  const upload_to_cloud = input.upload_to_cloud ?? true;
  if (pipelineResult.success && upload_to_cloud && isCloudStorageConfigured()) {
    try {
      const storage = getStorageProvider();
      const remotePath = generateRemotePath("images", basename(pipelineResult.finalPath));
      console.error(`Imagine: Uploading to cloud storage: ${remotePath}`);
      const uploadResult = await storage.upload(pipelineResult.finalPath, remotePath);
      remote_url = uploadResult.signedUrl || uploadResult.url || undefined;
      console.error(`Imagine: Cloud upload succeeded: ${remote_url}`);
    } catch (uploadErr) {
      console.error(`Imagine: Cloud upload failed:`, uploadErr);
      // Continue without remote URL - local file still available
    }
  }

  return {
    success: pipelineResult.success,
    imagePath: pipelineResult.finalPath,
    remote_url,
    seed: pipelineResult.seed,
    prompt: {
      positive: generatedPrompt.positive,
      negative: generatedPrompt.negative || "",
    },
    modelFamily,
    pipelineSteps,
    settings: finalSettings,
    message: pipelineResult.success
      ? `✨ Image generated successfully!\n\n` +
        `📁 Saved to: ${pipelineResult.finalPath}\n` +
        (remote_url ? `🌐 Cloud URL: ${remote_url}\n` : "") +
        `🎲 Seed: ${pipelineResult.seed}\n` +
        `🔧 Pipeline: ${pipelineSteps.join(" → ")}\n` +
        `📐 Size: ${finalSettings.width}x${finalSettings.height}\n` +
        `🎨 Model family: ${modelFamily}\n\n` +
        `To reproduce this exact image, use seed: ${pipelineResult.seed}`
      : `❌ Generation failed: ${pipelineResult.message}`,
  };
}
