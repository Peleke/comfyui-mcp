import baseTxt2ImgWorkflow from "./txt2img.json" with { type: "json" };
import baseImg2ImgWorkflow from "./img2img.json" with { type: "json" };
import baseUpscaleWorkflow from "./upscale.json" with { type: "json" };
import baseControlNetWorkflow from "./controlnet.json" with { type: "json" };
import baseTTSWorkflow from "./tts.json" with { type: "json" };
import baseLipSyncWorkflow from "./lipsync-sonic.json" with { type: "json" };
import baseIPAdapterWorkflow from "./ipadapter.json" with { type: "json" };
import baseInpaintWorkflow from "./inpaint.json" with { type: "json" };
import baseOutpaintWorkflow from "./outpaint.json" with { type: "json" };

export interface LoraConfig {
  name: string;
  strength_model?: number;
  strength_clip?: number;
}

export interface BaseSamplerParams {
  prompt: string;
  negativePrompt?: string;
  steps?: number;
  cfgScale?: number;
  sampler?: string;
  scheduler?: string;
  model: string;
  seed?: number;
  filenamePrefix?: string;
  loras?: LoraConfig[];
}

export interface Txt2ImgParams extends BaseSamplerParams {
  width?: number;
  height?: number;
}

export interface Img2ImgParams extends BaseSamplerParams {
  inputImage: string;
  denoise?: number;
}

export interface UpscaleParams {
  inputImage: string;
  upscaleModel?: string;
  targetWidth?: number;
  targetHeight?: number;
  filenamePrefix?: string;
}

/**
 * Inject LoRA loaders into a workflow.
 * LoRAs are chained: checkpoint -> lora1 -> lora2 -> ... -> final model/clip
 */
function injectLoras(
  workflow: Record<string, any>,
  loras: LoraConfig[],
  checkpointNodeId: string,
  modelConsumerNodeId: string,
  clipConsumerNodeIds: string[]
): Record<string, any> {
  if (!loras || loras.length === 0) {
    return workflow;
  }

  let currentModelSource: [string, number] = [checkpointNodeId, 0];
  let currentClipSource: [string, number] = [checkpointNodeId, 1];

  // Add LoRA loader nodes
  loras.forEach((lora, index) => {
    const loraNodeId = `lora_${index}`;

    workflow[loraNodeId] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: lora.name,
        strength_model: lora.strength_model ?? 1.0,
        strength_clip: lora.strength_clip ?? 1.0,
        model: currentModelSource,
        clip: currentClipSource,
      },
    };

    // Update sources for next LoRA or final consumers
    currentModelSource = [loraNodeId, 0];
    currentClipSource = [loraNodeId, 1];
  });

  // Rewire model consumer (KSampler)
  if (workflow[modelConsumerNodeId]) {
    workflow[modelConsumerNodeId].inputs.model = currentModelSource;
  }

  // Rewire CLIP consumers (text encoders)
  clipConsumerNodeIds.forEach((nodeId) => {
    if (workflow[nodeId]) {
      workflow[nodeId].inputs.clip = currentClipSource;
    }
  });

  return workflow;
}

export function buildTxt2ImgWorkflow(params: Txt2ImgParams): Record<string, any> {
  let workflow = JSON.parse(JSON.stringify(baseTxt2ImgWorkflow));

  // Set checkpoint model
  workflow["4"].inputs.ckpt_name = params.model;

  // Set positive prompt
  workflow["6"].inputs.text = params.prompt;

  // Set negative prompt
  workflow["7"].inputs.text = params.negativePrompt || "bad quality, blurry, ugly, deformed";

  // Set dimensions
  workflow["5"].inputs.width = params.width || 512;
  workflow["5"].inputs.height = params.height || 768;

  // Set sampler parameters
  workflow["3"].inputs.steps = params.steps || 28;
  workflow["3"].inputs.cfg = params.cfgScale || 7;
  workflow["3"].inputs.sampler_name = params.sampler || "euler_ancestral";
  workflow["3"].inputs.scheduler = params.scheduler || "normal";
  workflow["3"].inputs.seed = params.seed ?? Math.floor(Math.random() * 2147483647);

  // Set filename prefix
  workflow["9"].inputs.filename_prefix = params.filenamePrefix || "ComfyUI_MCP";

  // Inject LoRAs if specified
  if (params.loras && params.loras.length > 0) {
    workflow = injectLoras(workflow, params.loras, "4", "3", ["6", "7"]);
  }

  return workflow;
}

