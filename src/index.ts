#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { ComfyUIClient } from "./comfyui-client.js";
import { generateImage, generateImageSchema, img2img, img2imgSchema } from "./tools/generate.js";
import { listModels, listSamplers, listSchedulers, listLoras } from "./tools/list-models.js";
import { getQueueStatus } from "./tools/queue-status.js";
import { upscaleImage, upscaleSchema, listUpscaleModels } from "./tools/upscale.js";
import { craftPrompt, craftPromptSchema, getPromptingGuide, listPromptingStrategies } from "./tools/craft-prompt.js";
import { executePipeline, executePipelineSchema } from "./tools/pipeline.js";
import { imagine, imagineSchema } from "./tools/imagine.js";
import {
  generateWithControlNet,
  generateWithControlNetSchema,
  generateWithMultiControlNet,
  generateWithMultiControlNetSchema,
  preprocessControlImage,
  preprocessControlImageSchema,
  generateWithHiddenImage,
  generateWithHiddenImageSchema,
  stylizePhoto,
  stylizePhotoSchema,
  generateWithPose,
  generateWithPoseSchema,
  generateWithComposition,
  generateWithCompositionSchema,
  listControlNetModels,
} from "./tools/controlnet.js";
import {
  ttsGenerate,
  ttsGenerateSchema,
  listTTSModels,
  listTTSModelsSchema,
  listVoices,
  listVoicesSchema,
} from "./tools/tts.js";
import {
  lipSyncGenerate,
  lipSyncGenerateSchema,
  talk,
  talkSchema,
  listLipSyncModels,
  listLipSyncModelsSchema,
} from "./tools/lipsync.js";
import {
  imageToVideo,
  imageToVideoSchema,
  listAnimateDiffModels,
  listAnimateDiffModelsSchema,
} from "./tools/video.js";
import {
  listAvatars,
  listAvatarsSchema,
  listVoicesCatalog,
  listVoicesCatalogSchema,
  createPortrait,
  createPortraitSchema,
  batchCreatePortraits,
  batchCreatePortraitsSchema,
} from "./tools/avatar.js";
import {
  checkConnection,
  checkConnectionSchema,
  pingComfyUI,
} from "./tools/health.js";
import {
  ipadapter,
  ipadapterSchema,
} from "./tools/ipadapter.js";
import {
  inpaint,
  inpaintSchema,
  outpaint,
  outpaintSchema,
} from "./tools/inpaint.js";

// Configuration from environment
const COMFYUI_URL = process.env.COMFYUI_URL || "http://localhost:8188";
const COMFYUI_MODEL = process.env.COMFYUI_MODEL || "";
const COMFYUI_OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR || "/tmp/comfyui-output";
const COMFYUI_INPUT_DIR = process.env.COMFYUI_INPUT_DIR || "/tmp/comfyui-input";

// Initialize client
const client = new ComfyUIClient({
  url: COMFYUI_URL,
  outputDir: COMFYUI_OUTPUT_DIR,
  inputDir: COMFYUI_INPUT_DIR,
});

