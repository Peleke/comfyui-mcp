import { z } from "zod";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  buildIPAdapterWorkflow,
  IPAdapterWeightType,
  IPAdapterCombineEmbeds,
} from "../workflows/builder.js";
import { mkdir } from "fs/promises";
import { dirname } from "path";

// ============================================================================
// Schemas
// ============================================================================

const loraSchema = z.object({
  name: z.string().describe("LoRA filename"),
  strength_model: z.number().optional().default(1.0),
  strength_clip: z.number().optional().default(1.0),
});

const weightTypeSchema = z.enum([
  "linear",
  "ease in",
  "ease out",
  "ease in-out",
  "reverse in-out",
  "weak input",
  "weak output",
  "weak middle",
  "strong middle",
  "style transfer",
  "composition",
  "strong style transfer",
]);

const combineEmbedsSchema = z.enum([
  "concat",
  "add",
  "subtract",
  "average",
  "norm average",
]);

export const ipadapterSchema = z.object({
  prompt: z.string().describe("Description of what to generate"),
  negative_prompt: z.string().optional().describe("Things to avoid in the generation"),
  reference_image: z.string().describe("Filename of reference image for identity/style"),
  reference_images: z.array(z.string()).optional()
    .describe("Additional reference images for multi-reference generation"),
  weight: z.number().min(0).max(2).optional().default(0.8)
    .describe("IP-Adapter weight (0.0-2.0, default: 0.8)"),
  weight_type: weightTypeSchema.optional().default("linear")
    .describe("How the weight is applied across denoising steps"),
  start_at: z.number().min(0).max(1).optional().default(0.0)
    .describe("When to start applying IP-Adapter (0.0-1.0)"),
  end_at: z.number().min(0).max(1).optional().default(1.0)
    .describe("When to stop applying IP-Adapter (0.0-1.0)"),
  combine_embeds: combineEmbedsSchema.optional().default("concat")
    .describe("How to combine multiple image embeddings"),
  model: z.string().optional().describe("Checkpoint model to use"),
  ipadapter_model: z.string().optional()
    .describe("IP-Adapter model file (auto-detected if not specified)"),
  clip_vision_model: z.string().optional()
    .describe("CLIP Vision model for image embedding"),
  width: z.number().optional().default(512).describe("Image width"),
  height: z.number().optional().default(768).describe("Image height"),
  steps: z.number().optional().default(28).describe("Sampling steps"),
  cfg_scale: z.number().optional().default(7).describe("CFG scale"),
  sampler: z.string().optional().default("euler_ancestral").describe("Sampler name"),
  scheduler: z.string().optional().default("normal").describe("Scheduler name"),
  seed: z.number().optional().describe("Random seed for reproducibility"),
  loras: z.array(loraSchema).optional().describe("LoRAs to apply"),
  output_path: z.string().describe("Full path to save the generated image"),
});

export type IPAdapterInput = z.infer<typeof ipadapterSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

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
 * Auto-detect appropriate IP-Adapter model based on checkpoint
 */
function detectIPAdapterModel(checkpointName: string): string {
  const lower = checkpointName.toLowerCase();

  // SDXL models
  if (lower.includes("sdxl") || lower.includes("xl")) {
    return "ip-adapter-plus_sdxl_vit-h.safetensors";
  }

  // Default to SD1.5
  return "ip-adapter-plus_sd15.safetensors";
}

/**
 * Auto-detect appropriate CLIP Vision model
 */
function detectClipVisionModel(checkpointName: string): string {
  const lower = checkpointName.toLowerCase();

  // SDXL models use ViT-bigG
  if (lower.includes("sdxl") || lower.includes("xl")) {
    return "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors";
  }

  // SD1.5 uses ViT-H
  return "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors";
}

// ============================================================================
// Tool Functions
// ============================================================================

export interface IPAdapterResult {
  success: boolean;
  path: string;
  seed: number;
  message: string;
  referenceCount: number;
}

/**
 * Generate an image using IP-Adapter for identity/style preservation
 *
 * IP-Adapter uses CLIP image embeddings from reference images to guide
 * generation, enabling:
 * - Character identity preservation across generations
 * - Style transfer from reference images
 * - Composition guidance
 *
 * Requires ComfyUI_IPAdapter_plus custom nodes to be installed.
 */
export async function ipadapter(
  client: ComfyUIClient,
  input: IPAdapterInput,
  defaultModel: string
): Promise<IPAdapterResult> {
  const model = input.model || defaultModel;
  if (!model) {
    throw new Error("No model specified and COMFYUI_MODEL not set");
  }

  const seed = input.seed ?? Math.floor(Math.random() * 2147483647);

  // Auto-detect IP-Adapter and CLIP Vision models if not specified
  const ipadapterModel = input.ipadapter_model || detectIPAdapterModel(model);
  const clipVisionModel = input.clip_vision_model || detectClipVisionModel(model);

  const workflow = buildIPAdapterWorkflow({
    prompt: input.prompt,
    negativePrompt: input.negative_prompt,
    referenceImage: input.reference_image,
    referenceImages: input.reference_images,
    weight: input.weight,
    weightType: input.weight_type as IPAdapterWeightType,
    startAt: input.start_at,
    endAt: input.end_at,
    combineEmbeds: input.combine_embeds as IPAdapterCombineEmbeds,
    model,
    ipadapterModel,
    clipVisionModel,
    width: input.width,
    height: input.height,
    seed,
    steps: input.steps,
    cfgScale: input.cfg_scale,
    sampler: input.sampler,
    scheduler: input.scheduler,
    loras: input.loras?.map((l) => ({
      name: l.name,
      strength_model: l.strength_model,
      strength_clip: l.strength_clip,
    })),
  });

  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  await extractAndSaveImage(client, history, "11", input.output_path);

  const referenceCount = 1 + (input.reference_images?.length || 0);

  return {
    success: true,
    path: input.output_path,
    seed,
    referenceCount,
    message: `Generated image with IP-Adapter (${referenceCount} reference${referenceCount > 1 ? "s" : ""}, weight: ${input.weight}). Saved to ${input.output_path}`,
  };
}

/**
 * List available IP-Adapter models
 */
export async function listIPAdapterModels(
  client: ComfyUIClient
): Promise<string[]> {
  try {
    const objectInfo = await client.getObjectInfo();
    const ipadapterLoader = objectInfo["IPAdapterModelLoader"];
    if (ipadapterLoader?.input?.required?.ipadapter_file?.[0]) {
      return ipadapterLoader.input.required.ipadapter_file[0];
    }
    return [];
  } catch {
    // IP-Adapter nodes not installed
    return [];
  }
}

/**
 * List available CLIP Vision models
 */
export async function listClipVisionModels(
  client: ComfyUIClient
): Promise<string[]> {
  try {
    const objectInfo = await client.getObjectInfo();
    const clipVisionLoader = objectInfo["CLIPVisionLoader"];
    if (clipVisionLoader?.input?.required?.clip_name?.[0]) {
      return clipVisionLoader.input.required.clip_name[0];
    }
    return [];
  } catch {
    return [];
  }
}
