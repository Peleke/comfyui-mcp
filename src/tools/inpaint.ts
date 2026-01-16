import { z } from "zod";
import { ComfyUIClient } from "../comfyui-client.js";
import { buildInpaintWorkflow, buildOutpaintWorkflow } from "../workflows/builder.js";
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

export const inpaintSchema = z.object({
  prompt: z.string().describe("What to generate in the masked area"),
  negative_prompt: z.string().optional().describe("Things to avoid in the generation"),
  source_image: z.string().describe("Filename of source image in ComfyUI input folder"),
  mask_image: z.string().describe("Filename of mask image (white = inpaint, black = keep)"),
  denoise_strength: z.number().min(0).max(1).optional().default(0.75)
    .describe("Denoise strength (0.0-1.0). Higher = more change"),
  grow_mask_by: z.number().optional().default(6)
    .describe("Pixels to grow the mask by for better blending"),
  model: z.string().optional().describe("Checkpoint model to use"),
  steps: z.number().optional().default(28).describe("Sampling steps"),
  cfg_scale: z.number().optional().default(7).describe("CFG scale"),
  sampler: z.string().optional().default("euler_ancestral").describe("Sampler name"),
  scheduler: z.string().optional().default("normal").describe("Scheduler name"),
  seed: z.number().optional().describe("Random seed for reproducibility"),
  loras: z.array(loraSchema).optional().describe("LoRAs to apply"),
  output_path: z.string().describe("Full path to save the inpainted image"),
});

export const outpaintSchema = z.object({
  prompt: z.string().describe("What to generate in the extended area"),
  negative_prompt: z.string().optional().describe("Things to avoid in the generation"),
  source_image: z.string().describe("Filename of source image in ComfyUI input folder"),
  extend_left: z.number().optional().default(0).describe("Pixels to extend on the left"),
  extend_right: z.number().optional().default(0).describe("Pixels to extend on the right"),
  extend_top: z.number().optional().default(0).describe("Pixels to extend on the top"),
  extend_bottom: z.number().optional().default(0).describe("Pixels to extend on the bottom"),
  feathering: z.number().optional().default(40)
    .describe("Feathering amount for blending (default: 40)"),
  denoise_strength: z.number().min(0).max(1).optional().default(0.8)
    .describe("Denoise strength (0.0-1.0). Higher = more creative freedom"),
  model: z.string().optional().describe("Checkpoint model to use"),
  steps: z.number().optional().default(28).describe("Sampling steps"),
  cfg_scale: z.number().optional().default(7).describe("CFG scale"),
  sampler: z.string().optional().default("euler_ancestral").describe("Sampler name"),
  scheduler: z.string().optional().default("normal").describe("Scheduler name"),
  seed: z.number().optional().describe("Random seed for reproducibility"),
  loras: z.array(loraSchema).optional().describe("LoRAs to apply"),
  output_path: z.string().describe("Full path to save the outpainted image"),
});

export type InpaintInput = z.infer<typeof inpaintSchema>;
export type OutpaintInput = z.infer<typeof outpaintSchema>;

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

// ============================================================================
// Tool Functions
// ============================================================================

export interface InpaintResult {
  success: boolean;
  path: string;
  seed: number;
  message: string;
}

/**
 * Inpaint an image using a mask
 *
 * The mask should be a black and white image where:
 * - White areas will be regenerated (inpainted)
 * - Black areas will be preserved from the original
 */
export async function inpaint(
  client: ComfyUIClient,
  input: InpaintInput,
  defaultModel: string
): Promise<InpaintResult> {
  const model = input.model || defaultModel;
  if (!model) {
    throw new Error("No model specified and COMFYUI_MODEL not set");
  }

  const seed = input.seed ?? Math.floor(Math.random() * 2147483647);

  const workflow = buildInpaintWorkflow({
    prompt: input.prompt,
    negativePrompt: input.negative_prompt,
    sourceImage: input.source_image,
    maskImage: input.mask_image,
    model,
    seed,
    steps: input.steps,
    cfgScale: input.cfg_scale,
    sampler: input.sampler,
    scheduler: input.scheduler,
    denoise: input.denoise_strength,
    growMaskBy: input.grow_mask_by,
    loras: input.loras?.map((l) => ({
      name: l.name,
      strength_model: l.strength_model,
      strength_clip: l.strength_clip,
    })),
  });

  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  await extractAndSaveImage(client, history, "9", input.output_path);

  return {
    success: true,
    path: input.output_path,
    seed,
    message: `Inpainted image saved to ${input.output_path}`,
  };
}

/**
 * Outpaint an image by extending the canvas
 *
 * Extends the image in the specified directions and fills
 * the new areas with generated content matching the prompt.
 */
export async function outpaint(
  client: ComfyUIClient,
  input: OutpaintInput,
  defaultModel: string
): Promise<InpaintResult> {
  const model = input.model || defaultModel;
  if (!model) {
    throw new Error("No model specified and COMFYUI_MODEL not set");
  }

  // Validate that at least one direction is extended
  const totalExtend =
    (input.extend_left ?? 0) +
    (input.extend_right ?? 0) +
    (input.extend_top ?? 0) +
    (input.extend_bottom ?? 0);

  if (totalExtend === 0) {
    throw new Error(
      "At least one extend direction must be specified (extend_left, extend_right, extend_top, extend_bottom)"
    );
  }

  const seed = input.seed ?? Math.floor(Math.random() * 2147483647);

  const workflow = buildOutpaintWorkflow({
    prompt: input.prompt,
    negativePrompt: input.negative_prompt,
    sourceImage: input.source_image,
    extendLeft: input.extend_left,
    extendRight: input.extend_right,
    extendTop: input.extend_top,
    extendBottom: input.extend_bottom,
    feathering: input.feathering,
    model,
    seed,
    steps: input.steps,
    cfgScale: input.cfg_scale,
    sampler: input.sampler,
    scheduler: input.scheduler,
    denoise: input.denoise_strength,
    loras: input.loras?.map((l) => ({
      name: l.name,
      strength_model: l.strength_model,
      strength_clip: l.strength_clip,
    })),
  });

  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  await extractAndSaveImage(client, history, "9", input.output_path);

  const directions: string[] = [];
  if (input.extend_left) directions.push(`left: ${input.extend_left}px`);
  if (input.extend_right) directions.push(`right: ${input.extend_right}px`);
  if (input.extend_top) directions.push(`top: ${input.extend_top}px`);
  if (input.extend_bottom) directions.push(`bottom: ${input.extend_bottom}px`);

  return {
    success: true,
    path: input.output_path,
    seed,
    message: `Outpainted image (${directions.join(", ")}) saved to ${input.output_path}`,
  };
}
