import { z } from "zod";
import type { ComfyUIClient } from "../comfyui-client.js";
import {
  buildInpaintWorkflow,
  buildOutpaintWorkflow,
  buildMaskWorkflow,
  type LoraConfig,
  type MaskPreset,
} from "../workflows/builder.js";
import { mkdir } from "fs/promises";
import { dirname, basename } from "path";
import {
  getStorageProvider,
  isCloudStorageConfigured,
  generateRemotePath,
} from "../storage/index.js";

// ============================================================================
// Shared Schemas
// ============================================================================

const loraSchema = z.object({
  name: z.string().describe("LoRA filename"),
  strength_model: z.number().optional().default(1.0).describe("LoRA strength for model"),
  strength_clip: z.number().optional().default(1.0).describe("LoRA strength for CLIP"),
});

const regionSchema = z.object({
  x: z.number().min(0).max(100).describe("X position (0-100 percentage)"),
  y: z.number().min(0).max(100).describe("Y position (0-100 percentage)"),
  width: z.number().min(0).max(100).describe("Width (0-100 percentage)"),
  height: z.number().min(0).max(100).describe("Height (0-100 percentage)"),
});

// ============================================================================
// Inpaint Schema and Handler
// ============================================================================

export const inpaintSchema = z.object({
  prompt: z.string().describe("What to generate in the masked region"),
  negative_prompt: z.string().optional().describe("Things to avoid in generation"),
  source_image: z.string().describe("Source image filename in ComfyUI input folder"),
  mask_image: z.string().describe("Mask image filename (white = inpaint, black = keep)"),
  denoise_strength: z.number().min(0).max(1).optional().default(0.75)
    .describe("How much to change masked region (0.0 = none, 1.0 = full regeneration)"),
  model: z.string().optional().describe("Checkpoint model to use"),
  steps: z.number().optional().default(28).describe("Number of sampling steps"),
  cfg_scale: z.number().optional().default(7).describe("CFG scale for guidance"),
  sampler: z.string().optional().default("euler_ancestral").describe("Sampler name"),
  scheduler: z.string().optional().default("normal").describe("Scheduler name"),
  seed: z.number().optional().describe("Random seed (random if not specified)"),
  loras: z.array(loraSchema).optional().describe("Array of LoRAs to apply"),
  output_path: z.string().describe("Full path to save the inpainted image"),
  upload_to_cloud: z.boolean().optional().default(true).describe("Upload result to cloud storage"),
});

export type InpaintInput = z.infer<typeof inpaintSchema>;

/**
 * Helper to extract image from workflow outputs
 */
async function extractAndSaveImage(
  client: ComfyUIClient,
  history: any,
  saveNodeId: string,
  outputPath: string
): Promise<void> {
  const saveImageOutput = history.outputs[saveNodeId];
  if (!saveImageOutput?.images?.[0]) {
    throw new Error("No image in output");
  }

  const imageInfo = saveImageOutput.images[0];
  const imageBuffer = await client.getImage(
    imageInfo.filename,
    imageInfo.subfolder,
    imageInfo.type
  );

  await mkdir(dirname(outputPath), { recursive: true });
  const fs = await import("fs/promises");
  await fs.writeFile(outputPath, imageBuffer);
}

/**
 * Inpaint a masked region of an image.
 * White areas in the mask are regenerated, black areas are preserved.
 */
export async function inpaint(
  client: ComfyUIClient,
  input: InpaintInput,
  defaultModel: string
): Promise<{
  success: boolean;
  path: string;
  remote_url?: string;
  seed: number;
  message: string;
}> {
  const model = input.model || defaultModel;

  if (!model) {
    throw new Error("No model specified and COMFYUI_MODEL not set");
  }

  const seed = input.seed ?? Math.floor(Math.random() * 2147483647);

  // Transform LoRA input to internal format
  const loras: LoraConfig[] | undefined = input.loras?.map((l) => ({
    name: l.name,
    strength_model: l.strength_model,
    strength_clip: l.strength_clip,
  }));

  const workflow = buildInpaintWorkflow({
    prompt: input.prompt,
    negativePrompt: input.negative_prompt,
    sourceImage: input.source_image,
    maskImage: input.mask_image,
    denoiseStrength: input.denoise_strength,
    model: model,
    steps: input.steps,
    cfgScale: input.cfg_scale,
    sampler: input.sampler,
    scheduler: input.scheduler,
    seed: seed,
    loras: loras,
    filenamePrefix: "ComfyUI_MCP_inpaint",
  });

  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  await extractAndSaveImage(client, history, "10", input.output_path);

  // Upload to cloud storage if configured and requested
  let remote_url: string | undefined;
  const upload_to_cloud = input.upload_to_cloud ?? true;
  if (upload_to_cloud && isCloudStorageConfigured()) {
    try {
      const storage = getStorageProvider();
      const remotePath = generateRemotePath("images", basename(input.output_path));
      const uploadResult = await storage.upload(input.output_path, remotePath);
      remote_url = uploadResult.signedUrl || uploadResult.url || undefined;
    } catch (uploadErr) {
      console.error("Cloud upload failed:", uploadErr);
    }
  }

  return {
    success: true,
    path: input.output_path,
    remote_url,
    seed: seed,
    message: remote_url
      ? `Inpainted image uploaded to cloud: ${remote_url}`
      : `Inpainted image saved to ${input.output_path}`,
  };
}