// Tool definitions
const TOOLS = [
  {
    name: "generate_image",
    description:
      "Render a single image from a text prompt (txt2img). Returns JSON with the saved file path and generation metadata (~400 tokens). Call when the user provides a prompt AND you already know the exact model, sampler, and dimensions — otherwise use 'imagine' which auto-configures everything. Unlike img2img, starts from noise, not an existing image.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The positive prompt describing what to generate",
        },
        negative_prompt: {
          type: "string",
          description: "Things to avoid in the generation (default: 'bad quality, blurry')",
        },
        width: {
          type: "number",
          description: "Image width in pixels (default: 512)",
          default: 512,
        },
        height: {
          type: "number",
          description: "Image height in pixels (default: 768)",
          default: 768,
        },
        steps: {
          type: "number",
          description: "Number of sampling steps (default: 28)",
          default: 28,
        },
        cfg_scale: {
          type: "number",
          description: "CFG scale for guidance (default: 7)",
          default: 7,
        },
        sampler: {
          type: "string",
          description: "Sampler name (default: euler_ancestral)",
          default: "euler_ancestral",
        },
        scheduler: {
          type: "string",
          description: "Scheduler name (default: normal)",
          default: "normal",
        },
        model: {
          type: "string",
          description: "Checkpoint model name. Uses COMFYUI_MODEL env var if not specified.",
        },
        seed: {
          type: "number",
          description: "Random seed for reproducibility. Random if not specified.",
        },
        loras: {
          type: "array",
          description: "Array of LoRAs to apply for style/character customization",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "LoRA filename" },
              strength_model: { type: "number", description: "Model strength (default: 1.0)" },
              strength_clip: { type: "number", description: "CLIP strength (default: 1.0)" },
            },
            required: ["name"],
          },
        },
        output_path: {
          type: "string",
          description: "Full path where the image should be saved",
        },
      },
      required: ["prompt", "output_path"],
    },
  },
  {
    name: "img2img",
    description:
      "Transform an existing image with a text prompt (img2img). Returns JSON with saved file path and metadata (~400 tokens). Call when the user has a source image they want to modify — denoise 0.3 preserves most detail, 0.9 reimagines it. Unlike generate_image, requires an input image; unlike stylize_photo, gives full prompt control without ControlNet.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The positive prompt describing what to generate",
        },
        negative_prompt: {
          type: "string",
          description: "Things to avoid in the generation",
        },
        input_image: {
          type: "string",
          description: "Filename of image in ComfyUI input folder",
        },
        denoise: {
          type: "number",
          description: "Denoise strength: 0.0 = no change, 1.0 = full regeneration (default: 0.75)",
          default: 0.75,
        },
        steps: {
          type: "number",
          description: "Number of sampling steps (default: 28)",
          default: 28,
        },
        cfg_scale: {
          type: "number",
          description: "CFG scale for guidance (default: 7)",
          default: 7,
        },
        sampler: {
          type: "string",
          description: "Sampler name (default: euler_ancestral)",
        },
        scheduler: {
          type: "string",
          description: "Scheduler name (default: normal)",
        },
        model: {
          type: "string",
          description: "Checkpoint model name",
        },
        seed: {
          type: "number",
          description: "Random seed for reproducibility",
        },
        loras: {
          type: "array",
          description: "Array of LoRAs to apply",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              strength_model: { type: "number" },
              strength_clip: { type: "number" },
            },
            required: ["name"],
          },
        },
        output_path: {
          type: "string",
          description: "Full path where the image should be saved",
        },
      },
      required: ["prompt", "input_image", "output_path"],
    },
  },
  {
    name: "upscale_image",
    description: "Increase image resolution using AI upscaling (default: RealESRGAN 4x). Returns JSON with saved file path and final dimensions (~300 tokens). Call after generation when the user needs a higher-resolution version. Unlike the upscale step in execute_pipeline, this is standalone — use it on any existing image.",
    inputSchema: {
      type: "object",
      properties: {
        input_image: {
          type: "string",
          description: "Filename of image in ComfyUI input folder",
        },
        upscale_model: {
          type: "string",
          description: "Upscale model (default: RealESRGAN_x4plus.pth)",
          default: "RealESRGAN_x4plus.pth",
        },
        target_width: {
          type: "number",
          description: "Optional target width after upscale",
        },
        target_height: {
          type: "number",
          description: "Optional target height after upscale",
        },
        output_path: {
          type: "string",
          description: "Full path where the upscaled image should be saved",
        },
      },
      required: ["input_image", "output_path"],
    },
  },
  {
    name: "list_models",
    description: "Get all installed checkpoint model filenames. Returns a JSON array of model name strings (~200-800 tokens depending on install). Call before generate_image/execute_pipeline when you need to pick a model, or to verify a model exists before referencing it. Unlike list_loras, these are base models, not style add-ons.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_loras",
    description: "Get all installed LoRA filenames for style/character customization. Returns a JSON array of LoRA name strings (~200-800 tokens). Call when the user wants a specific style or character and you need to find matching LoRAs. Unlike list_models, these are style add-ons applied on top of a base checkpoint.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_samplers",
    description: "Get all available sampler algorithm names (euler, dpm++, etc.). Returns a JSON array of strings (~100-200 tokens). Call only when the user asks for a specific sampler or you need to verify one exists. Most tools default to euler_ancestral — you rarely need this unless customizing.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_schedulers",
    description: "Get all available scheduler names (normal, karras, sgm_uniform, etc.). Returns a JSON array of strings (~100-200 tokens). Call only when the user specifically requests a scheduler or you need to verify one exists. Default 'normal' works for most cases — this is a rare lookup.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_upscale_models",
    description: "Get all installed AI upscale model filenames. Returns a JSON array of strings (~100-300 tokens). Call before upscale_image when you need to pick a specific upscaler or verify RealESRGAN_x4plus.pth is available. Unlike list_models, these are post-processing upscalers, not generation checkpoints.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_queue_status",
    description: "Check how many jobs are running and pending in the ComfyUI queue. Returns JSON with running_count, pending_count, and job details (~200-400 tokens). Call before submitting a new generation if the user is waiting and you need to check whether previous work finished. Unlike ping_comfyui, this shows workload, not just connectivity.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "craft_prompt",
    description:
      "Convert a natural language description into an optimized prompt for a specific model family. Returns JSON with positive prompt, negative prompt, recommended settings, LoRA suggestions, and pipeline config (~600-900 tokens). Call before generate_image/execute_pipeline when you need model-specific prompt engineering — or skip this entirely and use 'imagine' which calls it internally. Unlike get_prompting_guide, this returns a ready-to-use prompt, not tips.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Natural language description of what you want to generate",
        },
        model_name: {
          type: "string",
          description: "Model name for auto-detection of prompting strategy",
        },
        model_family: {
          type: "string",
          enum: ["illustrious", "pony", "sdxl", "flux", "sd15", "realistic"],
          description: "Explicit model family (overrides auto-detection)",
        },
        style: {
          type: "string",
          enum: [
            "anime", "realistic_photo", "digital_art", "oil_painting",
            "watercolor", "sketch", "3d_render", "pixel_art", "comic",
            "cinematic", "fantasy", "sci_fi", "portrait", "landscape", "concept_art"
          ],
          description: "Style preset to apply",
        },
        rating: {
          type: "string",
          enum: ["safe", "suggestive", "explicit"],
          description: "Content rating (default: safe)",
        },
        aspect_ratio: {
          type: "string",
          enum: ["portrait", "landscape", "square", "wide", "tall"],
          description: "Desired aspect ratio",
        },
        camera_focal_length: {
          type: "string",
          description: "Camera focal length (e.g., '85mm', '35mm')",
        },
        camera_aperture: {
          type: "string",
          description: "Camera aperture (e.g., 'f/1.4', 'f/8')",
        },
        camera_lighting: {
          type: "string",
          description: "Lighting style (e.g., 'golden hour', 'studio lighting')",
        },
        camera_angle: {
          type: "string",
          description: "Camera angle (e.g., 'low angle', 'bird\\'s eye')",
        },
        style_keywords: {
          type: "array",
          items: { type: "string" },
          description: "Additional style keywords to include",
        },
        emphasize: {
          type: "array",
          items: { type: "string" },
          description: "Elements to emphasize (will be weighted)",
        },
        include_lora_recommendations: {
          type: "boolean",
          description: "Whether to include LoRA recommendations (default: true)",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "get_prompting_guide",
    description: "Get prompting syntax rules and an example prompt for one model family (illustrious, pony, sdxl, flux, sd15, realistic). Returns markdown with tag format, quality tokens, and a worked example (~400-600 tokens). Call when learning how a new model family expects prompts. Unlike craft_prompt, this teaches the format — it doesn't generate a ready-to-use prompt.",
    inputSchema: {
      type: "object",
      properties: {
        model_family: {
          type: "string",
          enum: ["illustrious", "pony", "sdxl", "flux", "sd15", "realistic"],
          description: "The model family to get prompting tips for",
        },
      },
      required: ["model_family"],
    },
  },
  {
    name: "list_prompting_strategies",
    description: "Get a summary of all supported model families and how they differ (tag format, quality tokens, typical settings). Returns JSON with 6 families: illustrious, pony, sdxl, flux, sd15, realistic (~300-500 tokens). Call once at session start if you'll be generating across multiple model types. Unlike get_prompting_guide, this is an overview — not deep tips for one family.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "execute_pipeline",
    description:
      "Run a multi-stage image pipeline: txt2img, then optional hi-res fix (img2img detail pass), then optional AI upscale. Returns JSON with saved file path, dimensions, and stage metadata (~500 tokens). Call when you need fine-grained control over a multi-stage generation — if you just want 'best results from a description', use 'imagine' instead. Unlike generate_image, this chains stages; unlike imagine, it requires manual prompt/model configuration.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The positive prompt",
        },
        negative_prompt: {
          type: "string",
          description: "The negative prompt",
        },
        model: {
          type: "string",
          description: "Checkpoint model to use",
        },
        output_path: {
          type: "string",
          description: "Final output path for the image",
        },
        width: {
          type: "number",
          description: "Image width (default: 768)",
          default: 768,
        },
        height: {
          type: "number",
          description: "Image height (default: 1024)",
          default: 1024,
        },
        steps: {
          type: "number",
          description: "Sampling steps (default: 28)",
          default: 28,
        },
        cfg_scale: {
          type: "number",
          description: "CFG scale (default: 7)",
          default: 7,
        },
        sampler: {
          type: "string",
          description: "Sampler name (default: euler_ancestral)",
          default: "euler_ancestral",
        },
        scheduler: {
          type: "string",
          description: "Scheduler name (default: normal)",
          default: "normal",
        },
        seed: {
          type: "number",
          description: "Random seed for reproducibility",
        },
        loras: {
          type: "array",
          description: "Array of LoRAs to apply",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              strength_model: { type: "number" },
              strength_clip: { type: "number" },
            },
            required: ["name"],
          },
        },
        enable_hires_fix: {
          type: "boolean",
          description: "Enable hi-res fix pass (img2img for detail enhancement)",
          default: false,
        },
        hires_scale: {
          type: "number",
          description: "Scale factor for hi-res fix (default: 1.5)",
          default: 1.5,
        },
        hires_denoise: {
          type: "number",
          description: "Denoise strength for hi-res fix (default: 0.4, lower = preserve more)",
          default: 0.4,
        },
        hires_steps: {
          type: "number",
          description: "Steps for hi-res fix (default: 20)",
          default: 20,
        },
        enable_upscale: {
          type: "boolean",
          description: "Enable AI upscaling as final step",
          default: false,
        },
        upscale_model: {
          type: "string",
          description: "Upscale model (default: RealESRGAN_x4plus.pth)",
          default: "RealESRGAN_x4plus.pth",
        },
      },
      required: ["prompt", "model", "output_path"],
    },
  },
  {
    name: "imagine",
    description:
      "Generate an image from a plain-English description with zero configuration. Auto-detects model family, crafts optimized prompts, selects settings, and runs the full pipeline (txt2img + optional hi-res fix + upscale). Returns JSON with saved file path, crafted prompt, and pipeline metadata (~600-800 tokens). Call this as your DEFAULT for any image generation request. Use generate_image or execute_pipeline only when you need manual control over every parameter.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description:
            "Natural language description of what to generate. Be descriptive! e.g., 'A mystical forest at twilight with glowing mushrooms and a small fairy'",
        },
        output_path: {
          type: "string",
          description: "Full path where the final image should be saved",
        },
        model: {
          type: "string",
          description: "Checkpoint model to use. If not specified, uses COMFYUI_MODEL env var",
        },
        model_family: {
          type: "string",
          enum: ["illustrious", "pony", "sdxl", "flux", "sd15", "realistic"],
          description: "Model family for prompt optimization. Auto-detected from model name if not specified",
        },
        style: {
          type: "string",
          enum: [
            "anime", "realistic_photo", "digital_art", "oil_painting", "watercolor",
            "sketch", "3d_render", "pixel_art", "comic", "cinematic", "portrait",
            "landscape", "fantasy", "scifi", "horror"
          ],
          description: "Style preset to apply",
        },
        artist_reference: {
          type: "string",
          description: "Artist style reference, e.g., 'studio ghibli', 'makoto shinkai'",
        },
        rating: {
          type: "string",
          enum: ["safe", "suggestive", "explicit"],
          description: "Content rating (mainly affects Pony models)",
        },
        quality: {
          type: "string",
          enum: ["draft", "standard", "high", "ultra"],
          description: "Quality preset: draft (fast), standard (balanced), high (hi-res fix), ultra (hi-res + upscale)",
          default: "standard",
        },
        width: { type: "number", description: "Image width (default: auto based on model)" },
        height: { type: "number", description: "Image height (default: auto based on model)" },
        steps: { type: "number", description: "Sampling steps (default: auto based on model)" },
        cfg_scale: { type: "number", description: "CFG scale (default: auto based on model)" },
        sampler: { type: "string", description: "Sampler (default: auto based on model)" },
        scheduler: { type: "string", description: "Scheduler (default: normal)" },
        seed: { type: "number", description: "Seed for reproducibility" },
        loras: {
          type: "array",
          description: "LoRAs to apply",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "LoRA filename" },
              strength_model: { type: "number", description: "Model strength (default: 1.0)" },
              strength_clip: { type: "number", description: "CLIP strength (default: 1.0)" },
            },
            required: ["name"],
          },
        },
        auto_recommend_loras: {
          type: "boolean",
          description: "Automatically recommend LoRAs based on style",
          default: false,
        },
        enable_hires_fix: {
          type: "boolean",
          description: "Override: enable hi-res fix (or use quality preset)",
        },
        hires_scale: { type: "number", description: "Scale factor for hi-res fix (default: 1.5)" },
        hires_denoise: { type: "number", description: "Denoise strength for hi-res fix (default: 0.4)" },
        enable_upscale: {
          type: "boolean",
          description: "Override: enable AI upscaling (or use quality preset)",
        },
        upscale_model: {
          type: "string",
          description: "Upscale model (default: RealESRGAN_x4plus.pth)",
        },
        // Hidden image (QR ControlNet) parameters
        hidden_image: {
          type: "string",
          description: "Filename of image to embed (in ComfyUI input folder). When provided, uses QR ControlNet to hide the image in the generation.",
        },
        convert_to_bw: {
          type: "boolean",
          description: "Auto-convert the hidden image to high-contrast B&W before use",
          default: false,
        },
        bw_threshold: {
          type: "number",
          description: "Threshold for B&W conversion (0-255). Pixels above become white, below become black",
          default: 128,
        },
        bw_invert: {
          type: "boolean",
          description: "Invert the B&W result (swap black and white)",
          default: false,
        },
        visibility: {
          type: "string",
          enum: ["subtle", "moderate", "obvious"],
          description: "How visible the hidden image should be (subtle=0.9, moderate=1.1, obvious=1.3 strength)",
          default: "subtle",
        },
      },
      required: ["description", "output_path"],
    },
  },
  // =========================================================================
  // ControlNet Tools
  // =========================================================================
  {
    name: "generate_with_controlnet",
    description:
      "Generate an image guided by a structural control signal from a reference image (edges, depth, pose, etc.). Returns JSON with saved file path and metadata (~400 tokens). Call when the user wants to preserve specific structure (edges, pose, depth) from a reference while generating new content. For pose-only, use generate_with_pose; for style transfer, use stylize_photo; for multiple controls, use generate_with_multi_controlnet.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The positive prompt" },
        negative_prompt: { type: "string", description: "The negative prompt" },
        control_image: {
          type: "string",
          description: "Filename of control image in ComfyUI input folder",
        },
        control_type: {
          type: "string",
          enum: ["canny", "depth", "openpose", "qrcode", "scribble", "lineart", "semantic_seg"],
          description: "Type of control to apply",
        },
        controlnet_model: {
          type: "string",
          description: "Specific ControlNet model (auto-selected if not specified)",
        },
        strength: {
          type: "number",
          description: "ControlNet strength (0.0-2.0, default varies by type)",
        },
        start_percent: {
          type: "number",
          default: 0.0,
          description: "When to start applying control (0.0-1.0)",
        },
        end_percent: {
          type: "number",
          default: 1.0,
          description: "When to stop applying control (0.0-1.0)",
        },
        preprocess: {
          type: "boolean",
          default: true,
          description: "Auto-preprocess the control image",
        },
        preprocessor_options: {
          type: "object",
          description: "Type-specific preprocessor options",
          properties: {
            low_threshold: { type: "number", description: "Canny: low threshold" },
            high_threshold: { type: "number", description: "Canny: high threshold" },
            detect_body: { type: "boolean", description: "OpenPose: detect body" },
            detect_face: { type: "boolean", description: "OpenPose: detect face" },
            detect_hands: { type: "boolean", description: "OpenPose: detect hands" },
            object_min_size: { type: "number", description: "Lineart: minimum object size" },
          },
        },
        width: { type: "number", default: 512 },
        height: { type: "number", default: 768 },
        steps: { type: "number", default: 28 },
        cfg_scale: { type: "number", default: 7 },
        sampler: { type: "string", default: "euler_ancestral" },
        scheduler: { type: "string", default: "normal" },
        model: { type: "string", description: "Checkpoint model" },
        seed: { type: "number" },
        loras: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              strength_model: { type: "number" },
              strength_clip: { type: "number" },
            },
            required: ["name"],
          },
        },
        output_path: { type: "string", description: "Full path to save output" },
      },
      required: ["prompt", "control_image", "control_type", "output_path"],
    },
  },
  {
    name: "generate_with_multi_controlnet",
    description:
      "Generate an image with 2-5 ControlNet conditions stacked (e.g., pose + depth + canny). Returns JSON with saved file path and metadata (~500 tokens). Call when a single control type isn't enough — the user needs both pose AND depth, or edges AND segmentation. Unlike generate_with_controlnet (single control), this combines multiple structural constraints.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The positive prompt" },
        negative_prompt: { type: "string" },
        controls: {
          type: "array",
          description: "Array of control conditions (1-5)",
          items: {
            type: "object",
            properties: {
              image: { type: "string", description: "Control image filename" },
              type: {
                type: "string",
                enum: ["canny", "depth", "openpose", "qrcode", "scribble", "lineart", "semantic_seg"],
              },
              controlnet_model: { type: "string" },
              strength: { type: "number" },
              start_percent: { type: "number", default: 0.0 },
              end_percent: { type: "number", default: 1.0 },
            },
            required: ["image", "type"],
          },
        },
        preprocess: { type: "boolean", default: true },
        width: { type: "number", default: 512 },
        height: { type: "number", default: 768 },
        steps: { type: "number", default: 28 },
        cfg_scale: { type: "number", default: 7 },
        sampler: { type: "string", default: "euler_ancestral" },
        scheduler: { type: "string", default: "normal" },
        model: { type: "string" },
        seed: { type: "number" },
        loras: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              strength_model: { type: "number" },
              strength_clip: { type: "number" },
            },
            required: ["name"],
          },
        },
        output_path: { type: "string" },
      },
      required: ["prompt", "controls", "output_path"],
    },
  },
  {
    name: "preprocess_control_image",
    description:
      "Extract a control signal visualization from an image (canny edges, depth map, pose skeleton, etc.) without generating anything. Returns JSON with saved preprocessed image path (~300 tokens). Call to preview what a ControlNet will 'see' before committing to a full generation, or to create a control image for later use. Unlike generate_with_controlnet, this only preprocesses — no generation.",
    inputSchema: {
      type: "object",
      properties: {
        input_image: { type: "string", description: "Filename of image to preprocess" },
        control_type: {
          type: "string",
          enum: ["canny", "depth", "openpose", "scribble", "lineart", "semantic_seg"],
          description: "Type of preprocessing",
        },
        preprocessor_options: {
          type: "object",
          properties: {
            low_threshold: { type: "number" },
            high_threshold: { type: "number" },
            detect_body: { type: "boolean" },
            detect_face: { type: "boolean" },
            detect_hands: { type: "boolean" },
            object_min_size: { type: "number" },
          },
        },
        output_path: { type: "string", description: "Path to save preprocessed image" },
      },
      required: ["input_image", "control_type", "output_path"],
    },
  },
  {
    name: "generate_with_hidden_image",
    description:
      "Embed a hidden image (logo, symbol, watermark) inside a generated image using QR Code ControlNet. Returns JSON with saved file path (~400 tokens). Call when the user wants a steganographic or artistic hidden-image effect. Requires a high-contrast B&W hidden image. Visibility levels: subtle (barely visible), moderate, obvious. Unlike generate_with_controlnet with qrcode type, this has simplified visibility presets.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The visible image description" },
        negative_prompt: { type: "string" },
        hidden_image: {
          type: "string",
          description: "Filename of high-contrast B&W image to hide",
        },
        visibility: {
          type: "string",
          enum: ["subtle", "moderate", "obvious"],
          default: "subtle",
          description: "How visible the hidden image should be",
        },
        width: { type: "number", default: 512 },
        height: { type: "number", default: 768 },
        steps: { type: "number", default: 28 },
        cfg_scale: { type: "number", default: 7 },
        sampler: { type: "string", default: "euler_ancestral" },
        scheduler: { type: "string", default: "normal" },
        model: { type: "string" },
        seed: { type: "number" },
        loras: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              strength_model: { type: "number" },
              strength_clip: { type: "number" },
            },
            required: ["name"],
          },
        },
        output_path: { type: "string" },
      },
      required: ["prompt", "hidden_image", "output_path"],
    },
  },
  {
    name: "stylize_photo",
    description:
      "Restyle a photo as anime, oil painting, watercolor, comic, sketch, or Ghibli while preserving the original composition. Returns JSON with saved file path (~400 tokens). Call when the user has a real photo and wants an artistic transformation. Uses Canny/Lineart ControlNet internally. Unlike img2img, this preserves edges precisely; unlike generate_with_controlnet, this has one-click style presets.",
    inputSchema: {
      type: "object",
      properties: {
        source_image: { type: "string", description: "Filename of photo to stylize" },
        style: {
          type: "string",
          enum: ["anime", "oil_painting", "watercolor", "comic", "sketch", "ghibli"],
          description: "Target artistic style",
        },
        prompt: { type: "string", description: "Additional prompt to enhance the style" },
        preserve_detail: {
          type: "string",
          enum: ["low", "medium", "high"],
          default: "medium",
          description: "How closely to follow original lines",
        },
        width: { type: "number" },
        height: { type: "number" },
        steps: { type: "number", default: 28 },
        cfg_scale: { type: "number", default: 7 },
        sampler: { type: "string", default: "euler_ancestral" },
        scheduler: { type: "string", default: "normal" },
        model: { type: "string", description: "Checkpoint model (anime models recommended for anime style)" },
        seed: { type: "number" },
        loras: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              strength_model: { type: "number" },
              strength_clip: { type: "number" },
            },
            required: ["name"],
          },
        },
        output_path: { type: "string" },
      },
      required: ["source_image", "style", "output_path"],
    },
  },
  {
    name: "generate_with_pose",
    description:
      "Generate a new character in the exact pose from a reference photo (body, face, hands). Returns JSON with saved file path (~400 tokens). Call when the user has a reference image and wants a different character in the same pose. Uses OpenPose ControlNet. Unlike generate_with_controlnet, this auto-configures pose detection; unlike generate_with_ipadapter, this copies pose, not identity.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Character/scene description" },
        negative_prompt: { type: "string" },
        pose_reference: { type: "string", description: "Image with the pose to copy" },
        copy_face: {
          type: "boolean",
          default: true,
          description: "Also match facial expression",
        },
        copy_hands: {
          type: "boolean",
          default: true,
          description: "Also match hand positions",
        },
        width: { type: "number", default: 512 },
        height: { type: "number", default: 768 },
        steps: { type: "number", default: 28 },
        cfg_scale: { type: "number", default: 7 },
        sampler: { type: "string", default: "euler_ancestral" },
        scheduler: { type: "string", default: "normal" },
        model: { type: "string" },
        seed: { type: "number" },
        loras: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              strength_model: { type: "number" },
              strength_clip: { type: "number" },
            },
            required: ["name"],
          },
        },
        output_path: { type: "string" },
      },
      required: ["prompt", "pose_reference", "output_path"],
    },
  },
  {
    name: "generate_with_composition",
    description:
      "Generate an image matching the spatial layout of a reference (where sky, ground, figures are) but with creative freedom in details. Returns JSON with saved file path (~400 tokens). Call when the user wants 'same composition, different content.' Uses Semantic Segmentation ControlNet. Unlike generate_with_pose (copies body position), this copies scene layout; unlike stylize_photo, this creates new content.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to generate" },
        negative_prompt: { type: "string" },
        composition_reference: {
          type: "string",
          description: "Image with composition to match",
        },
        strength: {
          type: "number",
          default: 0.7,
          description: "How strictly to follow composition (0.5-0.9 recommended)",
        },
        width: { type: "number" },
        height: { type: "number" },
        steps: { type: "number", default: 28 },
        cfg_scale: { type: "number", default: 7 },
        sampler: { type: "string", default: "euler_ancestral" },
        scheduler: { type: "string", default: "normal" },
        model: { type: "string" },
        seed: { type: "number" },
        loras: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              strength_model: { type: "number" },
              strength_clip: { type: "number" },
            },
            required: ["name"],
          },
        },
        output_path: { type: "string" },
      },
      required: ["prompt", "composition_reference", "output_path"],
    },
  },
  {
    name: "list_controlnet_models",
    description: "Get all installed ControlNet models grouped by type (canny, depth, openpose, etc.). Returns JSON object keyed by control type, each with an array of model filenames (~300-600 tokens). Call before generate_with_controlnet to verify which control types are available, or to pick a specific model variant. Unlike list_models, these are structural-guidance models, not base checkpoints.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  // ============================================================================
  // IP-Adapter Tools
  // ============================================================================
  {
    name: "generate_with_ipadapter",
    description:
      "Generate an image that preserves the identity (face, character, style) from 1+ reference images. Returns JSON with saved file path (~400 tokens). Call when the user wants the same character/person across multiple images, or wants to transfer visual identity from a reference. Unlike generate_with_pose (copies pose only), this copies identity/appearance; unlike img2img, this works from a prompt + identity reference, not a source image.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The positive prompt" },
        negative_prompt: { type: "string", description: "The negative prompt" },
        reference_image: {
          type: "string",
          description: "Filename of reference image in ComfyUI input folder for identity preservation",
        },
        reference_images: {
          type: "array",
          items: { type: "string" },
          description: "Additional reference images for multi-reference generation",
        },
        weight: {
          type: "number",
          description: "IP-Adapter weight/strength (0.0-2.0, default 0.8)",
          default: 0.8,
        },
        weight_type: {
          type: "string",
          enum: [
            "linear",
            "ease in",
            "ease out",
            "ease in-out",
            "reverse in-out",
            "weak input",
            "weak output",
            "weak middle",
            "strong middle",
          ],
          description: "Weight application curve (default: linear)",
        },
        start_at: {
          type: "number",
          description: "When to start applying IP-Adapter (0.0-1.0, default: 0)",
        },
        end_at: {
          type: "number",
          description: "When to stop applying IP-Adapter (0.0-1.0, default: 1)",
        },
        combine_embeds: {
          type: "string",
          enum: ["concat", "add", "subtract", "average", "norm average"],
          description: "How to combine multiple reference image embeddings",
        },
        ipadapter_model: {
          type: "string",
          description: "IP-Adapter model file (auto-detected if not specified)",
        },
        clip_vision_model: {
          type: "string",
          description: "CLIP Vision model for encoding reference images",
        },
        model: { type: "string", description: "Checkpoint model" },
        width: { type: "number", default: 512 },
        height: { type: "number", default: 768 },
        steps: { type: "number", default: 28 },
        cfg_scale: { type: "number", default: 7 },
        sampler: { type: "string", default: "euler_ancestral" },
        scheduler: { type: "string", default: "normal" },
        seed: { type: "number" },
        loras: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              strength_model: { type: "number" },
              strength_clip: { type: "number" },
            },
            required: ["name"],
          },
        },
        output_path: { type: "string", description: "Full path to save output" },
        upload_to_cloud: {
          type: "boolean",
          description: "Upload result to cloud storage (default: true)",
        },
      },
      required: ["prompt", "reference_image", "output_path"],
    },
  },
  // ============================================================================
  // Inpainting / Outpainting Tools
  // ============================================================================
  {
    name: "inpaint",
    description:
      "Regenerate a masked region of an image while keeping the rest untouched (white=regenerate, black=keep). Returns JSON with saved file path (~400 tokens). Call when the user wants to fix a specific area (bad hands, wrong face, unwanted object) in an existing image. Requires a mask — use create_mask to auto-generate one if needed. Unlike outpaint, this works within existing bounds; unlike img2img, this targets a specific region.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to generate in the masked region" },
        negative_prompt: { type: "string", description: "Things to avoid" },
        source_image: {
          type: "string",
          description: "Source image filename in ComfyUI input folder",
        },
        mask_image: {
          type: "string",
          description: "Mask image filename (white = inpaint, black = keep)",
        },
        denoise_strength: {
          type: "number",
          description: "How much to change masked region (0.0-1.0, default: 0.75)",
          default: 0.75,
        },
        model: { type: "string", description: "Checkpoint model" },
        steps: { type: "number", default: 28 },
        cfg_scale: { type: "number", default: 7 },
        sampler: { type: "string", default: "euler_ancestral" },
        scheduler: { type: "string", default: "normal" },
        seed: { type: "number" },
        loras: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              strength_model: { type: "number" },
              strength_clip: { type: "number" },
            },
            required: ["name"],
          },
        },
        output_path: { type: "string", description: "Full path to save output" },
        upload_to_cloud: { type: "boolean", default: true },
      },
      required: ["prompt", "source_image", "mask_image", "output_path"],
    },
  },
  {
    name: "outpaint",
    description:
      "Extend an image's canvas in any direction and AI-generate content for the new regions, blending seamlessly with the original. Returns JSON with saved file path and new dimensions (~400 tokens). Call when the user wants more sky, ground, or scene beyond the current frame. Specify pixels to extend per side. Unlike inpaint (fixes regions inside), this grows the image outward.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to generate in extended regions" },
        negative_prompt: { type: "string", description: "Things to avoid" },
        source_image: {
          type: "string",
          description: "Source image filename in ComfyUI input folder",
        },
        extend_left: { type: "number", description: "Pixels to extend left", default: 0 },
        extend_right: { type: "number", description: "Pixels to extend right", default: 0 },
        extend_top: { type: "number", description: "Pixels to extend top", default: 0 },
        extend_bottom: { type: "number", description: "Pixels to extend bottom", default: 0 },
        feathering: {
          type: "number",
          description: "Blend feathering at edges (pixels, default: 40)",
          default: 40,
        },
        denoise_strength: {
          type: "number",
          description: "Denoise strength (default: 0.8 for outpaint)",
          default: 0.8,
        },
        model: { type: "string", description: "Checkpoint model" },
        steps: { type: "number", default: 28 },
        cfg_scale: { type: "number", default: 7 },
        sampler: { type: "string", default: "euler_ancestral" },
        scheduler: { type: "string", default: "normal" },
        seed: { type: "number" },
        loras: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              strength_model: { type: "number" },
              strength_clip: { type: "number" },
            },
            required: ["name"],
          },
        },
        output_path: { type: "string", description: "Full path to save output" },
        upload_to_cloud: { type: "boolean", default: true },
      },
      required: ["prompt", "source_image", "output_path"],
    },
  },
  {
    name: "create_mask",
    description:
      "Auto-generate a B&W mask for inpainting using AI segmentation (GroundingDINO + SAM). Returns JSON with saved mask file path (~300 tokens). Call before inpaint when you need a mask — use presets (hands, face, eyes, body, background, foreground), a custom text prompt ('red shirt', 'cat'), or manual coordinates. This is a prerequisite tool for inpaint — it produces the mask, not the final image.",
    inputSchema: {
      type: "object",
      properties: {
        source_image: {
          type: "string",
          description: "Source image filename in ComfyUI input folder",
        },
        preset: {
          type: "string",
          enum: ["hands", "face", "eyes", "body", "background", "foreground"],
          description: "Auto-detect region using AI segmentation",
        },
        text_prompt: {
          type: "string",
          description: "Custom text prompt for segmentation (e.g., 'red shirt', 'cat')",
        },
        region: {
          type: "object",
          properties: {
            x: { type: "number", description: "X position (0-100 percentage)" },
            y: { type: "number", description: "Y position (0-100 percentage)" },
            width: { type: "number", description: "Width (0-100 percentage)" },
            height: { type: "number", description: "Height (0-100 percentage)" },
          },
          required: ["x", "y", "width", "height"],
          description: "Manual rectangular region",
        },
        expand_pixels: {
          type: "number",
          description: "Expand mask by N pixels",
          default: 0,
        },
        feather_pixels: {
          type: "number",
          description: "Feather/blur mask edges by N pixels",
          default: 0,
        },
        invert: {
          type: "boolean",
          description: "Invert mask (swap white/black)",
          default: false,
        },
        sam_model: { type: "string", description: "SAM model (default: sam_vit_h)" },
        grounding_dino_model: { type: "string", description: "GroundingDINO model" },
        threshold: {
          type: "number",
          description: "Detection threshold (0.0-1.0, default: 0.3)",
          default: 0.3,
        },
        output_path: { type: "string", description: "Full path to save mask" },
        upload_to_cloud: { type: "boolean", default: true },
      },
      required: ["source_image", "output_path"],
    },
  },
  // ============================================================================
  // TTS Tools
  // ============================================================================
  {
    name: "tts_generate",
    description: "Convert text to speech with voice cloning from a reference audio sample (10-30s). Returns JSON with saved audio file path and duration (~300 tokens). Call when the user wants spoken audio from text in a specific voice. Requires a voice reference file — use list_voices to find available samples. Unlike the 'talk' tool, this produces audio only, no video.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to convert to speech",
        },
        voice_reference: {
          type: "string",
          description: "Reference audio file in ComfyUI input folder for voice cloning",
        },
        voice_reference_text: {
          type: "string",
          description: "Transcript of the reference audio (improves quality)",
        },
        speed: {
          type: "number",
          description: "Speech speed multiplier (0.5-2.0, default: 1.0)",
          default: 1.0,
        },
        seed: {
          type: "number",
          description: "Random seed (-1 for random)",
          default: -1,
        },
        model: {
          type: "string",
          description: "TTS model to use",
          default: "F5TTS_v1_Base",
        },
        vocoder: {
          type: "string",
          enum: ["auto", "vocos", "bigvgan"],
          description: "Vocoder for audio synthesis",
          default: "vocos",
        },
        output_path: {
          type: "string",
          description: "Full path to save the output audio",
        },
      },
      required: ["text", "voice_reference", "output_path"],
    },
  },
  {
    name: "list_tts_models",
    description: "Get installed text-to-speech model names and their capabilities. Returns a JSON array (~100-200 tokens). Call before tts_generate if you need a model other than the default F5TTS_v1_Base. Rarely needed — the default works for most voice cloning tasks.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_voices",
    description: "Get filenames of voice reference audio samples in the input folder. Returns a JSON array of filenames (~100-300 tokens). Call before tts_generate or talk to find a voice_reference file. Unlike list_voices_catalog, this returns just filenames without metadata.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  // ============================================================================
  // Lip-Sync Tools
  // ============================================================================
  {
    name: "lipsync_generate",
    description: "Animate a portrait photo to lip-sync with an audio file, producing an MP4 video. Returns JSON with saved video path and duration (~400 tokens). Call when you already have both a portrait image AND an audio file and want to make the portrait 'speak' the audio. Unlike 'talk' (handles TTS+lipsync in one call), this requires pre-existing audio.",
    inputSchema: {
      type: "object",
      properties: {
        portrait_image: {
          type: "string",
          description: "Filename of portrait image in ComfyUI input folder",
        },
        audio: {
          type: "string",
          description: "Filename of audio file in ComfyUI input folder",
        },
        model: {
          type: "string",
          enum: ["sonic", "dice-talk", "hallo2", "sadtalker"],
          description: "Lip-sync model to use",
          default: "sonic",
        },
        checkpoint: {
          type: "string",
          description: "Base SD model checkpoint",
        },
        sonic_unet: {
          type: "string",
          description: "SONIC unet model file",
          default: "unet.pth",
        },
        inference_steps: {
          type: "number",
          description: "Number of inference steps",
          default: 25,
        },
        fps: {
          type: "number",
          description: "Output video FPS",
          default: 25.0,
        },
        duration: {
          type: "number",
          description: "Maximum duration in seconds",
          default: 10.0,
        },
        seed: {
          type: "number",
          description: "Random seed for reproducibility",
        },
        output_path: {
          type: "string",
          description: "Full path to save the output video",
        },
      },
      required: ["portrait_image", "audio", "output_path"],
    },
  },
  {
    name: "talk",
    description: "End-to-end talking head: text in, MP4 video out. Chains TTS voice cloning + SONIC lip-sync in one call. Returns JSON with saved video path and duration (~500 tokens). Call this as your DEFAULT when the user wants a character to 'say' something — it handles the full Text → Speech → Lip-Sync → Video pipeline. Unlike lipsync_generate, you provide text, not audio; unlike tts_generate, you get video, not just audio.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to speak",
        },
        voice_reference: {
          type: "string",
          description: "Voice reference audio file in ComfyUI input folder",
        },
        voice_reference_text: {
          type: "string",
          description: "Transcript of the voice reference (improves quality)",
        },
        portrait_image: {
          type: "string",
          description: "Portrait image in ComfyUI input folder",
        },
        speed: {
          type: "number",
          description: "Speech speed multiplier",
          default: 1.0,
        },
        inference_steps: {
          type: "number",
          description: "Lip-sync inference steps",
          default: 25,
        },
        fps: {
          type: "number",
          description: "Output video FPS",
          default: 25.0,
        },
        output_path: {
          type: "string",
          description: "Full path to save the output video",
        },
      },
      required: ["text", "voice_reference", "portrait_image", "output_path"],
    },
  },
  {
    name: "list_lipsync_models",
    description: "Get installed lip-sync model names and status. Returns a JSON array with model names and availability (~100-200 tokens). Call before lipsync_generate if you need a model other than the default SONIC. Rarely needed — SONIC is the recommended default.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  // ============================================================================
  // Video Generation Tools (AnimateDiff)
  // ============================================================================
  {
    name: "image_to_video",
    description:
      "Animate a still image into a short video (default 16 frames) using AnimateDiff. Returns JSON with saved MP4 path and frame count (~400 tokens). Call when the user wants to bring a static image to life with motion. Two motion backends: animatediff_v3 (quality, 20 steps) or animatediff_lcm (fast, 6 steps). Requires an SD1.5 checkpoint. Unlike lipsync_generate (audio-driven face animation), this creates general motion from an image.",
    inputSchema: {
      type: "object",
      properties: {
        source_image: {
          type: "string",
          description: "Filename of source image in ComfyUI input folder",
        },
        output_path: {
          type: "string",
          description: "Full path to save the output video",
        },
        backend: {
          type: "string",
          enum: ["auto", "local", "runpod"],
          description: "Backend to use: 'auto' picks RunPod if configured, 'local' forces local ComfyUI, 'runpod' forces RunPod",
          default: "auto",
        },
        motion_backend: {
          type: "string",
          enum: ["animatediff_v3", "animatediff_lcm"],
          description: "AnimateDiff backend: 'animatediff_v3' for quality (20 steps), 'animatediff_lcm' for speed (6 steps)",
          default: "animatediff_v3",
        },
        checkpoint: {
          type: "string",
          description: "SD1.5 checkpoint model (default: v1-5-pruned-emaonly.safetensors)",
        },
        prompt: {
          type: "string",
          description: "Text prompt to guide the animation (optional)",
        },
        negative_prompt: {
          type: "string",
          description: "Negative prompt (optional)",
        },
        width: {
          type: "number",
          description: "Output video width (default: 512)",
          default: 512,
        },
        height: {
          type: "number",
          description: "Output video height (default: 512)",
          default: 512,
        },
        frames: {
          type: "number",
          description: "Number of frames to generate (default: 16)",
          default: 16,
        },
        fps: {
          type: "number",
          description: "Output video FPS (default: 8)",
          default: 8,
        },
        steps: {
          type: "number",
          description: "Sampling steps (default: 6 for LCM, 20 for v3)",
        },
        cfg_scale: {
          type: "number",
          description: "CFG scale (default: 1.8 for LCM, 7.0 for v3)",
        },
        seed: {
          type: "number",
          description: "Random seed for reproducibility",
        },
        motion_scale: {
          type: "number",
          description: "Motion intensity scale (default: 1.0)",
          default: 1.0,
        },
        upload_to_cloud: {
          type: "boolean",
          description: "Upload to cloud storage if configured (default: true)",
          default: true,
        },
      },
      required: ["source_image", "output_path"],
    },
  },
  {
    name: "list_animatediff_models",
    description: "Get installed AnimateDiff motion model filenames and compatible SD1.5 checkpoints. Returns JSON with arrays for motion_models and checkpoints (~200-400 tokens). Call before image_to_video to verify which motion models are available or to pick a specific SD1.5 checkpoint.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  // ============================================================================
  // Avatar Management Tools
  // ============================================================================
  {
    name: "list_avatars",
    description:
      "Get filenames of portrait images available for lip-sync (in input/avatars/). Returns a JSON array of image filenames (~100-300 tokens). Call before lipsync_generate or talk to find a portrait_image file, or to check what avatars are ready to use. Unlike list_voices_catalog (voice samples), this lists face/portrait images.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_voices_catalog",
    description:
      "Get voice reference files with metadata (duration, format, size) from input/voices/. Returns a JSON array of objects with filename, duration_seconds, and file_size (~200-500 tokens). Call before tts_generate or talk to pick a voice sample with enough context to choose well. Unlike list_voices (filenames only), this includes duration and format metadata.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "create_portrait",
    description:
      "Generate a front-facing portrait image optimized for lip-sync use. Returns JSON with saved file path (~400 tokens). Call when you need to create a new avatar for lipsync_generate or talk and no suitable portrait exists in list_avatars. Supports backends: flux_gguf (local), flux_fp8 (RunPod), sdxl (diverse styles). Unlike 'imagine' (general-purpose), this auto-applies portrait framing and lip-sync-friendly composition.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Description of the person/character to generate",
        },
        style: {
          type: "string",
          enum: ["realistic", "artistic", "anime", "furry"],
          description: "Visual style (default: realistic)",
        },
        gender: {
          type: "string",
          enum: ["male", "female", "androgynous"],
          description: "Gender presentation (helps with prompting)",
        },
        age: {
          type: "string",
          description: "Approximate age (e.g., '30s', 'elderly', 'young')",
        },
        expression: {
          type: "string",
          enum: ["neutral", "slight_smile", "serious", "friendly"],
          description: "Facial expression (default: neutral)",
        },
        backend: {
          type: "string",
          enum: ["flux_gguf", "flux_fp8", "sdxl"],
          description: "Model backend: flux_gguf (local quant), flux_fp8 (standard Flux), sdxl (SDXL checkpoints). Default: sdxl",
        },
        model: {
          type: "string",
          description: "Model to use. For sdxl: checkpoint name. For flux_gguf: GGUF file. For flux_fp8: Flux checkpoint.",
        },
        guidance: {
          type: "number",
          description: "CFG scale (default: 7 for SDXL, 2 for Flux)",
        },
        steps: {
          type: "number",
          description: "Sampling steps (default: 28 for SDXL, 4 for Flux schnell)",
        },
        width: {
          type: "number",
          description: "Image width (default: 768)",
        },
        height: {
          type: "number",
          description: "Image height (default: 1024 for portrait orientation)",
        },
        seed: {
          type: "number",
          description: "Random seed for reproducibility",
        },
        output_path: {
          type: "string",
          description: "Full path to save the portrait image",
        },
      },
      required: ["description", "output_path"],
    },
  },
  {
    name: "batch_create_portraits",
    description:
      "Generate multiple portrait images in a single call, each with its own model/style/description. Returns JSON array with saved file paths, one per portrait (~300-600 tokens). Call when the user needs a library of avatars or wants to compare the same character across different models. Unlike create_portrait (one at a time), this batches N portraits in one request.",
    inputSchema: {
      type: "object",
      properties: {
        portraits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string", description: "Character description" },
              style: { type: "string", enum: ["realistic", "artistic", "anime", "furry"] },
              gender: { type: "string", enum: ["male", "female", "androgynous"] },
              age: { type: "string" },
              expression: { type: "string", enum: ["neutral", "slight_smile", "serious", "friendly"] },
              model: { type: "string", description: "Checkpoint model to use" },
              name: { type: "string", description: "Unique name for this portrait (used in filename)" },
            },
            required: ["description", "model", "name"],
          },
          description: "List of portraits to generate",
        },
        backend: {
          type: "string",
          enum: ["flux_gguf", "flux_fp8", "sdxl"],
          description: "Model backend (default: sdxl)",
        },
        output_dir: {
          type: "string",
          description: "Directory to save all portraits",
        },
        steps: {
          type: "number",
          description: "Sampling steps (default: 28)",
        },
        guidance: {
          type: "number",
          description: "CFG scale (default: 7)",
        },
      },
      required: ["portraits", "output_dir"],
    },
  },
  {
    name: "check_connection",
    description:
      "Verify ComfyUI is running and report GPU info, latency, and storage provider status. Returns JSON with gpu_name, vram_total, vram_free, latency_ms, and storage status (~300-500 tokens). Call once at session start, or before expensive multi-step pipelines, to confirm the backend is healthy. Unlike ping_comfyui (binary reachable/not), this returns diagnostic details.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "ping_comfyui",
    description:
      "Fast binary check: is ComfyUI reachable? Returns JSON with {reachable: true/false} (~50 tokens). Call before any generation tool if you suspect the server might be down. Sub-second response. Unlike check_connection (full diagnostics with GPU/storage), this is a lightweight ping — use it for quick pre-flight checks.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// Create server
const server = new Server(
  {
    name: "comfyui-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "generate_image": {
        const input = generateImageSchema.parse({
          prompt: args?.prompt,
          negative_prompt: args?.negative_prompt,
          width: args?.width ?? 512,
          height: args?.height ?? 768,
          steps: args?.steps ?? 28,
          cfg_scale: args?.cfg_scale ?? 7,
          sampler: args?.sampler ?? "euler_ancestral",
          scheduler: args?.scheduler ?? "normal",
          model: args?.model,
          seed: args?.seed,
          loras: args?.loras,
          output_path: args?.output_path,
        });

        const result = await generateImage(client, input, COMFYUI_MODEL);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "img2img": {
        const input = img2imgSchema.parse({
          prompt: args?.prompt,
          negative_prompt: args?.negative_prompt,
          input_image: args?.input_image,
          denoise: args?.denoise ?? 0.75,
          steps: args?.steps ?? 28,
          cfg_scale: args?.cfg_scale ?? 7,
          sampler: args?.sampler ?? "euler_ancestral",
          scheduler: args?.scheduler ?? "normal",
          model: args?.model,
          seed: args?.seed,
          loras: args?.loras,
          output_path: args?.output_path,
        });

        const result = await img2img(client, input, COMFYUI_MODEL);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "upscale_image": {
        const input = upscaleSchema.parse({
          input_image: args?.input_image,
          upscale_model: args?.upscale_model ?? "RealESRGAN_x4plus.pth",
          target_width: args?.target_width,
          target_height: args?.target_height,
          output_path: args?.output_path,
        });

        const result = await upscaleImage(client, input);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "list_models": {
        const models = await listModels(client);
        return {
          content: [{ type: "text", text: JSON.stringify({ models }, null, 2) }],
        };
      }

      case "list_loras": {
        const loras = await listLoras(client);
        return {
          content: [{ type: "text", text: JSON.stringify({ loras }, null, 2) }],
        };
      }

      case "list_samplers": {
        const samplers = await listSamplers(client);
        return {
          content: [{ type: "text", text: JSON.stringify({ samplers }, null, 2) }],
        };
      }

      case "list_schedulers": {
        const schedulers = await listSchedulers(client);
        return {
          content: [{ type: "text", text: JSON.stringify({ schedulers }, null, 2) }],
        };
      }

      case "list_upscale_models": {
        const models = await listUpscaleModels(client);
        return {
          content: [{ type: "text", text: JSON.stringify({ upscale_models: models }, null, 2) }],
        };
      }

      case "get_queue_status": {
        const status = await getQueueStatus(client);
        return {
          content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
        };
      }

      case "craft_prompt": {
        const input = craftPromptSchema.parse({
          description: args?.description,
          model_name: args?.model_name,
          model_family: args?.model_family,
          style: args?.style,
          rating: args?.rating ?? "safe",
          aspect_ratio: args?.aspect_ratio,
          camera_focal_length: args?.camera_focal_length,
          camera_aperture: args?.camera_aperture,
          camera_lighting: args?.camera_lighting,
          camera_angle: args?.camera_angle,
          style_keywords: args?.style_keywords,
          emphasize: args?.emphasize,
          include_lora_recommendations: args?.include_lora_recommendations ?? true,
        });

        const result = await craftPrompt(client, input);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "get_prompting_guide": {
        const modelFamily = args?.model_family as any;
        if (!modelFamily) {
          throw new Error("model_family is required");
        }
        const guide = getPromptingGuide(modelFamily);
        return {
          content: [{ type: "text", text: JSON.stringify(guide, null, 2) }],
        };
      }

      case "list_prompting_strategies": {
        const strategies = listPromptingStrategies();
        return {
          content: [{ type: "text", text: JSON.stringify({ strategies }, null, 2) }],
        };
      }

      case "execute_pipeline": {
        const input = executePipelineSchema.parse({
          prompt: args?.prompt,
          negative_prompt: args?.negative_prompt,
          model: args?.model,
          output_path: args?.output_path,
          width: args?.width ?? 768,
          height: args?.height ?? 1024,
          steps: args?.steps ?? 28,
          cfg_scale: args?.cfg_scale ?? 7,
          sampler: args?.sampler ?? "euler_ancestral",
          scheduler: args?.scheduler ?? "normal",
          seed: args?.seed,
          loras: args?.loras,
          enable_hires_fix: args?.enable_hires_fix ?? false,
          hires_scale: args?.hires_scale ?? 1.5,
          hires_denoise: args?.hires_denoise ?? 0.4,
          hires_steps: args?.hires_steps ?? 20,
          enable_upscale: args?.enable_upscale ?? false,
          upscale_model: args?.upscale_model ?? "RealESRGAN_x4plus.pth",
        });

        const result = await executePipeline(client, input, COMFYUI_MODEL);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "imagine": {
        const input = imagineSchema.parse({
          description: args?.description,
          output_path: args?.output_path,
          model: args?.model,
          model_family: args?.model_family,
          style: args?.style,
          artist_reference: args?.artist_reference,
          rating: args?.rating,
          quality: args?.quality ?? "standard",
          width: args?.width,
          height: args?.height,
          steps: args?.steps,
          cfg_scale: args?.cfg_scale,
          sampler: args?.sampler,
          scheduler: args?.scheduler,
          seed: args?.seed,
          loras: args?.loras,
          auto_recommend_loras: args?.auto_recommend_loras ?? false,
          enable_hires_fix: args?.enable_hires_fix,
          hires_scale: args?.hires_scale,
          hires_denoise: args?.hires_denoise,
          hires_steps: args?.hires_steps,
          enable_upscale: args?.enable_upscale,
          upscale_model: args?.upscale_model,
          // Hidden image (QR ControlNet) parameters
          hidden_image: args?.hidden_image,
          convert_to_bw: args?.convert_to_bw,
          bw_threshold: args?.bw_threshold,
          bw_invert: args?.bw_invert,
          visibility: args?.visibility,
        });

        // Get available LoRAs for recommendations
        let availableLoras: string[] | undefined;
        if (args?.auto_recommend_loras) {
          try {
            availableLoras = await listLoras(client);
          } catch {
            // LoRA listing failed, continue without recommendations
          }
        }

        const result = await imagine(client, input, COMFYUI_MODEL, availableLoras);
        return {
          content: [{ type: "text", text: result.message + "\n\n" + JSON.stringify(result, null, 2) }],
        };
      }

      // =====================================================================
      // ControlNet Tools
      // =====================================================================
      case "generate_with_controlnet": {
        const input = generateWithControlNetSchema.parse({
          prompt: args?.prompt,
          negative_prompt: args?.negative_prompt,
          control_image: args?.control_image,
          control_type: args?.control_type,
          controlnet_model: args?.controlnet_model,
          strength: args?.strength,
          start_percent: args?.start_percent ?? 0.0,
          end_percent: args?.end_percent ?? 1.0,
          preprocess: args?.preprocess ?? true,
          preprocessor_options: args?.preprocessor_options,
          width: args?.width ?? 512,
          height: args?.height ?? 768,
          steps: args?.steps ?? 28,
          cfg_scale: args?.cfg_scale ?? 7,
          sampler: args?.sampler ?? "euler_ancestral",
          scheduler: args?.scheduler ?? "normal",
          model: args?.model,
          seed: args?.seed,
          loras: args?.loras,
          output_path: args?.output_path,
        });

        const result = await generateWithControlNet(client, input, COMFYUI_MODEL);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "generate_with_multi_controlnet": {
        const input = generateWithMultiControlNetSchema.parse({
          prompt: args?.prompt,
          negative_prompt: args?.negative_prompt,
          controls: args?.controls,
          preprocess: args?.preprocess ?? true,
          width: args?.width ?? 512,
          height: args?.height ?? 768,
          steps: args?.steps ?? 28,
          cfg_scale: args?.cfg_scale ?? 7,
          sampler: args?.sampler ?? "euler_ancestral",
          scheduler: args?.scheduler ?? "normal",
          model: args?.model,
          seed: args?.seed,
          loras: args?.loras,
          output_path: args?.output_path,
        });

        const result = await generateWithMultiControlNet(client, input, COMFYUI_MODEL);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "preprocess_control_image": {
        const input = preprocessControlImageSchema.parse({
          input_image: args?.input_image,
          control_type: args?.control_type,
          preprocessor_options: args?.preprocessor_options,
          output_path: args?.output_path,
        });

        const result = await preprocessControlImage(client, input);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "generate_with_hidden_image": {
        const input = generateWithHiddenImageSchema.parse({
          prompt: args?.prompt,
          negative_prompt: args?.negative_prompt,
          hidden_image: args?.hidden_image,
          visibility: args?.visibility ?? "subtle",
          width: args?.width ?? 512,
          height: args?.height ?? 768,
          steps: args?.steps ?? 28,
          cfg_scale: args?.cfg_scale ?? 7,
          sampler: args?.sampler ?? "euler_ancestral",
          scheduler: args?.scheduler ?? "normal",
          model: args?.model,
          seed: args?.seed,
          loras: args?.loras,
          output_path: args?.output_path,
        });

        const result = await generateWithHiddenImage(client, input, COMFYUI_MODEL);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "stylize_photo": {
        const input = stylizePhotoSchema.parse({
          source_image: args?.source_image,
          style: args?.style,
          prompt: args?.prompt,
          preserve_detail: args?.preserve_detail ?? "medium",
          width: args?.width,
          height: args?.height,
          steps: args?.steps ?? 28,
          cfg_scale: args?.cfg_scale ?? 7,
          sampler: args?.sampler ?? "euler_ancestral",
          scheduler: args?.scheduler ?? "normal",
          model: args?.model,
          seed: args?.seed,
          loras: args?.loras,
          output_path: args?.output_path,
        });

        const result = await stylizePhoto(client, input, COMFYUI_MODEL);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "generate_with_pose": {
        const input = generateWithPoseSchema.parse({
          prompt: args?.prompt,
          negative_prompt: args?.negative_prompt,
          pose_reference: args?.pose_reference,
          copy_face: args?.copy_face ?? true,
          copy_hands: args?.copy_hands ?? true,
          width: args?.width ?? 512,
          height: args?.height ?? 768,
          steps: args?.steps ?? 28,
          cfg_scale: args?.cfg_scale ?? 7,
          sampler: args?.sampler ?? "euler_ancestral",
          scheduler: args?.scheduler ?? "normal",
          model: args?.model,
          seed: args?.seed,
          loras: args?.loras,
          output_path: args?.output_path,
        });

        const result = await generateWithPose(client, input, COMFYUI_MODEL);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "generate_with_composition": {
        const input = generateWithCompositionSchema.parse({
          prompt: args?.prompt,
          negative_prompt: args?.negative_prompt,
          composition_reference: args?.composition_reference,
          strength: args?.strength ?? 0.7,
          width: args?.width,
          height: args?.height,
          steps: args?.steps ?? 28,
          cfg_scale: args?.cfg_scale ?? 7,
          sampler: args?.sampler ?? "euler_ancestral",
          scheduler: args?.scheduler ?? "normal",
          model: args?.model,
          seed: args?.seed,
          loras: args?.loras,
          output_path: args?.output_path,
        });

        const result = await generateWithComposition(client, input, COMFYUI_MODEL);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "list_controlnet_models": {
        const models = await listControlNetModels(client);
        return {
          content: [{ type: "text", text: JSON.stringify(models, null, 2) }],
        };
      }

      // ====== IP-Adapter Tools ======
      case "generate_with_ipadapter": {
        const input = ipadapterSchema.parse({
          prompt: args?.prompt,
          negative_prompt: args?.negative_prompt,
          reference_image: args?.reference_image,
          reference_images: args?.reference_images,
          weight: args?.weight,
          weight_type: args?.weight_type,
          start_at: args?.start_at,
          end_at: args?.end_at,
          combine_embeds: args?.combine_embeds,
          ipadapter_model: args?.ipadapter_model,
          clip_vision_model: args?.clip_vision_model,
          model: args?.model,
          width: args?.width ?? 512,
          height: args?.height ?? 768,
          steps: args?.steps ?? 28,
          cfg_scale: args?.cfg_scale ?? 7,
          sampler: args?.sampler ?? "euler_ancestral",
          scheduler: args?.scheduler ?? "normal",
          seed: args?.seed,
          loras: args?.loras,
          output_path: args?.output_path,
        });

        const result = await ipadapter(client, input, COMFYUI_MODEL);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      // ====== Inpainting / Outpainting Tools ======
      case "inpaint": {
        const input = inpaintSchema.parse({
          prompt: args?.prompt,
          negative_prompt: args?.negative_prompt,
          source_image: args?.source_image,
          mask_image: args?.mask_image,
          denoise_strength: args?.denoise_strength ?? 0.75,
          model: args?.model,
          steps: args?.steps ?? 28,
          cfg_scale: args?.cfg_scale ?? 7,
          sampler: args?.sampler ?? "euler_ancestral",
          scheduler: args?.scheduler ?? "normal",
          seed: args?.seed,
          loras: args?.loras,
          output_path: args?.output_path,
          upload_to_cloud: args?.upload_to_cloud,
        });

        const result = await inpaint(client, input, COMFYUI_MODEL);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "outpaint": {
        const input = outpaintSchema.parse({
          prompt: args?.prompt,
          negative_prompt: args?.negative_prompt,
          source_image: args?.source_image,
          extend_left: args?.extend_left ?? 0,
          extend_right: args?.extend_right ?? 0,
          extend_top: args?.extend_top ?? 0,
          extend_bottom: args?.extend_bottom ?? 0,
          feathering: args?.feathering ?? 40,
          denoise_strength: args?.denoise_strength ?? 0.8,
          model: args?.model,
          steps: args?.steps ?? 28,
          cfg_scale: args?.cfg_scale ?? 7,
          sampler: args?.sampler ?? "euler_ancestral",
          scheduler: args?.scheduler ?? "normal",
          seed: args?.seed,
          loras: args?.loras,
          output_path: args?.output_path,
          upload_to_cloud: args?.upload_to_cloud,
        });

        const result = await outpaint(client, input, COMFYUI_MODEL);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      // ====== TTS Tools ======
      case "tts_generate": {
        const validatedArgs = ttsGenerateSchema.parse(args);
        const result = await ttsGenerate(validatedArgs, client);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "list_tts_models": {
        const validatedArgs = listTTSModelsSchema.parse(args);
        const result = await listTTSModels(validatedArgs, client);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "list_voices": {
        const validatedArgs = listVoicesSchema.parse(args);
        const result = await listVoices(validatedArgs, client);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      // ====== Lip-Sync Tools ======
      case "lipsync_generate": {
        const validatedArgs = lipSyncGenerateSchema.parse(args);
        const result = await lipSyncGenerate(validatedArgs, client);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "talk": {
        const validatedArgs = talkSchema.parse(args);
        const result = await talk(validatedArgs, client);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "list_lipsync_models": {
        const validatedArgs = listLipSyncModelsSchema.parse(args);
        const result = await listLipSyncModels(validatedArgs, client);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      // ====== Video Generation Tools (AnimateDiff) ======
      case "image_to_video": {
        const validatedArgs = imageToVideoSchema.parse(args);
        const result = await imageToVideo(validatedArgs, client);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "list_animatediff_models": {
        const validatedArgs = listAnimateDiffModelsSchema.parse(args);
        const result = await listAnimateDiffModels(validatedArgs, client);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      // ====== Avatar Management Tools ======
      case "list_avatars": {
        const validatedArgs = listAvatarsSchema.parse(args);
        const result = await listAvatars(validatedArgs, client);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "list_voices_catalog": {
        const validatedArgs = listVoicesCatalogSchema.parse(args);
        const result = await listVoicesCatalog(validatedArgs, client);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "create_portrait": {
        const validatedArgs = createPortraitSchema.parse(args);
        const result = await createPortrait(validatedArgs, client);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "batch_create_portraits": {
        const validatedArgs = batchCreatePortraitsSchema.parse(args);
        const result = await batchCreatePortraits(validatedArgs, client);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "check_connection": {
        const validatedArgs = checkConnectionSchema.parse(args);
        const result = await checkConnection(validatedArgs, client);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "ping_comfyui": {
        const result = await pingComfyUI(client);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  console.error("Starting ComfyUI MCP server...");
  console.error(`  ComfyUI URL: ${COMFYUI_URL}`);
  console.error(`  Default model: ${COMFYUI_MODEL || "(not set)"}`);
  console.error(`  Output dir: ${COMFYUI_OUTPUT_DIR}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ComfyUI MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
