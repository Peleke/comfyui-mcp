import { z } from "zod";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  buildControlNetWorkflow,
  buildMultiControlNetWorkflow,
  buildPreprocessorWorkflow,
  ControlNetType,
  ControlNetConfig,
  PreprocessorOptions,
  LoraConfig,
} from "../workflows/builder.js";
import { mkdir } from "fs/promises";
import { dirname } from "path";

// ============================================================================
// ControlNet Model Mappings
// ============================================================================

/**
 * Default ControlNet models for each type (SD1.5)
 */
const DEFAULT_CONTROLNET_MODELS: Record<ControlNetType, string> = {
  canny: "control_v11p_sd15_canny_fp16.safetensors",
  depth: "control_v11f1p_sd15_depth_fp16.safetensors",
  openpose: "control_v11p_sd15_openpose_fp16.safetensors",
  qrcode: "control_v1p_sd15_qrcode.safetensors",
  scribble: "control_v11p_sd15_scribble_fp16.safetensors",
  lineart: "control_v11p_sd15_lineart_fp16.safetensors",
  semantic_seg: "control_v11p_sd15_seg_fp16.safetensors",
};

/**
 * Default strength for each control type
 */
const DEFAULT_STRENGTHS: Record<ControlNetType, number> = {
  canny: 0.8,
  depth: 0.8,
  openpose: 1.0,
  qrcode: 1.0,
  scribble: 0.8,
  lineart: 0.8,
  semantic_seg: 0.7,
};

// ============================================================================
// Schemas
// ============================================================================

const loraSchema = z.object({
  name: z.string().describe("LoRA filename"),
  strength_model: z.number().optional().default(1.0),
  strength_clip: z.number().optional().default(1.0),
});

const controlNetTypeSchema = z.enum([
  "canny",
  "depth",
  "openpose",
  "qrcode",
  "scribble",
  "lineart",
  "semantic_seg",
]);

const preprocessorOptionsSchema = z.object({
  low_threshold: z.number().optional().describe("Canny: low threshold 0.01-0.99 (default: 0.4)"),
  high_threshold: z.number().optional().describe("Canny: high threshold 0.01-0.99 (default: 0.8)"),
  detect_body: z.boolean().optional().describe("OpenPose: detect body (default: true)"),
  detect_face: z.boolean().optional().describe("OpenPose: detect face (default: true)"),
  detect_hands: z.boolean().optional().describe("OpenPose: detect hands (default: true)"),
  object_min_size: z.number().optional().describe("Lineart/Scribble: minimum object size to detect (default: 35)"),
});

export const generateWithControlNetSchema = z.object({
  prompt: z.string().describe("The positive prompt"),
  negative_prompt: z.string().optional().describe("The negative prompt"),
  control_image: z.string().describe("Filename of control image in ComfyUI input folder"),
  control_type: controlNetTypeSchema.describe("Type of control to apply"),
  controlnet_model: z.string().optional().describe("Specific ControlNet model to use (auto-selected if not specified)"),
  strength: z.number().optional().describe("ControlNet strength (0.0-2.0, default varies by type)"),
  start_percent: z.number().optional().default(0.0).describe("When to start applying control (0.0-1.0)"),
  end_percent: z.number().optional().default(1.0).describe("When to stop applying control (0.0-1.0)"),
  preprocess: z.boolean().optional().default(true).describe("Auto-preprocess the control image"),
  preprocessor_options: preprocessorOptionsSchema.optional(),
  width: z.number().optional().default(512),
  height: z.number().optional().default(768),
  steps: z.number().optional().default(28),
  cfg_scale: z.number().optional().default(7),
  sampler: z.string().optional().default("euler_ancestral"),
  scheduler: z.string().optional().default("normal"),
  model: z.string().optional().describe("Checkpoint model"),
  seed: z.number().optional(),
  loras: z.array(loraSchema).optional(),
  output_path: z.string().describe("Full path to save the output image"),
});

