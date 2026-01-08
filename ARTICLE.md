# Building an AI Image Generation Bridge: Connecting Claude to ComfyUI with MCP

**Give your AI assistant the power to generate images through your local Stable Diffusion setup.**

Imagine asking your AI coding assistant to "generate a hero image for the landing page" and watching it actually create one. Not a description of an image. Not a suggestion to use a stock photo. An actual, custom image tailored to your project, generated on your local machine using whatever Stable Diffusion model you prefer.

This tutorial shows you how to build that bridge. You'll create a Model Context Protocol (MCP) server that connects Claude (or any MCP-compatible AI) to ComfyUI, the node-based interface for Stable Diffusion. By the end, your AI assistant will be able to generate images, apply style transformations, upscale outputs, and leverage your custom LoRA models—all through natural conversation.

## What You'll Build

The ComfyUI MCP server exposes nine tools that turn your local Stable Diffusion setup into an AI-accessible image generation service:

- **generate_image**: Text-to-image generation with full parameter control
- **img2img**: Transform existing images with AI guidance
- **upscale_image**: Enhance resolution using neural upscaling models
- **list_models**: Discover available checkpoint models
- **list_loras**: Find installed LoRA adapters
- **list_samplers**: View sampling algorithms
- **list_schedulers**: See available noise schedulers
- **list_upscale_models**: Check upscaling model options
- **get_queue_status**: Monitor generation queue

When integrated with Claude Code or another MCP client, you can make requests like:

```
"Generate a cyberpunk cityscape at sunset, 1024x768, using the
anime-style LoRA, and save it to ./assets/hero.png"
```

The AI handles the translation to ComfyUI's workflow format, queues the job, monitors progress, and delivers the result.

## Prerequisites

Before starting, ensure you have:

- **Node.js 18+** installed
- **ComfyUI** running locally (default: http://localhost:8188)
- At least one **Stable Diffusion checkpoint** model installed
- Basic familiarity with TypeScript and async programming

This tutorial assumes ComfyUI is already set up with models. If you need help with ComfyUI installation, see the [official documentation](https://github.com/comfyanonymous/ComfyUI).

## Understanding the Architecture

### What is MCP?

The Model Context Protocol is Anthropic's open standard for connecting AI assistants to external tools and data sources. Think of it as a USB-C port for AI—a standardized interface that lets any compatible AI communicate with any compatible service.

MCP servers expose **tools** (functions the AI can call) and **resources** (data the AI can read). The AI client discovers available capabilities, then invokes them as needed to accomplish tasks.

### Why ComfyUI?

ComfyUI represents Stable Diffusion workflows as JSON graphs. Each node in the graph performs an operation—loading a model, encoding text, sampling latents, decoding images. Nodes connect via typed inputs and outputs.

This graph structure is perfect for programmatic control. Rather than stitching together CLI commands or wrestling with Python scripts, you can construct workflows as data and submit them to ComfyUI's REST API.

### The Integration Pattern

Our MCP server sits between the AI assistant and ComfyUI:

```
┌─────────────┐     MCP Protocol    ┌─────────────┐     REST/WS     ┌──────────┐
│   Claude    │ ◄─────────────────► │  MCP Server │ ◄─────────────► │ ComfyUI  │
│   (Client)  │    Tool Calls       │  (Bridge)   │   Workflows     │  (API)   │
└─────────────┘                     └─────────────┘                 └──────────┘
```

The MCP server:
1. Advertises available tools to the AI client
2. Receives tool calls with parameters
3. Builds ComfyUI workflow JSON
4. Submits workflows and monitors execution
5. Retrieves generated images
6. Returns results to the AI

## Project Structure

Create a new directory and initialize the project:

```bash
mkdir comfyui-mcp
cd comfyui-mcp
npm init -y
```

The final structure looks like this:

```
comfyui-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── comfyui-client.ts     # ComfyUI API client
│   ├── workflows/
│   │   ├── txt2img.json      # Text-to-image template
│   │   ├── img2img.json      # Image-to-image template
│   │   ├── upscale.json      # Upscaling template
│   │   └── builder.ts        # Workflow parameterization
│   └── tools/
│       ├── generate.ts       # Generation tools
│       ├── upscale.ts        # Upscaling tools
│       ├── list-models.ts    # Discovery tools
│       └── queue-status.ts   # Status tools
└── README.md
```

## Step 1: Project Configuration

Create `package.json`:

```json
{
  "name": "comfyui-mcp",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/ws": "^8.5.13",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0"
  }
}
```

And `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

Install dependencies:

```bash
npm install
```

## Step 2: Building the ComfyUI Client

The client handles all communication with ComfyUI's API. Create `src/comfyui-client.ts`:

```typescript
import WebSocket from "ws";

export interface ComfyUIConfig {
  url: string;
  outputDir?: string;
}

export class ComfyUIClient {
  private baseUrl: string;
  private wsUrl: string;

  constructor(config: ComfyUIConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.wsUrl = this.baseUrl.replace(/^http/, "ws");
  }

  async queuePrompt(workflow: any): Promise<{ prompt_id: string }> {
    const response = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!response.ok) {
      throw new Error(`Failed to queue prompt: ${response.status}`);
    }

    return response.json();
  }

  async waitForCompletion(promptId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.wsUrl}/ws`);

      ws.on("message", async (data) => {
        const message = JSON.parse(data.toString());

        if (message.type === "executing" &&
            message.data.prompt_id === promptId &&
            message.data.node === null) {
          ws.close();
          const history = await this.getHistory(promptId);
          resolve(history);
        }
      });

      ws.on("error", reject);
    });
  }

  async getHistory(promptId: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/history/${promptId}`);
    const data = await response.json();
    return data[promptId];
  }

  async getImage(filename: string, subfolder: string, type: string): Promise<Buffer> {
    const params = new URLSearchParams({ filename, subfolder, type });
    const response = await fetch(`${this.baseUrl}/view?${params}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async getObjectInfo(): Promise<Record<string, any>> {
    const response = await fetch(`${this.baseUrl}/object_info`);
    return response.json();
  }

  async getModels(): Promise<string[]> {
    const info = await this.getObjectInfo();
    return info["CheckpointLoaderSimple"]?.input?.required?.ckpt_name?.[0] || [];
  }

  async getSamplers(): Promise<string[]> {
    const info = await this.getObjectInfo();
    return info["KSampler"]?.input?.required?.sampler_name?.[0] || [];
  }
}
```

Key implementation details:

- **REST API**: ComfyUI exposes endpoints for queueing prompts (`POST /prompt`), fetching history (`GET /history/{id}`), and retrieving images (`GET /view`).

- **WebSocket monitoring**: After queueing a workflow, we connect to ComfyUI's WebSocket endpoint to receive real-time progress updates. When we see an `executing` message with `node: null`, the workflow has completed.

- **Object introspection**: The `/object_info` endpoint returns metadata about all available nodes, including valid parameter values. This powers our model and sampler discovery tools.

## Step 3: Creating Workflow Templates

ComfyUI workflows are JSON objects where keys are node IDs and values describe each node's type and inputs. Create the base text-to-image template at `src/workflows/txt2img.json`:

```json
{
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "cfg": 7,
      "denoise": 1,
      "latent_image": ["5", 0],
      "model": ["4", 0],
      "negative": ["7", 0],
      "positive": ["6", 0],
      "sampler_name": "euler_ancestral",
      "scheduler": "normal",
      "seed": 0,
      "steps": 28
    }
  },
  "4": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": {
      "ckpt_name": "model.safetensors"
    }
  },
  "5": {
    "class_type": "EmptyLatentImage",
    "inputs": {
      "batch_size": 1,
      "height": 768,
      "width": 512
    }
  },
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "clip": ["4", 1],
      "text": "a beautiful landscape"
    }
  },
  "7": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "clip": ["4", 1],
      "text": "bad quality, blurry"
    }
  },
  "8": {
    "class_type": "VAEDecode",
    "inputs": {
      "samples": ["3", 0],
      "vae": ["4", 2]
    }
  },
  "9": {
    "class_type": "SaveImage",
    "inputs": {
      "filename_prefix": "ComfyUI_MCP",
      "images": ["8", 0]
    }
  }
}
```

Understanding the node graph:

1. **CheckpointLoaderSimple** (node 4): Loads the base model, outputting model, CLIP, and VAE
2. **EmptyLatentImage** (node 5): Creates a blank latent at target dimensions
3. **CLIPTextEncode** (nodes 6, 7): Converts prompts to CLIP embeddings
4. **KSampler** (node 3): The diffusion sampling process
5. **VAEDecode** (node 8): Converts latents to pixel space
6. **SaveImage** (node 9): Writes the result

Connections use the format `["node_id", output_index]`. For example, `["4", 1]` means "output index 1 from node 4"—the CLIP encoder from the checkpoint loader.

## Step 4: Workflow Builder with LoRA Support

The workflow builder transforms user parameters into complete ComfyUI graphs. Create `src/workflows/builder.ts`:

```typescript
import baseTxt2ImgWorkflow from "./txt2img.json" with { type: "json" };

export interface LoraConfig {
  name: string;
  strength_model?: number;
  strength_clip?: number;
}

export interface Txt2ImgParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  sampler?: string;
  scheduler?: string;
  model: string;
  seed?: number;
  loras?: LoraConfig[];
}

function injectLoras(
  workflow: Record<string, any>,
  loras: LoraConfig[],
  checkpointNodeId: string,
  modelConsumerNodeId: string,
  clipConsumerNodeIds: string[]
): Record<string, any> {
  if (!loras?.length) return workflow;

  let currentModelSource: [string, number] = [checkpointNodeId, 0];
  let currentClipSource: [string, number] = [checkpointNodeId, 1];

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

    currentModelSource = [loraNodeId, 0];
    currentClipSource = [loraNodeId, 1];
  });

  // Rewire consumers to use final LoRA outputs
  workflow[modelConsumerNodeId].inputs.model = currentModelSource;
  clipConsumerNodeIds.forEach((id) => {
    workflow[id].inputs.clip = currentClipSource;
  });

  return workflow;
}

export function buildTxt2ImgWorkflow(params: Txt2ImgParams): Record<string, any> {
  let workflow = JSON.parse(JSON.stringify(baseTxt2ImgWorkflow));

  workflow["4"].inputs.ckpt_name = params.model;
  workflow["6"].inputs.text = params.prompt;
  workflow["7"].inputs.text = params.negativePrompt || "bad quality, blurry";
  workflow["5"].inputs.width = params.width || 512;
  workflow["5"].inputs.height = params.height || 768;
  workflow["3"].inputs.steps = params.steps || 28;
  workflow["3"].inputs.cfg = params.cfgScale || 7;
  workflow["3"].inputs.sampler_name = params.sampler || "euler_ancestral";
  workflow["3"].inputs.scheduler = params.scheduler || "normal";
  workflow["3"].inputs.seed = params.seed ?? Math.floor(Math.random() * 2147483647);

  if (params.loras?.length) {
    workflow = injectLoras(workflow, params.loras, "4", "3", ["6", "7"]);
  }

  return workflow;
}
```

The LoRA injection is worth examining. LoRAs are chained between the checkpoint loader and consumers. Each LoraLoader takes model and CLIP inputs and produces modified outputs. By dynamically inserting nodes and rewiring connections, we support arbitrary numbers of stacked LoRAs.

## Step 5: The MCP Server

The server entry point registers tools and handles requests. Create `src/index.ts`:

```typescript
#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { ComfyUIClient } from "./comfyui-client.js";
import { buildTxt2ImgWorkflow } from "./workflows/builder.js";

const COMFYUI_URL = process.env.COMFYUI_URL || "http://localhost:8188";
const COMFYUI_MODEL = process.env.COMFYUI_MODEL || "";

const client = new ComfyUIClient({ url: COMFYUI_URL });

const TOOLS = [
  {
    name: "generate_image",
    description: "Generate an image from a text prompt using Stable Diffusion",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to generate" },
        negative_prompt: { type: "string", description: "What to avoid" },
        width: { type: "number", default: 512 },
        height: { type: "number", default: 768 },
        steps: { type: "number", default: 28 },
        cfg_scale: { type: "number", default: 7 },
        sampler: { type: "string", default: "euler_ancestral" },
        model: { type: "string", description: "Checkpoint model name" },
        loras: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              strength_model: { type: "number" },
              strength_clip: { type: "number" },
            },
          },
        },
        output_path: { type: "string", description: "Where to save the image" },
      },
      required: ["prompt", "output_path"],
    },
  },
  // ... additional tools
];

const server = new Server(
  { name: "comfyui-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "generate_image") {
    const workflow = buildTxt2ImgWorkflow({
      prompt: args.prompt,
      negativePrompt: args.negative_prompt,
      width: args.width || 512,
      height: args.height || 768,
      steps: args.steps || 28,
      cfgScale: args.cfg_scale || 7,
      sampler: args.sampler || "euler_ancestral",
      model: args.model || COMFYUI_MODEL,
      seed: args.seed,
      loras: args.loras,
    });

    const { prompt_id } = await client.queuePrompt(workflow);
    const history = await client.waitForCompletion(prompt_id);

    // Extract and save the image
    const imageInfo = history.outputs["9"].images[0];
    const imageBuffer = await client.getImage(
      imageInfo.filename,
      imageInfo.subfolder,
      imageInfo.type
    );

    const fs = await import("fs/promises");
    await fs.mkdir(dirname(args.output_path), { recursive: true });
    await fs.writeFile(args.output_path, imageBuffer);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, path: args.output_path }),
      }],
    };
  }

  // ... handle other tools
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();
```

The MCP SDK handles protocol communication over stdio. When Claude Code launches our server, they exchange JSON-RPC messages through stdin/stdout. The SDK abstracts this into a simple request handler pattern.

## Step 6: Configuring Claude Code

To enable the server in Claude Code, add it to your MCP settings. Create or edit `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "comfyui": {
      "command": "npx",
      "args": ["tsx", "/path/to/comfyui-mcp/src/index.ts"],
      "env": {
        "COMFYUI_URL": "http://localhost:8188",
        "COMFYUI_MODEL": "dreamshaper_8.safetensors"
      }
    }
  }
}
```

Replace `/path/to/comfyui-mcp` with your actual project path and `dreamshaper_8.safetensors` with your preferred default model.

After saving, restart Claude Code. You should see the ComfyUI tools in the available tools list.

## Using the Integration

With everything configured, you can now generate images through conversation:

### Basic Generation

```
"Generate an image of a mountain lake at sunrise and save it to ./images/lake.png"
```

Claude will call:
```typescript
generate_image({
  prompt: "mountain lake at sunrise, scenic, beautiful lighting",
  negative_prompt: "bad quality, blurry",
  output_path: "./images/lake.png"
})
```

### With Style LoRAs

```
"Create a portrait in anime style using the animeStyle.safetensors LoRA at 0.8 strength"
```

```typescript
generate_image({
  prompt: "portrait of a young woman, detailed face",
  loras: [{ name: "animeStyle.safetensors", strength_model: 0.8 }],
  output_path: "./images/portrait.png"
})
```

### Image-to-Image Transformation

```
"Take the sketch in input/sketch.png and turn it into a finished illustration"
```

```typescript
img2img({
  prompt: "detailed digital illustration, vibrant colors",
  input_image: "sketch.png",
  denoise: 0.7,
  output_path: "./images/illustration.png"
})
```

### Upscaling

```
"Upscale the hero image to 4K resolution"
```

```typescript
upscale_image({
  input_image: "hero.png",
  upscale_model: "RealESRGAN_x4plus.pth",
  output_path: "./images/hero_4k.png"
})
```

## Practical Applications

This integration opens several workflows:

**Asset Generation**: During development, generate placeholder images, icons, or textures without leaving your editor. "Create a 64x64 pixel art potion sprite for the inventory system."

**Rapid Prototyping**: Mock up UI designs with generated hero images, avatars, or backgrounds before commissioning final artwork.

**Documentation**: Generate diagrams, conceptual illustrations, or example images for technical documentation.

**Testing**: Create varied test images programmatically. Need 50 different face images to test your recognition system? Generate them with controlled variation.

## Extending the Server

The foundation supports additional capabilities:

**ControlNet**: Add conditioning images for pose, depth, or edge guidance. Extend the workflow builder to inject ControlNet preprocessor and apply nodes.

**Batch Generation**: Queue multiple prompts and return an array of output paths. Useful for generating variations or iterating on concepts.

**Inpainting**: Mask regions for selective regeneration. Requires additional workflow nodes for mask handling.

**Video**: ComfyUI supports AnimateDiff and SVD for video generation. The same workflow-as-JSON pattern applies.

## Troubleshooting

**"Connection refused"**: Ensure ComfyUI is running. Check the configured URL matches your setup.

**"Model not found"**: Run `list_models` to see available checkpoints. Names must match exactly, including the file extension.

**"No image in output"**: The workflow may have failed. Check ComfyUI's web interface for error messages on the queued prompt.

**Slow generation**: Generation time depends on your hardware, model size, and step count. Consider reducing steps for drafts.

## Conclusion

Bridging AI assistants to local image generation creates a powerful creative tool. The MCP architecture ensures clean separation—your AI assistant handles intent and conversation, the MCP server handles translation and execution, and ComfyUI handles the actual generation.

This pattern extends beyond image generation. Any complex tool with an API can be wrapped in an MCP server, making it conversationally accessible. The key insight is that AI assistants excel at understanding intent and translating between human language and structured parameters—exactly what's needed to make sophisticated tools accessible.

The complete source code for this project is available on GitHub. Fork it, extend it, and make your AI assistant a creative collaborator.

---

*Ready to dive deeper? The companion article covers advanced ComfyUI workflows, custom nodes, and optimization techniques for production deployment.*