export function buildImg2ImgWorkflow(params: Img2ImgParams): Record<string, any> {
  let workflow = JSON.parse(JSON.stringify(baseImg2ImgWorkflow));

  // Set input image
  workflow["1"].inputs.image = params.inputImage;

  // Set checkpoint model
  workflow["4"].inputs.ckpt_name = params.model;

  // Set positive prompt
  workflow["6"].inputs.text = params.prompt;

  // Set negative prompt
  workflow["7"].inputs.text = params.negativePrompt || "bad quality, blurry, ugly, deformed";

  // Set sampler parameters
  workflow["3"].inputs.steps = params.steps || 28;
  workflow["3"].inputs.cfg = params.cfgScale || 7;
  workflow["3"].inputs.sampler_name = params.sampler || "euler_ancestral";
  workflow["3"].inputs.scheduler = params.scheduler || "normal";
  workflow["3"].inputs.seed = params.seed ?? Math.floor(Math.random() * 2147483647);
  workflow["3"].inputs.denoise = params.denoise ?? 0.75;

  // Set filename prefix
  workflow["9"].inputs.filename_prefix = params.filenamePrefix || "ComfyUI_MCP_img2img";

  // Inject LoRAs if specified
  if (params.loras && params.loras.length > 0) {
    workflow = injectLoras(workflow, params.loras, "4", "3", ["6", "7"]);
  }

  return workflow;
}

export function buildUpscaleWorkflow(params: UpscaleParams): Record<string, any> {
  const workflow = JSON.parse(JSON.stringify(baseUpscaleWorkflow));

  // Set input image
  workflow["1"].inputs.image = params.inputImage;

  // Set upscale model
  workflow["2"].inputs.model_name = params.upscaleModel || "RealESRGAN_x4plus.pth";

  // Set target dimensions (optional resize after upscale)
  if (params.targetWidth && params.targetHeight) {
    workflow["4"].inputs.width = params.targetWidth;
    workflow["4"].inputs.height = params.targetHeight;
  } else {
    // Remove the ImageScale node if no target dimensions - output at native upscale size
    delete workflow["4"];
    workflow["5"].inputs.images = ["3", 0];
  }

  // Set filename prefix
  workflow["5"].inputs.filename_prefix = params.filenamePrefix || "ComfyUI_MCP_upscale";

  return workflow;
}

// ============================================================================
// ControlNet Support
// ============================================================================

export type ControlNetType =
  | "canny"
  | "depth"
  | "openpose"
  | "qrcode"
  | "scribble"
  | "lineart"
  | "semantic_seg";

export interface PreprocessorOptions {
  // Canny
  lowThreshold?: number;
  highThreshold?: number;

  // OpenPose (DWPreprocessor)
  detectBody?: boolean;
  detectFace?: boolean;
  detectHands?: boolean;

  // Lineart/Scribble
  objectMinSize?: number;
}

export interface ControlNetConfig {
  type: ControlNetType;
  image: string;
  controlNetModel: string;
  strength?: number;
  startPercent?: number;
  endPercent?: number;
  preprocessorOptions?: PreprocessorOptions;
}

export interface ControlNetParams extends BaseSamplerParams {
  width?: number;
  height?: number;
  controlNet: ControlNetConfig;
  preprocess?: boolean;
}

export interface MultiControlNetParams extends BaseSamplerParams {
  width?: number;
  height?: number;
  controlNets: ControlNetConfig[];
  preprocess?: boolean;
}

/**
 * Get the appropriate preprocessor node class for a control type
 */
function getPreprocessorClass(type: ControlNetType): string | null {
  switch (type) {
    case "canny":
      return "Canny";
    case "depth":
      return "DepthAnythingPreprocessor";
    case "openpose":
      return "DWPreprocessor";
    case "scribble":
      return "ScribblePreprocessor";
    case "lineart":
      return "LineArtPreprocessor";
    case "semantic_seg":
      return "UniFormer-SemSegPreprocessor";
    case "qrcode":
      return null; // QR Code doesn't need preprocessing
    default:
      return null;
  }
}

/**
 * Add a preprocessor node to the workflow
 */
function addPreprocessorNode(
  workflow: Record<string, any>,
  nodeId: string,
  type: ControlNetType,
  imageSourceNode: string,
  options?: PreprocessorOptions
): string {
  const preprocessorClass = getPreprocessorClass(type);
  if (!preprocessorClass) {
    return imageSourceNode; // No preprocessing needed, return original image source
  }

  const inputs: Record<string, any> = {
    image: [imageSourceNode, 0],
  };

  // Type-specific options
  if (type === "canny") {
    // Canny thresholds are 0.01-0.99 range
    inputs.low_threshold = options?.lowThreshold ?? 0.4;
    inputs.high_threshold = options?.highThreshold ?? 0.8;
  } else if (type === "openpose") {
    // DWPreprocessor expects "enable"/"disable" strings, not booleans
    inputs.detect_body = (options?.detectBody ?? true) ? "enable" : "disable";
    inputs.detect_face = (options?.detectFace ?? true) ? "enable" : "disable";
    inputs.detect_hand = (options?.detectHands ?? true) ? "enable" : "disable";
    inputs.resolution = 512;
  } else if (type === "scribble" || type === "lineart") {
    // AnyLineArtPreprocessor options
    if (options?.objectMinSize) {
      inputs.merge_min_size = options.objectMinSize;
    }
  }

  workflow[nodeId] = {
    class_type: preprocessorClass,
    inputs,
  };

  return nodeId;
}

/**
 * Build a single ControlNet workflow
 */