export const generateWithMultiControlNetSchema = z.object({
  prompt: z.string().describe("The positive prompt"),
  negative_prompt: z.string().optional(),
  controls: z.array(z.object({
    image: z.string().describe("Filename of control image"),
    type: controlNetTypeSchema,
    controlnet_model: z.string().optional(),
    strength: z.number().optional(),
    start_percent: z.number().optional().default(0.0),
    end_percent: z.number().optional().default(1.0),
    preprocessor_options: preprocessorOptionsSchema.optional(),
  })).min(1).max(5).describe("Array of control conditions (1-5)"),
  preprocess: z.boolean().optional().default(true),
  width: z.number().optional().default(512),
  height: z.number().optional().default(768),
  steps: z.number().optional().default(28),
  cfg_scale: z.number().optional().default(7),
  sampler: z.string().optional().default("euler_ancestral"),
  scheduler: z.string().optional().default("normal"),
  model: z.string().optional(),
  seed: z.number().optional(),
  loras: z.array(loraSchema).optional(),
  output_path: z.string(),
});

export const preprocessControlImageSchema = z.object({
  input_image: z.string().describe("Filename of image to preprocess"),
  control_type: controlNetTypeSchema.describe("Type of preprocessing to apply"),
  preprocessor_options: preprocessorOptionsSchema.optional(),
  output_path: z.string().describe("Path to save the preprocessed image"),
});

export const generateWithHiddenImageSchema = z.object({
  prompt: z.string().describe("The positive prompt for the visible image"),
  negative_prompt: z.string().optional(),
  hidden_image: z.string().describe("Filename of high-contrast B&W image to hide"),
  visibility: z.enum(["subtle", "moderate", "obvious"]).optional().default("subtle")
    .describe("How visible the hidden image should be"),
  width: z.number().optional().default(512),
  height: z.number().optional().default(768),
  steps: z.number().optional().default(28),
  cfg_scale: z.number().optional().default(7),
  sampler: z.string().optional().default("euler_ancestral"),
  scheduler: z.string().optional().default("normal"),
  model: z.string().optional(),
  seed: z.number().optional(),
  loras: z.array(loraSchema).optional(),
  output_path: z.string(),
});

export const stylizePhotoSchema = z.object({
  source_image: z.string().describe("Filename of photo to stylize"),
  style: z.enum(["anime", "oil_painting", "watercolor", "comic", "sketch", "ghibli"])
    .describe("Target artistic style"),
  prompt: z.string().optional().describe("Additional prompt to enhance the style"),
  preserve_detail: z.enum(["low", "medium", "high"]).optional().default("medium")
    .describe("How closely to follow original lines"),
  width: z.number().optional(),
  height: z.number().optional(),
  steps: z.number().optional().default(28),
  cfg_scale: z.number().optional().default(7),
  sampler: z.string().optional().default("euler_ancestral"),
  scheduler: z.string().optional().default("normal"),
  model: z.string().optional().describe("Checkpoint model (anime models recommended for anime style)"),
  seed: z.number().optional(),
  loras: z.array(loraSchema).optional(),
  output_path: z.string(),
});

export const generateWithPoseSchema = z.object({
  prompt: z.string().describe("Character/scene description"),
  negative_prompt: z.string().optional(),
  pose_reference: z.string().describe("Image with the pose to copy"),
  copy_face: z.boolean().optional().default(true).describe("Also match facial expression"),
  copy_hands: z.boolean().optional().default(true).describe("Also match hand positions"),
  width: z.number().optional().default(512),
  height: z.number().optional().default(768),
  steps: z.number().optional().default(28),
  cfg_scale: z.number().optional().default(7),
  sampler: z.string().optional().default("euler_ancestral"),
  scheduler: z.string().optional().default("normal"),
  model: z.string().optional(),
  seed: z.number().optional(),
  loras: z.array(loraSchema).optional(),
  output_path: z.string(),
});

export const generateWithCompositionSchema = z.object({
  prompt: z.string().describe("What to generate"),
  negative_prompt: z.string().optional(),
  composition_reference: z.string().describe("Image with composition to match"),
  strength: z.number().optional().default(0.7).describe("How strictly to follow composition (0.5-0.9 recommended)"),
  width: z.number().optional(),
  height: z.number().optional(),
  steps: z.number().optional().default(28),
  cfg_scale: z.number().optional().default(7),
  sampler: z.string().optional().default("euler_ancestral"),
  scheduler: z.string().optional().default("normal"),
  model: z.string().optional(),
  seed: z.number().optional(),
  loras: z.array(loraSchema).optional(),
  output_path: z.string(),
});

// ============================================================================
// Types
// ============================================================================

