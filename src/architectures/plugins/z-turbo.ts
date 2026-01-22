/**
 * Z-Image Turbo Architecture Plugin
 *
 * Z-Image Turbo is a 6B parameter DiT (Diffusion Transformer) based on
 * the Lumina architecture, developed by Tongyi Lab at Alibaba Group.
 *
 * Key characteristics:
 * - Single-stream transformer (not latent diffusion)
 * - Qwen 3 4B text encoder (lumina2 CLIP type)
 * - Turbo distillation: 8 steps optimal
 * - NO negative prompts (guidance_scale = 0 internally)
 * - NO CFG (set to 1.0, ignored anyway)
 * - Excellent text rendering (English + Chinese)
 * - Natural language prompts (100-300 words optimal)
 *
 * Variants:
 * - z_image_turbo_bf16: Standard BF16 precision
 * - z_image_turbo GGUF: Quantized for low VRAM
 * - Copax TimeLess XPlus-Z: Enhanced fine-tune
 * - Z-Image-Turbo-Anime: Anime variant
 */

import type { ModelArchitecture } from "../types.js";

export const zTurboArchitecture: ModelArchitecture = {
  id: "z_image_turbo",
  displayName: "Z-Image Turbo",

  // Detection patterns - high priority to catch Z-Image variants
  patterns: [
    /z[_-]?image/i,      // z_image, z-image, zimage
    /zimgt/i,            // LoRA naming convention
    /zImageTurbo/i,      // CamelCase variant
    /lumina.*turbo/i,    // Lumina-based turbo
    /copax.*timeless.*z/i, // Copax TimeLess Z variant
  ],
  priority: 95, // High priority, just below Flux

  // Capabilities - Z-Image Turbo is unique
  supportsNegativePrompt: false,  // CRITICAL: Completely ignored
  supportsWeightSyntax: false,    // Natural language only
  supportsControlNet: true,       // ControlNet works
  supportsIPAdapter: true,        // IP-Adapter works

  // Defaults - Turbo-optimized settings
  defaults: {
    width: 768,
    height: 1024,         // Portrait default
    steps: 8,             // Turbo distillation optimized
    cfgScale: 1,          // Fixed, any other value ignored
    sampler: "euler",     // Also: euler_ancestral, dpmpp_2m
    scheduler: "simple",  // Also: beta, normal
  },

  // ControlNet models (SDXL-compatible work with Z-Image)
  controlNetModels: {
    canny: "control-lora-canny-rank256.safetensors",
    depth: "control-lora-depth-rank256.safetensors",
    openpose: undefined, // Check availability
  },

  // IP-Adapter config (uses SDXL-compatible models)
  ipadapterConfig: {
    model: "ip-adapter-plus_sdxl_vit-h.safetensors",
    clipVision: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
  },
};
