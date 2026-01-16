/**
 * Stable Diffusion 1.5 Architecture Plugin
 *
 * SD1.5 is the original Stable Diffusion architecture. It uses:
 * - 512x512 native resolution (can go to 768x768)
 * - Tag-based prompting
 * - Negative prompts
 * - Weight syntax (emphasis:1.2)
 */

import type { ModelArchitecture } from "../types.js";

export const sd15Architecture: ModelArchitecture = {
  id: "sd15",
  displayName: "Stable Diffusion 1.5",

  // Detection patterns - lowest priority, only match explicit SD1.5 references
  patterns: [
    /v1-5/i,
    /sd.*1\.5/i,
    /sd15/i,
    /1\.5.*pruned/i,
    /stable.*diffusion.*1/i,
  ],
  priority: 40,

  // Capabilities
  supportsNegativePrompt: true,
  supportsWeightSyntax: true,
  supportsControlNet: true,
  supportsIPAdapter: true,

  // Defaults
  defaults: {
    width: 512,
    height: 768,
    steps: 20,
    cfgScale: 7,
    sampler: "euler_ancestral",
    scheduler: "normal",
  },

  // ControlNet models for SD1.5
  controlNetModels: {
    canny: "control_v11p_sd15_canny_fp16.safetensors",
    depth: "control_v11f1p_sd15_depth_fp16.safetensors",
    openpose: "control_v11p_sd15_openpose_fp16.safetensors",
    qrcode: "control_v1p_sd15_qrcode.safetensors",
    scribble: "control_v11p_sd15_scribble_fp16.safetensors",
    lineart: "control_v11p_sd15_lineart_fp16.safetensors",
    semantic_seg: "control_v11p_sd15_seg_fp16.safetensors",
  },

  // IP-Adapter configuration for SD1.5
  ipadapterConfig: {
    model: "ip-adapter-plus_sd15.safetensors",
    clipVision: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
  },
};