// ============================================================================
// Outpaint Schema and Handler
// ============================================================================

export const outpaintSchema = z.object({
  prompt: z.string().describe("What to generate in the extended regions"),
  negative_prompt: z.string().optional().describe("Things to avoid in generation"),
  source_image: z.string().describe("Source image filename in ComfyUI input folder"),
  extend_left: z.number().min(0).optional().default(0).describe("Pixels to extend left"),
  extend_right: z.number().min(0).optional().default(0).describe("Pixels to extend right"),
  extend_top: z.number().min(0).optional().default(0).describe("Pixels to extend top"),
  extend_bottom: z.number().min(0).optional().default(0).describe("Pixels to extend bottom"),
  feathering: z.number().min(0).optional().default(40)
    .describe("Feathering at edges for smooth blending (pixels)"),
  denoise_strength: z.number().min(0).max(1).optional().default(0.8)
    .describe("Denoise strength for outpainted regions (default 0.8, higher than inpaint)"),
  model: z.string().optional().describe("Checkpoint model to use"),
  steps: z.number().optional().default(28).describe("Number of sampling steps"),
  cfg_scale: z.number().optional().default(7).describe("CFG scale for guidance"),
  sampler: z.string().optional().default("euler_ancestral").describe("Sampler name"),
  scheduler: z.string().optional().default("normal").describe("Scheduler name"),
  seed: z.number().optional().describe("Random seed (random if not specified)"),
  loras: z.array(loraSchema).optional().describe("Array of LoRAs to apply"),
  output_path: z.string().describe("Full path to save the outpainted image"),
  upload_to_cloud: z.boolean().optional().default(true).describe("Upload result to cloud storage"),
});

export type OutpaintInput = z.infer<typeof outpaintSchema>;

/**
 * Extend image canvas and generate content for new regions.
 * Uses ImagePadForOutpaint which handles padding and mask generation.
 */
export async function outpaint(
  client: ComfyUIClient,
  input: OutpaintInput,
  defaultModel: string
): Promise<{
  success: boolean;
  path: string;
  remote_url?: string;
  seed: number;
  extensions: { left: number; right: number; top: number; bottom: number };
  message: string;
}> {
  const model = input.model || defaultModel;

  if (!model) {
    throw new Error("No model specified and COMFYUI_MODEL not set");
  }

  // Validate at least one direction is extended
  const left = input.extend_left ?? 0;
  const right = input.extend_right ?? 0;
  const top = input.extend_top ?? 0;
  const bottom = input.extend_bottom ?? 0;

  if (left === 0 && right === 0 && top === 0 && bottom === 0) {
    throw new Error("Must extend at least one direction (extend_left, extend_right, extend_top, or extend_bottom)");
  }

  const seed = input.seed ?? Math.floor(Math.random() * 2147483647);

  // Transform LoRA input to internal format
  const loras: LoraConfig[] | undefined = input.loras?.map((l) => ({
    name: l.name,
    strength_model: l.strength_model,
    strength_clip: l.strength_clip,
  }));

  const workflow = buildOutpaintWorkflow({
    prompt: input.prompt,
    negativePrompt: input.negative_prompt,
    sourceImage: input.source_image,
    extendLeft: left,
    extendRight: right,
    extendTop: top,
    extendBottom: bottom,
    feathering: input.feathering,
    denoiseStrength: input.denoise_strength,
    model: model,
    steps: input.steps,
    cfgScale: input.cfg_scale,
    sampler: input.sampler,
    scheduler: input.scheduler,
    seed: seed,
    loras: loras,
    filenamePrefix: "ComfyUI_MCP_outpaint",
  });

  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  await extractAndSaveImage(client, history, "10", input.output_path);

  // Upload to cloud storage if configured and requested
  let remote_url: string | undefined;
  const upload_to_cloud = input.upload_to_cloud ?? true;
  if (upload_to_cloud && isCloudStorageConfigured()) {
    try {
      const storage = getStorageProvider();
      const remotePath = generateRemotePath("images", basename(input.output_path));
      const uploadResult = await storage.upload(input.output_path, remotePath);
      remote_url = uploadResult.signedUrl || uploadResult.url || undefined;
    } catch (uploadErr) {
      console.error("Cloud upload failed:", uploadErr);
    }
  }

  const extensions = { left, right, top, bottom };
  const totalExtension = left + right + top + bottom;

  return {
    success: true,
    path: input.output_path,
    remote_url,
    seed: seed,
    extensions,
    message: remote_url
      ? `Outpainted image (extended ${totalExtension}px total) uploaded to cloud: ${remote_url}`
      : `Outpainted image saved to ${input.output_path} (extended ${totalExtension}px total)`,
  };
}