export function buildControlNetWorkflow(params: ControlNetParams): Record<string, any> {
  let workflow = JSON.parse(JSON.stringify(baseControlNetWorkflow));

  const { controlNet, preprocess = true } = params;

  // Set checkpoint model
  workflow["4"].inputs.ckpt_name = params.model;

  // Set positive prompt
  workflow["6"].inputs.text = params.prompt;

  // Set negative prompt
  workflow["7"].inputs.text = params.negativePrompt || "bad quality, blurry, ugly, deformed";

  // Set dimensions
  workflow["5"].inputs.width = params.width || 512;
  workflow["5"].inputs.height = params.height || 768;

  // Set sampler parameters
  workflow["3"].inputs.steps = params.steps || 28;
  workflow["3"].inputs.cfg = params.cfgScale || 7;
  workflow["3"].inputs.sampler_name = params.sampler || "euler_ancestral";
  workflow["3"].inputs.scheduler = params.scheduler || "normal";
  workflow["3"].inputs.seed = params.seed ?? Math.floor(Math.random() * 2147483647);

  // Set filename prefix
  workflow["9"].inputs.filename_prefix = params.filenamePrefix || "ComfyUI_MCP_controlnet";

  // Set control image
  workflow["10"].inputs.image = controlNet.image;

  // Set ControlNet model
  workflow["11"].inputs.control_net_name = controlNet.controlNetModel;

  // Set ControlNet parameters
  workflow["14"].inputs.strength = controlNet.strength ?? 1.0;
  workflow["14"].inputs.start_percent = controlNet.startPercent ?? 0.0;
  workflow["14"].inputs.end_percent = controlNet.endPercent ?? 1.0;

  // Add preprocessor if needed
  if (preprocess && controlNet.type !== "qrcode") {
    const preprocessorNodeId = "20";
    const preprocessedImageSource = addPreprocessorNode(
      workflow,
      preprocessorNodeId,
      controlNet.type,
      "10",
      controlNet.preprocessorOptions
    );

    // Update ControlNet to use preprocessed image
    if (preprocessedImageSource !== "10") {
      workflow["14"].inputs.image = [preprocessedImageSource, 0];
    }
  }

  // Inject LoRAs if specified
  if (params.loras && params.loras.length > 0) {
    workflow = injectLoras(workflow, params.loras, "4", "3", ["6", "7"]);
  }

  return workflow;
}

/**
 * Build a multi-ControlNet workflow (chain multiple control conditions)
 */
export function buildMultiControlNetWorkflow(params: MultiControlNetParams): Record<string, any> {
  let workflow = JSON.parse(JSON.stringify(baseControlNetWorkflow));

  const { controlNets, preprocess = true } = params;

  if (controlNets.length === 0) {
    throw new Error("At least one ControlNet configuration is required");
  }

  // Set checkpoint model
  workflow["4"].inputs.ckpt_name = params.model;

  // Set positive prompt
  workflow["6"].inputs.text = params.prompt;

  // Set negative prompt
  workflow["7"].inputs.text = params.negativePrompt || "bad quality, blurry, ugly, deformed";

  // Set dimensions
  workflow["5"].inputs.width = params.width || 512;
  workflow["5"].inputs.height = params.height || 768;

  // Set sampler parameters
  workflow["3"].inputs.steps = params.steps || 28;
  workflow["3"].inputs.cfg = params.cfgScale || 7;
  workflow["3"].inputs.sampler_name = params.sampler || "euler_ancestral";
  workflow["3"].inputs.scheduler = params.scheduler || "normal";
  workflow["3"].inputs.seed = params.seed ?? Math.floor(Math.random() * 2147483647);

  // Set filename prefix
  workflow["9"].inputs.filename_prefix = params.filenamePrefix || "ComfyUI_MCP_multicontrol";

  // Remove the default controlnet nodes - we'll add our own
  delete workflow["10"];
  delete workflow["11"];
  delete workflow["14"];

  // Track current positive/negative conditioning sources
  let currentPositive: [string, number] = ["6", 0];
  let currentNegative: [string, number] = ["7", 0];

  // Add each ControlNet in sequence
  controlNets.forEach((controlNet, index) => {
    const loadImageNodeId = `cn_image_${index}`;
    const controlNetLoaderNodeId = `cn_loader_${index}`;
    const controlNetApplyNodeId = `cn_apply_${index}`;
    const preprocessorNodeId = `cn_preprocess_${index}`;

    // Load control image
    workflow[loadImageNodeId] = {
      class_type: "LoadImage",
      inputs: {
        image: controlNet.image,
      },
    };

    // Add preprocessor if needed
    let imageSource: string | [string, number] = [loadImageNodeId, 0];
    if (preprocess && controlNet.type !== "qrcode") {
      const preprocessedSource = addPreprocessorNode(
        workflow,
        preprocessorNodeId,
        controlNet.type,
        loadImageNodeId,
        controlNet.preprocessorOptions
      );
      if (preprocessedSource !== loadImageNodeId) {
        imageSource = [preprocessedSource, 0];
      }
    }

    // Load ControlNet model
    workflow[controlNetLoaderNodeId] = {
      class_type: "ControlNetLoader",
      inputs: {
        control_net_name: controlNet.controlNetModel,
      },
    };

    // Apply ControlNet
    workflow[controlNetApplyNodeId] = {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        positive: currentPositive,
        negative: currentNegative,
        control_net: [controlNetLoaderNodeId, 0],
        image: imageSource,
        strength: controlNet.strength ?? 1.0,
        start_percent: controlNet.startPercent ?? 0.0,
        end_percent: controlNet.endPercent ?? 1.0,
      },
    };

    // Update sources for next iteration or final KSampler
    currentPositive = [controlNetApplyNodeId, 0];
    currentNegative = [controlNetApplyNodeId, 1];
  });

  // Wire final conditioning to KSampler
  workflow["3"].inputs.positive = currentPositive;
  workflow["3"].inputs.negative = currentNegative;

  // Inject LoRAs if specified
  if (params.loras && params.loras.length > 0) {
    workflow = injectLoras(workflow, params.loras, "4", "3", ["6", "7"]);
  }

  return workflow;
}

