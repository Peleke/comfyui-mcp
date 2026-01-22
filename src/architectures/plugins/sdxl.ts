/**
 * Stable Diffusion XL (SDXL) Architecture Plugin
 *
 * SDXL is the successor to SD1.5 with:
 * - 1024x1024 native resolution
 * - Two text encoders (CLIP-G + CLIP-L)
 * - Tag-based prompting with negative prompts
 * - Weight syntax (emphasis:1.2)
 *
 * This is the default/fallback architecture for unknown models.
 */

import type { ModelArchitecture } from "../types.js";

export const sdxlArchitecture: ModelArchitecture = {
  id: "sdxl",
  displayName: "Stable Diffusion XL",

  // Detection patterns - generic SDXL markers
  patterns: [
    /sdxl/i,
    /sd.*xl/i,
    /xl.*base/i,
    /xl.*refiner/i,
  ],
  priority: 50,

  // Capabilities
  supportsNegativePrompt: true,
  supportsWeightSyntax: true,
  supportsControlNet: true,
  supportsIPAdapter: true,

  // Defaults
  defaults: {
    width: 1024,
    height: 1024,
    steps: 28,
    cfgScale: 7,
    sampler: "euler_ancestral",
    scheduler: "normal",
  },

  // ControlNet models for SDXL
  controlNetModels: {
    canny: "controlnet-canny-sdxl-1.0.safetensors",
    depth: "controlnet-depth-sdxl-1.0.safetensors",
    openpose: "controlnet-openpose-sdxl-1.0.safetensors",
    qrcode: "qrCodeMonsterSDXL_v10.safetensors",
    scribble: "controlnet-scribble-sdxl-1.0.safetensors",
    lineart: "controlnet-lineart-sdxl-1.0.safetensors",
    semantic_seg: "controlnet-seg-sdxl-1.0.safetensors",
  },

  // IP-Adapter configuration for SDXL
  ipadapterConfig: {
    model: "ip-adapter-plus_sdxl_vit-h.safetensors",
    clipVision: "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors",
  },
};
