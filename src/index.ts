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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ComfyUI MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