/**
 * Build a preprocessing-only workflow (to see what the control signal looks like)
 */
export function buildPreprocessorWorkflow(params: {
  inputImage: string;
  type: ControlNetType;
  options?: PreprocessorOptions;
  filenamePrefix?: string;
}): Record<string, any> {
  const workflow: Record<string, any> = {};

  // Load image
  workflow["1"] = {
    class_type: "LoadImage",
    inputs: {
      image: params.inputImage,
    },
  };

  // Add preprocessor
  const preprocessorNodeId = "2";
  addPreprocessorNode(
    workflow,
    preprocessorNodeId,
    params.type,
    "1",
    params.options
  );

  // Save preprocessed image
  workflow["3"] = {
    class_type: "SaveImage",
    inputs: {
      filename_prefix: params.filenamePrefix || "ComfyUI_MCP_preprocessed",
      images: [preprocessorNodeId, 0],
    },
  };

  return workflow;
}


// ============================================================================
// IP-Adapter Support
// ============================================================================

export type IPAdapterWeightType = "linear" | "ease in" | "ease out" | "ease in-out" | "reverse in-out" | "weak input" | "weak output" | "weak middle" | "strong middle";

export interface IPAdapterParams extends BaseSamplerParams {
  width?: number;
  height?: number;
  referenceImage: string;
  referenceImages?: string[];
  ipAdapterModel?: string;
  clipVisionModel?: string;
  weight?: number;
  weightType?: IPAdapterWeightType;
  startAt?: number;
  endAt?: number;
  combineEmbeds?: "concat" | "add" | "subtract" | "average" | "norm average";
}

/**
 * Build an IP-Adapter workflow for identity-preserving generation.
 * IP-Adapter uses reference images to guide generation while maintaining identity.
 */
export function buildIPAdapterWorkflow(params: IPAdapterParams): Record<string, any> {
  let workflow = JSON.parse(JSON.stringify(baseIPAdapterWorkflow));

  // Set checkpoint model
  workflow["4"].inputs.ckpt_name = params.model;

  // Set positive prompt
  workflow["6"].inputs.text = params.prompt;

  // Set negative prompt
  workflow["7"].inputs.text = params.negativePrompt || "bad quality, blurry, ugly, deformed";

  // Set dimensions
  workflow["5"].inputs.width = params.width || 512;
  workflow["5"].inputs.height = params.height || 768;

  // Set sampler parameters
  workflow["3"].inputs.steps = params.steps || 28;
  workflow["3"].inputs.cfg = params.cfgScale || 7;
  workflow["3"].inputs.sampler_name = params.sampler || "euler_ancestral";
  workflow["3"].inputs.scheduler = params.scheduler || "normal";
  workflow["3"].inputs.seed = params.seed ?? Math.floor(Math.random() * 2147483647);

  // Set filename prefix
  workflow["9"].inputs.filename_prefix = params.filenamePrefix || "ComfyUI_MCP_ipadapter";

  // Set reference image
  workflow["10"].inputs.image = params.referenceImage;

  // Set IP-Adapter model
  workflow["11"].inputs.ipadapter_file = params.ipAdapterModel || "ip-adapter_sdxl_vit-h.safetensors";

  // Set CLIP Vision model
  workflow["12"].inputs.clip_name = params.clipVisionModel || "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors";

  // Set IP-Adapter parameters
  workflow["15"].inputs.weight = params.weight ?? 0.8;
  workflow["15"].inputs.weight_type = params.weightType || "linear";
  workflow["15"].inputs.start_at = params.startAt ?? 0.0;
  workflow["15"].inputs.end_at = params.endAt ?? 1.0;

  // Handle multiple reference images if provided
  if (params.referenceImages && params.referenceImages.length > 0) {
    workflow = buildMultiReferenceIPAdapter(workflow, params);
  }

  // Inject LoRAs if specified (LoRA applies to base model, then IP-Adapter wraps that)
  if (params.loras && params.loras.length > 0) {
    // For IP-Adapter, we need to apply LoRAs to the checkpoint output first
    // Then IP-Adapter wraps the LoRA-modified model
    workflow = injectLoras(workflow, params.loras, "4", "15", ["6", "7"]);
    // Update IP-Adapter's model input to point to last LoRA
    const lastLoraId = `lora_${params.loras.length - 1}`;
    workflow["15"].inputs.model = [lastLoraId, 0];
  }

  return workflow;
}

