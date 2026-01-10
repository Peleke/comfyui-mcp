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

// Configuration from environment
const COMFYUI_URL = process.env.COMFYUI_URL || "http://localhost:8188";
const COMFYUI_MODEL = process.env.COMFYUI_MODEL || "";
const COMFYUI_OUTPUT_DIR = process.env.COMFYUI_OUTPUT_DIR || "/tmp/comfyui-output";

// Initialize client
const client = new ComfyUIClient({
  url: COMFYUI_URL,
  outputDir: COMFYUI_OUTPUT_DIR,
});

// Tool definitions
const TOOLS = [
  {
    name: "generate_image",
    description:
      "Generate an image from a text prompt using ComfyUI (txt2img). Supports LoRAs for style customization.",
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
      "Generate an image based on an input image (img2img). Use denoise to control how much the image changes.",
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
    description: "Upscale an image using AI upscaling models (RealESRGAN, etc.)",
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
    description: "List available checkpoint models in ComfyUI",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_loras",
    description: "List available LoRA models in ComfyUI",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_samplers",
    description: "List available samplers in ComfyUI",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_schedulers",
    description: "List available schedulers in ComfyUI",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_upscale_models",
    description: "List available upscale models in ComfyUI",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_queue_status",
    description: "Get the current ComfyUI queue status (running and pending jobs)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "craft_prompt",
    description:
      "Generate an optimized prompt from a natural language description. Auto-detects the best prompting strategy based on the model, or you can specify a model family. Returns the optimized prompt, negative prompt, recommended settings, LoRA recommendations, and suggested pipeline.",
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
    description: "Get detailed prompting tips and an example prompt for a specific model family",
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
    description: "List all supported model families and their prompting strategies",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "execute_pipeline",
    description:
      "Execute a full image generation pipeline: txt2img → (optional) hi-res fix → (optional) upscale. This is the recommended way to generate high-quality images.",
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
      "🎨 The ultimate image generation tool. Takes a natural language description and handles everything: auto-detects model family, crafts optimized prompts, applies quality presets, and executes the full pipeline (txt2img → hi-res fix → upscale). Use this for the best results with minimal configuration.",
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
      "Generate an image guided by a control image (edge detection, depth, pose, etc.). Supports Canny, Depth, OpenPose, QR Code, Scribble, Lineart, and Semantic Segmentation.",
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
      "Generate an image with multiple ControlNet conditions combined (e.g., pose + depth).",
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
      "Run preprocessing on an image to see the control signal (edge detection, pose skeleton, depth map, etc.)",
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
      "Generate an image with a hidden image embedded (like a watermark or secret symbol). Uses QR Code ControlNet.",
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
      "Transform a real photo into an artistic style (anime, oil painting, watercolor, etc.) while preserving composition.",
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
      "Generate a character matching the exact pose from a reference image. Uses OpenPose ControlNet.",
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
      "Generate an image with the same general composition/layout as a reference, but creative freedom in details. Uses Semantic Segmentation ControlNet.",
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
    description: "List available ControlNet models organized by type",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  // ============================================================================
  // TTS Tools
  // ============================================================================
  {
    name: "tts_generate",
    description: "Generate speech from text using F5-TTS with voice cloning. Provide a reference audio to clone the voice.",
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
    description: "List available TTS models (F5-TTS, XTTS)",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_voices",
    description: "List available voice samples for TTS",
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
    description: "Generate a lip-synced video from a portrait image and audio file using SONIC.",
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
    description: "Full pipeline: Text → TTS → Lip-Sync → Video. Generate a talking avatar video from text input.",
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
    description: "List available lip-sync models (SONIC, DICE-Talk, Hallo2, SadTalker)",
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