export type GenerateWithControlNetInput = z.infer<typeof generateWithControlNetSchema>;
export type GenerateWithMultiControlNetInput = z.infer<typeof generateWithMultiControlNetSchema>;
export type PreprocessControlImageInput = z.infer<typeof preprocessControlImageSchema>;
export type GenerateWithHiddenImageInput = z.infer<typeof generateWithHiddenImageSchema>;
export type StylizePhotoInput = z.infer<typeof stylizePhotoSchema>;
export type GenerateWithPoseInput = z.infer<typeof generateWithPoseSchema>;
export type GenerateWithCompositionInput = z.infer<typeof generateWithCompositionSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

function transformPreprocessorOptions(options?: z.infer<typeof preprocessorOptionsSchema>): PreprocessorOptions | undefined {
  if (!options) return undefined;
  return {
    lowThreshold: options.low_threshold,
    highThreshold: options.high_threshold,
    detectBody: options.detect_body,
    detectFace: options.detect_face,
    detectHands: options.detect_hands,
    objectMinSize: options.object_min_size,
  };
}

function transformLoras(loras?: z.infer<typeof loraSchema>[]): LoraConfig[] | undefined {
  if (!loras) return undefined;
  return loras.map(l => ({
    name: l.name,
    strength_model: l.strength_model,
    strength_clip: l.strength_clip,
  }));
}

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

/**
 * Generate an image with a single ControlNet
 */
export async function generateWithControlNet(
  client: ComfyUIClient,
  input: GenerateWithControlNetInput,
  defaultModel: string
): Promise<{ success: boolean; path: string; seed: number; message: string; control_type: string }> {
  const model = input.model || defaultModel;
  if (!model) {
    throw new Error("No model specified and COMFYUI_MODEL not set");
  }

  const seed = input.seed ?? Math.floor(Math.random() * 2147483647);
  const controlType = input.control_type as ControlNetType;
  const controlNetModel = input.controlnet_model || DEFAULT_CONTROLNET_MODELS[controlType];
  const strength = input.strength ?? DEFAULT_STRENGTHS[controlType];

  const controlNet: ControlNetConfig = {
    type: controlType,
    image: input.control_image,
    controlNetModel,
    strength,
    startPercent: input.start_percent,
    endPercent: input.end_percent,
    preprocessorOptions: transformPreprocessorOptions(input.preprocessor_options),
  };

  const workflow = buildControlNetWorkflow({
    prompt: input.prompt,
    negativePrompt: input.negative_prompt,
    model,
    seed,
    width: input.width,
    height: input.height,
    steps: input.steps,
    cfgScale: input.cfg_scale,
    sampler: input.sampler,
    scheduler: input.scheduler,
    controlNet,
    preprocess: input.preprocess,
    loras: transformLoras(input.loras),
  });

  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  await extractAndSaveImage(client, history, "9", input.output_path);

  return {
    success: true,
    path: input.output_path,
    seed,
    control_type: controlType,
    message: `Generated image with ${controlType} ControlNet (strength: ${strength}). Saved to ${input.output_path}`,
  };
}

/**
 * Generate an image with multiple ControlNets
 */
export async function generateWithMultiControlNet(
  client: ComfyUIClient,
  input: GenerateWithMultiControlNetInput,
  defaultModel: string
): Promise<{ success: boolean; path: string; seed: number; message: string; control_types: string[] }> {
  const model = input.model || defaultModel;
  if (!model) {
    throw new Error("No model specified and COMFYUI_MODEL not set");
  }

  const seed = input.seed ?? Math.floor(Math.random() * 2147483647);

  const controlNets: ControlNetConfig[] = input.controls.map(ctrl => {
    const controlType = ctrl.type as ControlNetType;
    return {
      type: controlType,
      image: ctrl.image,
      controlNetModel: ctrl.controlnet_model || DEFAULT_CONTROLNET_MODELS[controlType],
      strength: ctrl.strength ?? DEFAULT_STRENGTHS[controlType],
      startPercent: ctrl.start_percent,
      endPercent: ctrl.end_percent,
      preprocessorOptions: transformPreprocessorOptions(ctrl.preprocessor_options),
    };
  });

  const workflow = buildMultiControlNetWorkflow({
    prompt: input.prompt,
    negativePrompt: input.negative_prompt,
    model,
    seed,
    width: input.width,
    height: input.height,
    steps: input.steps,
    cfgScale: input.cfg_scale,
    sampler: input.sampler,
    scheduler: input.scheduler,
    controlNets,
    preprocess: input.preprocess,
    loras: transformLoras(input.loras),
  });

  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  await extractAndSaveImage(client, history, "9", input.output_path);

  const controlTypes = controlNets.map(c => c.type);

  return {
    success: true,
    path: input.output_path,
    seed,
    control_types: controlTypes,
    message: `Generated image with ${controlTypes.length} ControlNets (${controlTypes.join(", ")}). Saved to ${input.output_path}`,
  };
}

