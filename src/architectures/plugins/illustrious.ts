/**
 * Illustrious XL Architecture Plugin
 *
 * Illustrious is an SDXL-based architecture optimized for:
 * - High-quality anime illustrations
 * - Booru-style tagging (danbooru tags)
 * - NovelAI-style prompting
 *
 * Uses SDXL ControlNet/IP-Adapter models.
 */

import type { ModelArchitecture } from "../types.js";

export const illustriousArchitecture: ModelArchitecture = {
  id: "illustrious",
  displayName: "Illustrious XL",

  // Detection patterns - anime-focused SDXL models
  patterns: [
    /illustrious/i,
    /noob/i,          // NoobAI/Noob models
    /wai.*xl/i,       // WaifuXL variants
    /anime.*xl/i,     // Generic anime XL
    /novelai/i,       // NovelAI-style models
  ],
  priority: 85,

  // Capabilities (same as SDXL)
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

  // Uses SDXL ControlNet models
  controlNetModels: {
    canny: "controlnet-canny-sdxl-1.0.safetensors",
    depth: "controlnet-depth-sdxl-1.0.safetensors",
    openpose: "controlnet-openpose-sdxl-1.0.safetensors",
    qrcode: "controlnet-qr-sdxl.safetensors",
    scribble: "controlnet-scribble-sdxl-1.0.safetensors",
    lineart: "controlnet-lineart-sdxl-1.0.safetensors",
    semantic_seg: "controlnet-seg-sdxl-1.0.safetensors",
  },

  // Uses SDXL IP-Adapter models
  ipadapterConfig: {
    model: "ip-adapter-plus_sdxl_vit-h.safetensors",
    clipVision: "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors",
  },
};