/**
 * Internal helper to handle multiple reference images.
 * Uses IPAdapterBatch or chains multiple IPAdapterApply nodes.
 */
function buildMultiReferenceIPAdapter(
  workflow: Record<string, any>,
  params: IPAdapterParams
): Record<string, any> {
  const allImages = [params.referenceImage, ...(params.referenceImages || [])];
  
  if (allImages.length <= 1) {
    return workflow;
  }

  // For multiple images, we'll use IPAdapterBatch which can batch multiple images
  // First, load all images and batch them together
  
  // Remove default single image setup
  delete workflow["10"];
  
  // Create image batch node that concatenates all reference images
  const imageNodes: string[] = [];
  allImages.forEach((image, index) => {
    const nodeId = `ref_image_${index}`;
    workflow[nodeId] = {
      class_type: "LoadImage",
      inputs: {
        image: image,
      },
    };
    imageNodes.push(nodeId);
  });

  // Create ImageBatch node to combine images
  let currentBatch = [imageNodes[0], 0];
  for (let i = 1; i < imageNodes.length; i++) {
    const batchNodeId = `image_batch_${i}`;
    workflow[batchNodeId] = {
      class_type: "ImageBatch",
      inputs: {
        image1: currentBatch,
        image2: [imageNodes[i], 0],
      },
    };
    currentBatch = [batchNodeId, 0];
  }

  // Update IP-Adapter to use batched images
  workflow["15"].inputs.image = currentBatch;
  
  // Set combine embeds method for multiple images
  if (params.combineEmbeds) {
    workflow["15"].inputs.combine_embeds = params.combineEmbeds;
  }

  return workflow;
}

// ============================================================================
// Inpainting / Outpainting Support
// ============================================================================

export interface InpaintParams extends BaseSamplerParams {
  sourceImage: string;
  maskImage: string;
  denoiseStrength?: number;
}

export interface OutpaintParams extends BaseSamplerParams {
  sourceImage: string;
  extendLeft?: number;
  extendRight?: number;
  extendTop?: number;
  extendBottom?: number;
  feathering?: number;
  denoiseStrength?: number;
}

/**
 * Build an inpainting workflow.
 * Uses a mask image to selectively regenerate parts of an image.
 * White areas in the mask = inpaint, black areas = keep original.
 */
export function buildInpaintWorkflow(params: InpaintParams): Record<string, any> {
  let workflow = JSON.parse(JSON.stringify(baseInpaintWorkflow));

  // Set source image
  workflow["1"].inputs.image = params.sourceImage;

  // Set mask image
  workflow["2"].inputs.image = params.maskImage;

  // Set checkpoint model
  workflow["3"].inputs.ckpt_name = params.model;

  // Set positive prompt
  workflow["6"].inputs.text = params.prompt;

  // Set negative prompt
  workflow["7"].inputs.text = params.negativePrompt || "bad quality, blurry, ugly, deformed";

  // Set sampler parameters
  workflow["8"].inputs.steps = params.steps || 28;
  workflow["8"].inputs.cfg = params.cfgScale || 7;
  workflow["8"].inputs.sampler_name = params.sampler || "euler_ancestral";
  workflow["8"].inputs.scheduler = params.scheduler || "normal";
  workflow["8"].inputs.seed = params.seed ?? Math.floor(Math.random() * 2147483647);
  workflow["8"].inputs.denoise = params.denoiseStrength ?? 0.75;

  // Set filename prefix
  workflow["10"].inputs.filename_prefix = params.filenamePrefix || "ComfyUI_MCP_inpaint";

  // Inject LoRAs if specified
  if (params.loras && params.loras.length > 0) {
    workflow = injectLoras(workflow, params.loras, "3", "8", ["6", "7"]);
  }

  return workflow;
}

/**
 * Build an outpainting workflow.
 * Extends the canvas and generates content in the new areas.
 * Uses ImagePadForOutpaint which handles padding + mask generation.
 */
export function buildOutpaintWorkflow(params: OutpaintParams): Record<string, any> {
  let workflow = JSON.parse(JSON.stringify(baseOutpaintWorkflow));

  // Set source image
  workflow["1"].inputs.image = params.sourceImage;

  // Set padding amounts
  workflow["2"].inputs.left = params.extendLeft ?? 0;
  workflow["2"].inputs.right = params.extendRight ?? 0;
  workflow["2"].inputs.top = params.extendTop ?? 0;
  workflow["2"].inputs.bottom = params.extendBottom ?? 0;
  workflow["2"].inputs.feathering = params.feathering ?? 40;

  // Set checkpoint model
  workflow["3"].inputs.ckpt_name = params.model;

  // Set positive prompt
  workflow["6"].inputs.text = params.prompt;

  // Set negative prompt
  workflow["7"].inputs.text = params.negativePrompt || "bad quality, blurry, ugly, deformed";

  // Set sampler parameters
  workflow["8"].inputs.steps = params.steps || 28;
  workflow["8"].inputs.cfg = params.cfgScale || 7;
  workflow["8"].inputs.sampler_name = params.sampler || "euler_ancestral";
  workflow["8"].inputs.scheduler = params.scheduler || "normal";
  workflow["8"].inputs.seed = params.seed ?? Math.floor(Math.random() * 2147483647);
  workflow["8"].inputs.denoise = params.denoiseStrength ?? 0.8; // Higher for outpaint

  // Set filename prefix
  workflow["10"].inputs.filename_prefix = params.filenamePrefix || "ComfyUI_MCP_outpaint";

  // Inject LoRAs if specified
  if (params.loras && params.loras.length > 0) {
    workflow = injectLoras(workflow, params.loras, "3", "8", ["6", "7"]);
  }

  return workflow;
}