/**
 * Preprocess an image for ControlNet (preview the control signal)
 */
export async function preprocessControlImage(
  client: ComfyUIClient,
  input: PreprocessControlImageInput
): Promise<{ success: boolean; path: string; message: string }> {
  const controlType = input.control_type as ControlNetType;

  if (controlType === "qrcode") {
    throw new Error("QR Code control type does not require preprocessing");
  }

  const workflow = buildPreprocessorWorkflow({
    inputImage: input.input_image,
    type: controlType,
    options: transformPreprocessorOptions(input.preprocessor_options),
  });

  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  await extractAndSaveImage(client, history, "3", input.output_path);

  return {
    success: true,
    path: input.output_path,
    message: `Preprocessed image with ${controlType} detector. Saved to ${input.output_path}`,
  };
}

/**
 * Generate an image with a hidden image embedded (QR Code ControlNet)
 */
export async function generateWithHiddenImage(
  client: ComfyUIClient,
  input: GenerateWithHiddenImageInput,
  defaultModel: string
): Promise<{ success: boolean; path: string; seed: number; message: string }> {
  // Map visibility to strength
  const visibilityStrength: Record<string, number> = {
    subtle: 0.9,
    moderate: 1.1,
    obvious: 1.3,
  };

  const strength = visibilityStrength[input.visibility || "subtle"];

  return generateWithControlNet(client, {
    prompt: input.prompt,
    negative_prompt: input.negative_prompt,
    control_image: input.hidden_image,
    control_type: "qrcode",
    strength,
    start_percent: 0.0,
    end_percent: 1.0,
    preprocess: false, // QR code doesn't need preprocessing
    width: input.width ?? 512,
    height: input.height ?? 768,
    steps: input.steps ?? 28,
    cfg_scale: input.cfg_scale ?? 7,
    sampler: input.sampler ?? "euler_ancestral",
    scheduler: input.scheduler ?? "normal",
    model: input.model,
    seed: input.seed,
    loras: input.loras,
    output_path: input.output_path,
  }, defaultModel);
}

/**
 * Style-specific prompt prefixes
 */
const STYLE_PROMPTS: Record<string, { prefix: string; checkpoint?: string }> = {
  anime: {
    prefix: "masterpiece, best quality, anime style,",
  },
  oil_painting: {
    prefix: "masterpiece, oil painting, classical art style, brush strokes visible,",
  },
  watercolor: {
    prefix: "masterpiece, watercolor painting, soft edges, flowing colors,",
  },
  comic: {
    prefix: "comic book style, bold lines, cel shading, vibrant colors,",
  },
  sketch: {
    prefix: "pencil sketch, detailed line art, hand drawn,",
  },
  ghibli: {
    prefix: "masterpiece, studio ghibli style, anime, detailed background, warm colors,",
  },
};

/**
 * Stylize a photo into an artistic style
 */
export async function stylizePhoto(
  client: ComfyUIClient,
  input: StylizePhotoInput,
  defaultModel: string
): Promise<{ success: boolean; path: string; seed: number; message: string; style: string }> {
  const styleConfig = STYLE_PROMPTS[input.style];
  const fullPrompt = input.prompt
    ? `${styleConfig.prefix} ${input.prompt}`
    : styleConfig.prefix;

  // Map preserve_detail to strength (higher = more detail preserved = lower controlnet influence)
  const detailStrength: Record<string, number> = {
    low: 0.9,
    medium: 0.75,
    high: 0.6,
  };

  const result = await generateWithControlNet(client, {
    prompt: fullPrompt,
    negative_prompt: "low quality, worst quality, bad anatomy, blurry",
    control_image: input.source_image,
    control_type: "lineart",
    strength: detailStrength[input.preserve_detail || "medium"],
    start_percent: 0.0,
    end_percent: 1.0,
    preprocess: true,
    width: input.width ?? 512,
    height: input.height ?? 768,
    steps: input.steps ?? 28,
    cfg_scale: input.cfg_scale ?? 7,
    sampler: input.sampler ?? "euler_ancestral",
    scheduler: input.scheduler ?? "normal",
    model: input.model,
    seed: input.seed,
    loras: input.loras,
    output_path: input.output_path,
  }, defaultModel);

  return {
    ...result,
    style: input.style,
    message: `Stylized photo to ${input.style} style. ${result.message}`,
  };
}

