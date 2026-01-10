import baseTxt2ImgWorkflow from "./txt2img.json" with { type: "json" };
import baseImg2ImgWorkflow from "./img2img.json" with { type: "json" };
import baseUpscaleWorkflow from "./upscale.json" with { type: "json" };
import baseControlNetWorkflow from "./controlnet.json" with { type: "json" };
import baseTTSWorkflow from "./tts.json" with { type: "json" };
import baseLipSyncWorkflow from "./lipsync-sonic.json" with { type: "json" };

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
    case "lineart":
      return "AnyLineArtPreprocessor";
    case "semantic_seg":
      return "OneFormer-ADE20K-SemSegPreprocessor";
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
    inputs.low_threshold = options?.lowThreshold ?? 100;
    inputs.high_threshold = options?.highThreshold ?? 200;
  } else if (type === "openpose") {
    inputs.detect_body = options?.detectBody ?? true;
    inputs.detect_face = options?.detectFace ?? true;
    inputs.detect_hand = options?.detectHands ?? true;
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
  checkpoint?: string;
  clipVision?: string;
  vae?: string;
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
 */
export function buildLipSyncWorkflow(params: LipSyncParams): Record<string, any> {
  const workflow = JSON.parse(JSON.stringify(baseLipSyncWorkflow));

  // Set checkpoint model (required for SONIC base model)
  if (params.checkpoint) {
    workflow["1"].inputs.ckpt_name = params.checkpoint;
  }

  // Set CLIP Vision model
  if (params.clipVision) {
    workflow["2"].inputs.clip_name = params.clipVision;
  }

  // Set VAE
  if (params.vae) {
    workflow["3"].inputs.vae_name = params.vae;
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
  workflow["7"].inputs.duration = params.duration ?? 10.0;
  workflow["7"].inputs.expand_ratio = params.expandRatio ?? 0.5;

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
  checkpoint?: string;
  clipVision?: string;
  vae?: string;
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
  // Load checkpoint for SONIC base
  workflow["sonic_1"] = {
    class_type: "CheckpointLoaderSimple",
    inputs: {
      ckpt_name: params.checkpoint || "sd_xl_base_1.0.safetensors",
    },
  };

  // Load CLIP Vision
  workflow["sonic_2"] = {
    class_type: "CLIPVisionLoader",
    inputs: {
      clip_name: params.clipVision || "clip_vision_g.safetensors",
    },
  };

  // Load VAE
  workflow["sonic_3"] = {
    class_type: "VAELoader",
    inputs: {
      vae_name: params.vae || "sdxl_vae.safetensors",
    },
  };

  // Load portrait image
  workflow["sonic_4"] = {
    class_type: "LoadImage",
    inputs: {
      image: params.portraitImage,
    },
  };

  // SONIC Loader
  workflow["sonic_5"] = {
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
  workflow["sonic_6"] = {
    class_type: "SONIC_PreData",
    inputs: {
      clip_vision: ["sonic_2", 0],
      vae: ["sonic_3", 0],
      audio: ["tts_2", 0], // TTS output feeds into lip-sync
      image: ["sonic_4", 0],
      weight_dtype: ["sonic_5", 1],
      min_resolution: 512,
      duration: 30.0, // Allow longer clips
      expand_ratio: 0.5,
    },
  };

  // SONIC Sampler
  workflow["sonic_7"] = {
    class_type: "SONICSampler",
    inputs: {
      model: ["sonic_5", 0],
      data_dict: ["sonic_6", 0],
      seed: params.lipSyncSeed ?? Math.floor(Math.random() * 2147483647),
      inference_steps: params.inferenceSteps ?? 25,
      dynamic_scale: 1.0,
      fps: params.fps ?? 25.0,
    },
  };

  // Video output
  workflow["output"] = {
    class_type: "VHS_VideoCombine",
    inputs: {
      images: ["sonic_7", 0],
      frame_rate: ["sonic_7", 1],
      loop_count: 0,
      filename_prefix: params.filenamePrefix || "ComfyUI_TalkingAvatar",
      format: "video/h264-mp4",
      pingpong: false,
      save_output: true,
    },
  };

  return workflow;
}