// ============================================================================
// Intelligent Mask Generation (GroundingDINO + SAM)
// ============================================================================

export type MaskPreset = "hands" | "face" | "eyes" | "body" | "background" | "foreground";

export interface MaskRegion {
  x: number;      // 0-100 percentage
  y: number;      // 0-100 percentage
  width: number;  // 0-100 percentage
  height: number; // 0-100 percentage
}

export interface CreateMaskParams {
  sourceImage: string;
  preset?: MaskPreset;
  textPrompt?: string;
  region?: MaskRegion;
  expandPixels?: number;
  featherPixels?: number;
  invert?: boolean;
  samModel?: string;
  groundingDinoModel?: string;
  threshold?: number;
  filenamePrefix?: string;
}

/**
 * Map preset names to GroundingDINO text prompts.
 * These prompts work well with GroundingDINO for detection.
 */
function getPresetPrompt(preset: MaskPreset): string {
  switch (preset) {
    case "hands":
      return "hand . fingers . palm . wrist";
    case "face":
      return "face . head";
    case "eyes":
      return "eye . eyes";
    case "body":
      return "person . body . figure";
    case "background":
      return "background";
    case "foreground":
      return "person . character . subject";
    default:
      return preset;
  }
}

/**
 * Build an intelligent mask generation workflow using GroundingDINO + SAM.
 * GroundingDINO detects objects from text prompts, SAM generates precise masks.
 * Requires: comfyui_segment_anything extension
 *
 * Based on research from:
 * - https://github.com/storyicon/comfyui_segment_anything
 * - https://stable-diffusion-art.com/sam3-comfyui-image/
 */
export function buildMaskWorkflow(params: CreateMaskParams): Record<string, any> {
  // If only region is provided, use simple rectangle mask generation
  if (params.region && !params.preset && !params.textPrompt) {
    return buildRectangleMaskWorkflow(params);
  }

  // Use GroundingDINO + SAM for intelligent mask generation
  const textPrompt = params.textPrompt || (params.preset ? getPresetPrompt(params.preset) : "subject");

  const workflow: Record<string, any> = {};

  // Load source image
  workflow["1"] = {
    class_type: "LoadImage",
    inputs: {
      image: params.sourceImage,
    },
  };

  // Load GroundingDINO model for object detection
  workflow["2"] = {
    class_type: "GroundingDinoModelLoader (segment anything)",
    inputs: {
      model_name: params.groundingDinoModel || "GroundingDINO_SwinT_OGC (694MB)",
    },
  };

  // Load SAM model for precise segmentation
  workflow["3"] = {
    class_type: "SAMModelLoader (segment anything)",
    inputs: {
      model_name: params.samModel || "sam_vit_h (2.56GB)",
    },
  };

  // Detect objects with GroundingDINO
  workflow["4"] = {
    class_type: "GroundingDinoSAMSegment (segment anything)",
    inputs: {
      grounding_dino_model: ["2", 0],
      sam_model: ["3", 0],
      image: ["1", 0],
      prompt: textPrompt,
      threshold: params.threshold ?? 0.3,
    },
  };

  // The output is already a mask, but we may need to process it
  let maskSource: [string, number] = ["4", 1]; // SAM outputs mask on index 1

  // Expand mask if specified
  if (params.expandPixels && params.expandPixels > 0) {
    workflow["5"] = {
      class_type: "GrowMask",
      inputs: {
        mask: maskSource,
        expand: params.expandPixels,
        tapered_corners: true,
      },
    };
    maskSource = ["5", 0];
  }

  // Feather/blur mask if specified
  if (params.featherPixels && params.featherPixels > 0) {
    workflow["6"] = {
      class_type: "FeatherMask",
      inputs: {
        mask: maskSource,
        left: params.featherPixels,
        top: params.featherPixels,
        right: params.featherPixels,
        bottom: params.featherPixels,
      },
    };
    maskSource = ["6", 0];
  }

  // Invert mask if specified
  if (params.invert) {
    workflow["7"] = {
      class_type: "InvertMask",
      inputs: {
        mask: maskSource,
      },
    };
    maskSource = ["7", 0];
  }

  // Convert mask to image for saving
  workflow["8"] = {
    class_type: "MaskToImage",
    inputs: {
      mask: maskSource,
    },
  };

  // Save the mask
  workflow["9"] = {
    class_type: "SaveImage",
    inputs: {
      images: ["8", 0],
      filename_prefix: params.filenamePrefix || "ComfyUI_MCP_mask",
    },
  };

  return workflow;
}