/**
 * Generate with a specific pose
 */
export async function generateWithPose(
  client: ComfyUIClient,
  input: GenerateWithPoseInput,
  defaultModel: string
): Promise<{ success: boolean; path: string; seed: number; message: string }> {
  return generateWithControlNet(client, {
    prompt: input.prompt,
    negative_prompt: input.negative_prompt || "bad quality, blurry, ugly, deformed, bad anatomy",
    control_image: input.pose_reference,
    control_type: "openpose",
    start_percent: 0.0,
    end_percent: 1.0,
    preprocess: true,
    preprocessor_options: {
      detect_body: true,
      detect_face: input.copy_face,
      detect_hands: input.copy_hands,
    },
    width: input.width ?? 512,
    height: input.height ?? 768,
    steps: input.steps ?? 28,
    cfg_scale: input.cfg_scale ?? 7,
    sampler: input.sampler ?? "euler_ancestral",
    scheduler: input.scheduler ?? "normal",
    model: input.model,
    seed: input.seed,
    loras: input.loras,
    output_path: input.output_path,
  }, defaultModel);
}

/**
 * Generate with a composition reference
 */
export async function generateWithComposition(
  client: ComfyUIClient,
  input: GenerateWithCompositionInput,
  defaultModel: string
): Promise<{ success: boolean; path: string; seed: number; message: string }> {
  return generateWithControlNet(client, {
    prompt: input.prompt,
    negative_prompt: input.negative_prompt || "bad quality, blurry",
    control_image: input.composition_reference,
    control_type: "semantic_seg",
    strength: input.strength,
    start_percent: 0.0,
    end_percent: 1.0,
    preprocess: true,
    width: input.width ?? 512,
    height: input.height ?? 768,
    steps: input.steps ?? 28,
    cfg_scale: input.cfg_scale ?? 7,
    sampler: input.sampler ?? "euler_ancestral",
    scheduler: input.scheduler ?? "normal",
    model: input.model,
    seed: input.seed,
    loras: input.loras,
    output_path: input.output_path,
  }, defaultModel);
}

/**
 * List available ControlNet models by type
 */
export async function listControlNetModels(
  client: ComfyUIClient
): Promise<Record<string, string[]>> {
  // Get all controlnet models from ComfyUI
  const objectInfo = await client.getObjectInfo();
  const controlNetLoader = objectInfo["ControlNetLoader"];

  if (!controlNetLoader?.input?.required?.control_net_name?.[0]) {
    return {};
  }

  const allModels: string[] = controlNetLoader.input.required.control_net_name[0];

  // Categorize by type based on filename patterns
  const categorized: Record<string, string[]> = {
    canny: [],
    depth: [],
    openpose: [],
    qrcode: [],
    scribble: [],
    lineart: [],
    semantic_seg: [],
    other: [],
  };

  for (const model of allModels) {
    const lower = model.toLowerCase();
    if (lower.includes("canny")) {
      categorized.canny.push(model);
    } else if (lower.includes("depth")) {
      categorized.depth.push(model);
    } else if (lower.includes("openpose") || lower.includes("pose")) {
      categorized.openpose.push(model);
    } else if (lower.includes("qr") || lower.includes("qrcode")) {
      categorized.qrcode.push(model);
    } else if (lower.includes("scribble")) {
      categorized.scribble.push(model);
    } else if (lower.includes("lineart") || lower.includes("line")) {
      categorized.lineart.push(model);
    } else if (lower.includes("seg")) {
      categorized.semantic_seg.push(model);
    } else {
      categorized.other.push(model);
    }
  }

  // Remove empty categories
  for (const key of Object.keys(categorized)) {
    if (categorized[key].length === 0) {
      delete categorized[key];
    }
  }

  return categorized;
}
