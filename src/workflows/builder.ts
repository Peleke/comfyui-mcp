import baseTxt2ImgWorkflow from "./txt2img.json" with { type: "json" };
import baseImg2ImgWorkflow from "./img2img.json" with { type: "json" };
import baseUpscaleWorkflow from "./upscale.json" with { type: "json" };

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