/**
 * Build a simple rectangle mask workflow.
 * Creates a white rectangle on black background based on percentage coordinates.
 */
function buildRectangleMaskWorkflow(params: CreateMaskParams): Record<string, any> {
  if (!params.region) {
    throw new Error("Region is required for rectangle mask generation");
  }

  const workflow: Record<string, any> = {};

  // Load source image to get dimensions
  workflow["1"] = {
    class_type: "LoadImage",
    inputs: {
      image: params.sourceImage,
    },
  };

  // Get image size
  workflow["2"] = {
    class_type: "GetImageSize",
    inputs: {
      image: ["1", 0],
    },
  };

  // Create solid black mask
  workflow["3"] = {
    class_type: "SolidMask",
    inputs: {
      value: params.invert ? 1.0 : 0.0,
      width: ["2", 0],
      height: ["2", 1],
    },
  };

  // Create rectangle region (we'll use CropMask approach)
  // This is simplified - in practice you'd calculate actual pixels from percentages
  // ComfyUI doesn't have a direct "draw rectangle on mask" node, so we use MaskComposite
  workflow["4"] = {
    class_type: "SolidMask",
    inputs: {
      value: params.invert ? 0.0 : 1.0,
      // Width/height will be calculated based on percentage
      width: 100, // Placeholder - tool handler will calculate actual pixels
      height: 100,
    },
  };

  // Composite the rectangle onto the background
  workflow["5"] = {
    class_type: "MaskComposite",
    inputs: {
      destination: ["3", 0],
      source: ["4", 0],
      x: 0, // Placeholder - tool handler will calculate actual pixels
      y: 0,
      operation: "add",
    },
  };

  let maskSource: [string, number] = ["5", 0];

  // Feather if specified
  if (params.featherPixels && params.featherPixels > 0) {
    workflow["6"] = {
      class_type: "FeatherMask",
      inputs: {
        mask: maskSource,
        left: params.featherPixels,
        top: params.featherPixels,
        right: params.featherPixels,
        bottom: params.featherPixels,
      },
    };
    maskSource = ["6", 0];
  }

  // Convert mask to image
  workflow["7"] = {
    class_type: "MaskToImage",
    inputs: {
      mask: maskSource,
    },
  };

  // Save
  workflow["8"] = {
    class_type: "SaveImage",
    inputs: {
      images: ["7", 0],
      filename_prefix: params.filenamePrefix || "ComfyUI_MCP_mask_rect",
    },
  };

  return workflow;
}

// ============================================================================
// TTS (Text-to-Speech) Support
// ============================================================================

export interface TTSParams {
  text: string;
  voiceReference: string;
  voiceReferenceText?: string;
  speed?: number;
  seed?: number;
  model?: string;
  vocoder?: "auto" | "vocos" | "bigvgan";
  filenamePrefix?: string;
}

/**
 * Build a TTS workflow using F5-TTS
 */
export function buildTTSWorkflow(params: TTSParams): Record<string, any> {
  const workflow = JSON.parse(JSON.stringify(baseTTSWorkflow));

  // Set voice reference audio
  workflow["1"].inputs.audio = params.voiceReference;

  // Set TTS parameters
  workflow["2"].inputs.sample_text = params.voiceReferenceText || "";
  workflow["2"].inputs.speech = params.text;
  workflow["2"].inputs.seed = params.seed ?? -1;
  workflow["2"].inputs.speed = params.speed ?? 1.0;
  workflow["2"].inputs.vocoder = params.vocoder ?? "vocos";

  if (params.model) {
    workflow["2"].inputs.model = params.model;
  }

  // Set filename prefix
  workflow["3"].inputs.filename_prefix = params.filenamePrefix || "ComfyUI_TTS";

  return workflow;
}

// ============================================================================
// Lip-Sync Support
// ============================================================================

export type LipSyncModel = "sonic" | "dice-talk" | "hallo2" | "sadtalker";

export interface LipSyncParams {
  portraitImage: string;
  audio: string;
  model?: LipSyncModel;
  // SONIC-specific
  svdCheckpoint?: string; // SVD checkpoint (provides MODEL, CLIP_VISION, VAE)
  sonicUnet?: string;
  ipAudioScale?: number;
  useInterframe?: boolean;
  dtype?: "fp16" | "fp32" | "bf16";
  minResolution?: number;
  duration?: number;
  expandRatio?: number;
  inferenceSteps?: number;
  dynamicScale?: number;
  fps?: number;
  seed?: number;
  filenamePrefix?: string;
}

/**
 * Build a SONIC lip-sync workflow
 * Uses ImageOnlyCheckpointLoader with SVD model which provides MODEL, CLIP_VISION, and VAE
 */
