/**
 * Pony Diffusion Architecture Plugin
 *
 * Pony is an SDXL-based architecture optimized for:
 * - Anime/furry art styles
 * - Score-based quality tags (score_9, score_8_up, etc.)
 * - Rating tags (rating_safe, rating_explicit, etc.)
 * - Source tags (source_anime, source_furry, etc.)
 *
 * Uses SDXL ControlNet/IP-Adapter models.
 */

import type { ModelArchitecture } from "../types.js";

export const ponyArchitecture: ModelArchitecture = {
  id: "pony",
  displayName: "Pony Diffusion XL",

  // Detection patterns - high priority for pony-specific markers
  patterns: [
    /pony/i,
    /pdxl/i,
    /score_/i,      // Score tags in filename
    /furry/i,       // Furry models are typically Pony-based
    /yiff/i,        // NSFW furry models
  ],
  priority: 90,

  // Capabilities (same as SDXL)
  supportsNegativePrompt: true,
  supportsWeightSyntax: true,
  supportsControlNet: true,
  supportsIPAdapter: true,

  // Defaults (same as SDXL but may want different CFG)
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