// ============================================================================
// Create Mask Schema and Handler
// ============================================================================

export const createMaskSchema = z.object({
  source_image: z.string().describe("Source image filename in ComfyUI input folder"),
  preset: z.enum(["hands", "face", "eyes", "body", "background", "foreground"]).optional()
    .describe("Auto-detect region using AI segmentation (GroundingDINO + SAM)"),
  text_prompt: z.string().optional()
    .describe("Custom text prompt for segmentation (e.g., 'red shirt', 'cat')"),
  region: regionSchema.optional()
    .describe("Manual rectangular region (percentage coordinates)"),
  expand_pixels: z.number().min(0).optional().default(0)
    .describe("Expand mask outward by N pixels"),
  feather_pixels: z.number().min(0).optional().default(0)
    .describe("Feather/blur mask edges by N pixels"),
  invert: z.boolean().optional().default(false)
    .describe("Invert mask (swap white/black)"),
  sam_model: z.string().optional()
    .describe("SAM model to use (default: sam_vit_h)"),
  grounding_dino_model: z.string().optional()
    .describe("GroundingDINO model to use"),
  threshold: z.number().min(0).max(1).optional().default(0.3)
    .describe("Detection threshold for GroundingDINO (0.0-1.0)"),
  output_path: z.string().describe("Full path to save the mask image"),
  upload_to_cloud: z.boolean().optional().default(true).describe("Upload result to cloud storage"),
});

export type CreateMaskInput = z.infer<typeof createMaskSchema>;

/**
 * Generate a mask from presets, text prompts, or manual regions.
 * Uses GroundingDINO + SAM for intelligent segmentation.
 *
 * Requires comfyui_segment_anything extension:
 * https://github.com/storyicon/comfyui_segment_anything
 */
export async function createMask(
  client: ComfyUIClient,
  input: CreateMaskInput
): Promise<{
  success: boolean;
  path: string;
  remote_url?: string;
  method: "preset" | "text_prompt" | "region";
  message: string;
}> {
  // Determine mask generation method
  let method: "preset" | "text_prompt" | "region";
  if (input.preset) {
    method = "preset";
  } else if (input.text_prompt) {
    method = "text_prompt";
  } else if (input.region) {
    method = "region";
  } else {
    throw new Error("Must specify one of: preset, text_prompt, or region");
  }

  const workflow = buildMaskWorkflow({
    sourceImage: input.source_image,
    preset: input.preset as MaskPreset | undefined,
    textPrompt: input.text_prompt,
    region: input.region,
    expandPixels: input.expand_pixels,
    featherPixels: input.feather_pixels,
    invert: input.invert,
    samModel: input.sam_model,
    groundingDinoModel: input.grounding_dino_model,
    threshold: input.threshold,
    filenamePrefix: "ComfyUI_MCP_mask",
  });

  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  // Mask workflow save node varies by method
  const saveNodeId = method === "region" ? "8" : "9";
  await extractAndSaveImage(client, history, saveNodeId, input.output_path);

  // Upload to cloud storage if configured and requested
  let remote_url: string | undefined;
  const upload_to_cloud = input.upload_to_cloud ?? true;
  if (upload_to_cloud && isCloudStorageConfigured()) {
    try {
      const storage = getStorageProvider();
      const remotePath = generateRemotePath("images", basename(input.output_path));
      const uploadResult = await storage.upload(input.output_path, remotePath);
      remote_url = uploadResult.signedUrl || uploadResult.url || undefined;
    } catch (uploadErr) {
      console.error("Cloud upload failed:", uploadErr);
    }
  }

  const methodDescription = method === "preset"
    ? `preset "${input.preset}"`
    : method === "text_prompt"
    ? `text prompt "${input.text_prompt}"`
    : "manual region";

  return {
    success: true,
    path: input.output_path,
    remote_url,
    method,
    message: remote_url
      ? `Mask generated (${methodDescription}) and uploaded to cloud: ${remote_url}`
      : `Mask generated (${methodDescription}) and saved to ${input.output_path}`,
  };
}