export function buildLipSyncWorkflow(params: LipSyncParams): Record<string, any> {
  const workflow = JSON.parse(JSON.stringify(baseLipSyncWorkflow));

  // Set SVD checkpoint (provides MODEL, CLIP_VISION, VAE all in one)
  if (params.svdCheckpoint) {
    workflow["1"].inputs.ckpt_name = params.svdCheckpoint;
  }

  // Set portrait image
  workflow["4"].inputs.image = params.portraitImage;

  // Set audio
  workflow["5"].inputs.audio = params.audio;

  // SONIC Loader settings
  workflow["6"].inputs.sonic_unet = params.sonicUnet || "unet.pth";
  workflow["6"].inputs.ip_audio_scale = params.ipAudioScale ?? 1.0;
  workflow["6"].inputs.use_interframe = params.useInterframe ?? true;
  workflow["6"].inputs.dtype = params.dtype || "fp16";

  // SONIC PreData settings
  workflow["7"].inputs.min_resolution = params.minResolution ?? 512;
  workflow["7"].inputs.duration = params.duration ?? 99999; // Use audio length by default
  workflow["7"].inputs.expand_ratio = params.expandRatio ?? 1;

  // SONIC Sampler settings
  workflow["8"].inputs.seed = params.seed ?? Math.floor(Math.random() * 2147483647);
  workflow["8"].inputs.inference_steps = params.inferenceSteps ?? 25;
  workflow["8"].inputs.dynamic_scale = params.dynamicScale ?? 1.0;
  workflow["8"].inputs.fps = params.fps ?? 25.0;

  // Video output settings
  workflow["9"].inputs.filename_prefix = params.filenamePrefix || "ComfyUI_LipSync";

  return workflow;
}

/**
 * Build a combined TTS + LipSync workflow (full pipeline)
 * This chains TTS output directly into SONIC
 * Uses ImageOnlyCheckpointLoader with SVD model for SONIC
 */
export function buildTalkingAvatarWorkflow(params: {
  text: string;
  voiceReference: string;
  voiceReferenceText?: string;
  portraitImage: string;
  // TTS params
  speed?: number;
  ttsSeed?: number;
  // LipSync params
  svdCheckpoint?: string; // SVD checkpoint for SONIC
  sonicUnet?: string;
  inferenceSteps?: number;
  fps?: number;
  lipSyncSeed?: number;
  filenamePrefix?: string;
}): Record<string, any> {
  // Build combined workflow
  const workflow: Record<string, any> = {};

  // ===== TTS Nodes =====
  // Load voice reference
  workflow["tts_1"] = {
    class_type: "LoadAudio",
    inputs: {
      audio: params.voiceReference,
    },
  };

  // Generate speech
  workflow["tts_2"] = {
    class_type: "F5TTSAudioInputs",
    inputs: {
      sample_audio: ["tts_1", 0],
      sample_text: params.voiceReferenceText || "",
      speech: params.text,
      seed: params.ttsSeed ?? -1,
      model: "F5TTS_v1_Base",
      vocoder: "vocos",
      speed: params.speed ?? 1.0,
      model_type: "F5-TTS",
    },
  };

  // ===== SONIC LipSync Nodes =====
  // ImageOnlyCheckpointLoader with SVD - provides MODEL, CLIP_VISION, VAE
  workflow["sonic_1"] = {
    class_type: "ImageOnlyCheckpointLoader",
    inputs: {
      ckpt_name: params.svdCheckpoint || "video/svd_xt_1_1.safetensors",
    },
  };

  // Load portrait image
  workflow["sonic_2"] = {
    class_type: "LoadImage",
    inputs: {
      image: params.portraitImage,
    },
  };

  // SONIC Loader
  workflow["sonic_3"] = {
    class_type: "SONICTLoader",
    inputs: {
      model: ["sonic_1", 0],
      sonic_unet: params.sonicUnet || "unet.pth",
      ip_audio_scale: 1.0,
      use_interframe: true,
      dtype: "fp16",
    },
  };

  // SONIC PreData - connects TTS audio output to lip-sync
  workflow["sonic_4"] = {
    class_type: "SONIC_PreData",
    inputs: {
      clip_vision: ["sonic_1", 1], // CLIP_VISION from SVD checkpoint
      vae: ["sonic_1", 2],         // VAE from SVD checkpoint
      audio: ["tts_2", 0],         // TTS output feeds into lip-sync
      image: ["sonic_2", 0],
      min_resolution: 512,
      duration: 99999, // Use audio length
      expand_ratio: 1,
    },
  };

  // SONIC Sampler
  workflow["sonic_5"] = {
    class_type: "SONICSampler",
    inputs: {
      model: ["sonic_3", 0],
      data_dict: ["sonic_4", 0],
      seed: params.lipSyncSeed ?? Math.floor(Math.random() * 2147483647),
      randomize: "randomize",
      inference_steps: params.inferenceSteps ?? 25,
      dynamic_scale: 1.0,
      fps: params.fps ?? 25.0,
    },
  };

  // Video output
  workflow["output"] = {
    class_type: "VHS_VideoCombine",
    inputs: {
      images: ["sonic_5", 0],
      audio: ["tts_2", 0], // Include TTS audio in video
      frame_rate: ["sonic_5", 1],
      loop_count: 0,
      filename_prefix: params.filenamePrefix || "ComfyUI_TalkingAvatar",
      format: "video/h264-mp4",
      pingpong: false,
      save_output: true,
    },
  };

  return workflow;
}
