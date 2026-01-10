# I Gave Claude the Ability to Generate Images. Here's How.

*Building an MCP server that turns your local Stable Diffusion setup into an AI-powered image generation system*

---

Last month I got tired of context-switching. Every time I needed an image for a project—a hero graphic, a placeholder, an icon concept—I'd leave my editor, open ComfyUI, fiddle with prompts for twenty minutes, download the result, then try to remember what I was doing before.

So I built a bridge. Now I type "generate a cyberpunk cityscape and save it to ./assets/hero.png" in my terminal, and Claude does the rest. No tab switching. No prompt engineering. No workflow debugging.

The whole thing runs locally. My GPU, my models, my data.

This article walks through how I built it, including a prompt engineering system that actually understands different model architectures. By the end, you'll have everything you need to build your own.

---

## The Architecture (30 Seconds Version)

```
┌─────────────┐     MCP Protocol    ┌─────────────┐     REST/WS     ┌──────────┐
│   Claude    │ ◄─────────────────► │  MCP Server │ ◄─────────────► │ ComfyUI  │
│             │    stdio + JSON     │   (Node)    │   Workflows     │  (Local) │
└─────────────┘                     └─────────────┘                 └──────────┘
```

MCP (Model Context Protocol) is Anthropic's spec for connecting AI assistants to external tools. You write a server that exposes "tools" with schemas, and Claude can call them during conversations. The protocol handles discovery, invocation, and result passing.

ComfyUI exposes a REST API. You POST a workflow (a JSON graph of nodes), it queues the job, and you poll or websocket for completion. When done, you fetch the output image.

The MCP server sits in the middle, translating "generate an image of X" into the specific workflow JSON that ComfyUI needs.

---

## Part 1: The Basics

### Setting Up the MCP Server

The MCP SDK gives you primitives for building servers. Here's the skeleton:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
  { name: "comfyui-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Register tool handlers here

const transport = new StdioServerTransport();
await server.connect(transport);
```

The server communicates via stdio—Claude spawns it as a subprocess and sends JSON-RPC messages over stdin/stdout. This is simpler than HTTP for local tools and avoids port management headaches.

### Defining a Tool

Tools need a name, description, and JSON Schema for their inputs:

```typescript
const TOOLS = [
  {
    name: "generate_image",
    description: "Generate an image from a text prompt using Stable Diffusion",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to generate" },
        output_path: { type: "string", description: "Where to save it" },
        width: { type: "number", default: 512 },
        height: { type: "number", default: 768 },
        // ... more params
      },
      required: ["prompt", "output_path"]
    }
  }
];
```

Claude sees this schema and can construct valid calls. The description matters—it's how the model decides when to use your tool.

### Talking to ComfyUI

ComfyUI's API is workflow-based. You don't say "generate an image with these settings." You submit a graph of connected nodes:

```
CheckpointLoader → CLIP Text Encode → KSampler → VAE Decode → Save Image
                          ↓
              Empty Latent Image ──────────┘
```

Each node has an ID and inputs that reference other nodes by ID. Here's a minimal txt2img workflow:

```json
{
  "4": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": { "ckpt_name": "dreamshaper_8.safetensors" }
  },
  "6": {
    "class_type": "CLIPTextEncode",
    "inputs": {
      "text": "a sunset over mountains",
      "clip": ["4", 1]  // output 1 from node 4
    }
  },
  "3": {
    "class_type": "KSampler",
    "inputs": {
      "model": ["4", 0],
      "positive": ["6", 0],
      "latent_image": ["5", 0],
      "seed": 42,
      "steps": 28,
      "cfg": 7,
      "sampler_name": "euler_ancestral",
      "scheduler": "normal"
    }
  },
  // ... more nodes
}
```

You POST this to `/prompt`, get back a prompt_id, then poll `/history/{prompt_id}` until it's done. The response includes output filenames, which you fetch from `/view?filename=...`.

I wrapped all this in a `ComfyUIClient` class:

```typescript
class ComfyUIClient {
  async queuePrompt(workflow: object): Promise<{ prompt_id: string }> {
    const res = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow })
    });
    return res.json();
  }

  async waitForCompletion(promptId: string): Promise<HistoryEntry> {
    // Poll /history until status shows completion
    // Or use websocket for real-time updates
  }

  async getImage(filename: string): Promise<Buffer> {
    const res = await fetch(`${this.baseUrl}/view?filename=${filename}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
```

### Wiring It Together

When Claude calls `generate_image`, my handler:

1. Validates the input with Zod
2. Builds a workflow JSON with the requested parameters
3. Queues it in ComfyUI
4. Waits for completion
5. Downloads the image
6. Saves it to the requested path
7. Returns success/failure to Claude

```typescript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "generate_image") {
    const input = generateImageSchema.parse(request.params.arguments);

    const workflow = buildTxt2ImgWorkflow({
      prompt: input.prompt,
      width: input.width,
      // ...
    });

    const { prompt_id } = await client.queuePrompt(workflow);
    const history = await client.waitForCompletion(prompt_id);

    const imageInfo = history.outputs["9"].images[0];
    const buffer = await client.getImage(imageInfo.filename);
    await writeFile(input.output_path, buffer);

    return {
      content: [{ type: "text", text: `Saved to ${input.output_path}` }]
    };
  }
});
```

At this point I had a working system. I could tell Claude to generate images and it would. But the prompts sucked.

---

## Part 2: The Prompting Problem

Here's what I typed:

> "Generate an anime girl with blue hair"

Here's what Claude sent to ComfyUI:

> "an anime girl with blue hair"

And here's what you actually need for Illustrious XL:

> "masterpiece, best quality, absurdres, 1girl, blue hair, looking at viewer, upper body, simple background"

Different models want different prompts. Pony Diffusion needs score tags. Flux doesn't use negative prompts at all. Realistic models want camera terminology.

I was about to give up and just document "write better prompts" when I realized: the MCP server knows which model is loaded. Why not optimize prompts automatically?

### Model Detection

First problem: figure out what model family you're dealing with. Checkpoint filenames follow loose conventions:

```typescript
function detectModelFamily(modelName: string): ModelFamily {
  const name = modelName.toLowerCase();

  if (name.includes("flux")) return "flux";
  if (name.includes("pony") || name.includes("pdxl")) return "pony";
  if (name.includes("illustrious") || name.includes("noobai")) return "illustrious";
  if (name.includes("cyber") || name.includes("realistic") ||
      name.includes("photo")) return "realistic";
  if (name.includes("xl") || name.includes("sdxl")) return "sdxl";
  if (name.includes("v1-5") || name.includes("sd15")) return "sd15";

  return "sdxl"; // safe default
}
```

This catches most cases. When it doesn't, users can specify `model_family` explicitly.

### Strategy Pattern for Prompts

Each model family has different prompting needs:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Prompt Generator                             │
│                                                                     │
│   ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐      │
│   │Illustrious│  │   Pony    │  │   Flux    │  │ Realistic │      │
│   │ Strategy  │  │ Strategy  │  │ Strategy  │  │ Strategy  │      │
│   └───────────┘  └───────────┘  └───────────┘  └───────────┘      │
│        │              │              │              │              │
│        ▼              ▼              ▼              ▼              │
│   Tag-based      Score tags     Natural lang   Camera terms       │
│   + quality      + source       No negatives   + photo markers    │
│   boosters       + rating                                          │
└─────────────────────────────────────────────────────────────────────┘
```

I used a strategy pattern. Base class defines the interface:

```typescript
abstract class PromptStrategy {
  abstract buildPositive(request: PromptRequest): string;
  abstract buildNegative(request: PromptRequest): string;
  abstract getRecommendedSettings(): GenerationSettings;
}
```

Then concrete implementations for each family. Here's Illustrious:

```typescript
class IllustriousStrategy extends PromptStrategy {
  buildPositive(request: PromptRequest): string {
    const parts = [
      "masterpiece", "best quality", "absurdres", "newest"
    ];

    if (request.style === "anime") {
      parts.push("anime", "anime style");
    }

    parts.push(request.description);

    return parts.join(", ");
  }

  buildNegative(): string {
    return "lowres, (bad), bad anatomy, bad hands, extra digits, " +
           "missing fingers, cropped, worst quality, low quality, " +
           "normal quality, watermark, signature";
  }

  getRecommendedSettings() {
    return {
      steps: 28,
      cfgScale: 7,
      sampler: "euler_ancestral",
      scheduler: "normal",
      width: 832,
      height: 1216
    };
  }
}
```

Pony is different—it uses score tags and source markers:

```typescript
class PonyStrategy extends PromptStrategy {
  buildPositive(request: PromptRequest): string {
    const parts = [
      "score_9", "score_8_up", "score_7_up", "score_6_up",
      "score_5_up", "score_4_up"
    ];

    // Source based on style
    if (request.style === "anime") {
      parts.push("source_anime");
    } else if (request.style === "realistic_photo") {
      parts.push("source_pony");  // yes, really
    }

    // Rating
    parts.push(`rating_${request.rating || "safe"}`);

    parts.push(request.description);

    return parts.join(", ");
  }
  // ...
}
```

And Flux is special—it works best with natural language and explicitly ignores negative prompts:

```typescript
class FluxStrategy extends PromptStrategy {
  buildPositive(request: PromptRequest): string {
    // Just return the description, maybe with style context
    let prompt = request.description;

    if (request.style === "cinematic") {
      prompt += ", cinematic shot, dramatic lighting";
    }

    return prompt;  // No tags, no booru-style
  }

  buildNegative(): string {
    return "";  // Flux ignores this anyway
  }

  getRecommendedSettings() {
    return {
      steps: 8,      // Flux is fast
      cfgScale: 3.5, // Much lower than other models
      sampler: "euler",
      scheduler: "simple"
    };
  }
}
```

### The Generator

A `PromptGenerator` class ties it together:

```typescript
class PromptGenerator {
  private strategies: Map<ModelFamily, PromptStrategy>;

  constructor() {
    this.strategies = new Map([
      ["illustrious", new IllustriousStrategy()],
      ["pony", new PonyStrategy()],
      ["flux", new FluxStrategy()],
      ["sdxl", new SDXLStrategy()],
      ["realistic", new RealisticStrategy()],
      ["sd15", new SD15Strategy()]
    ]);
  }

  generate(request: PromptRequest): GeneratedPrompt {
    const family = request.modelFamily ||
                   detectModelFamily(request.modelName || "").family;

    const strategy = this.strategies.get(family)!;

    return {
      positive: strategy.buildPositive(request),
      negative: strategy.buildNegative(request),
      modelFamily: family,
      recommendedSettings: strategy.getRecommendedSettings(),
      explanation: `Using ${family} strategy...`
    };
  }
}
```

Now "an anime girl with blue hair" becomes the right prompt for whatever model you're using.

---

## Part 3: The Pipeline

Good Stable Diffusion outputs often involve multiple passes:

1. **txt2img**: Generate base image
2. **Hi-res fix**: Upscale and refine with img2img at low denoise
3. **Upscale**: Final AI upscaling for crisp output

Doing this manually means three tool calls and juggling intermediate files. I wanted one command.

### Pipeline Design

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   txt2img   │ ──► │  hires_fix  │ ──► │   upscale   │
│             │     │  (img2img)  │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
      ▼                   ▼                   ▼
   [buffer]            [buffer]           [final.png]
```

The pipeline executor:

```typescript
async function executePipeline(
  client: ComfyUIClient,
  input: PipelineInput
): Promise<PipelineResult> {
  let currentBuffer: Buffer;
  const steps: StepResult[] = [];

  // Step 1: txt2img (always)
  const txt2imgWorkflow = buildTxt2ImgWorkflow({ ... });
  const { prompt_id } = await client.queuePrompt(txt2imgWorkflow);
  const history = await client.waitForCompletion(prompt_id);
  currentBuffer = await client.getImage(history.outputs["9"].images[0].filename);
  steps.push({ name: "txt2img", success: true });

  // Step 2: Hi-res fix (optional)
  if (input.enable_hires_fix) {
    // Upload current result to ComfyUI input folder
    const uploadedName = await uploadToComfyUI(client, currentBuffer);

    const img2imgWorkflow = buildImg2ImgWorkflow({
      inputImage: uploadedName,
      denoise: input.hires_denoise,  // 0.3-0.5 works well
      // ...
    });

    const { prompt_id: id2 } = await client.queuePrompt(img2imgWorkflow);
    const history2 = await client.waitForCompletion(id2);
    currentBuffer = await client.getImage(history2.outputs["9"].images[0].filename);
    steps.push({ name: "hires_fix", success: true });
  }

  // Step 3: Upscale (optional)
  if (input.enable_upscale) {
    const uploadedName = await uploadToComfyUI(client, currentBuffer);

    const upscaleWorkflow = buildUpscaleWorkflow({
      inputImage: uploadedName,
      model: "RealESRGAN_x4plus.pth"
    });

    // ... queue, wait, download
    steps.push({ name: "upscale", success: true });
  }

  // Save final result
  await writeFile(input.output_path, currentBuffer);

  return {
    success: true,
    finalPath: input.output_path,
    steps
  };
}
```

The `uploadToComfyUI` function handles shuttling images between pipeline stages. ComfyUI needs images in its input folder to use them in workflows, so each step uploads its output for the next step to consume.

### Quality Presets

Rather than expose all the pipeline knobs, I added presets:

| Preset | Pipeline | Use Case |
|--------|----------|----------|
| `draft` | txt2img only | Quick iterations, testing |
| `standard` | txt2img | Normal generation |
| `high` | txt2img → hires_fix | Detailed work, portraits |
| `ultra` | txt2img → hires_fix → upscale | Final production assets |

The mapping:

```typescript
function getPresetSettings(quality: Quality, modelFamily: ModelFamily) {
  const baseSteps = {
    flux: { draft: 4, standard: 8, high: 15, ultra: 20 },
    sdxl: { draft: 15, standard: 28, high: 40, ultra: 50 },
    // ...
  };

  return {
    steps: baseSteps[modelFamily][quality],
    enableHiresFix: quality === "high" || quality === "ultra",
    enableUpscale: quality === "ultra",
    hiresDenoise: quality === "ultra" ? 0.35 : 0.4
  };
}
```

---

## Part 4: The Imagine Tool

Everything comes together in `imagine`—the tool I actually use day-to-day:

```typescript
async function imagine(
  client: ComfyUIClient,
  input: ImagineInput,
  defaultModel: string
): Promise<ImagineResult> {
  // 1. Determine model
  const model = input.model || defaultModel;

  // 2. Detect or use explicit model family
  const modelFamily = input.model_family ||
                      detectModelFamily(model).family;

  // 3. Generate optimized prompt
  const generator = new PromptGenerator();
  const generated = generator.generate({
    description: input.description,
    modelFamily,
    style: input.style,
    rating: input.rating
  });

  // 4. Apply quality preset
  const settings = getPresetSettings(input.quality, modelFamily);

  // 5. Execute pipeline
  const result = await executePipeline(client, {
    prompt: generated.positive,
    negative_prompt: generated.negative,
    model,
    output_path: input.output_path,
    ...settings,
    ...generated.recommendedSettings
  });

  return {
    success: result.success,
    imagePath: result.finalPath,
    prompt: generated,
    pipelineSteps: result.steps.map(s => s.name)
  };
}
```

Now I can say:

```
imagine({
  description: "A cozy coffee shop with warm lighting",
  output_path: "./assets/coffee.png",
  style: "cinematic",
  quality: "high"
})
```

And get a properly-prompted, hi-res-fixed image without thinking about score tags or CFG values.

---

## Testing

I wrote 148 tests covering:

- **Client**: Connection handling, workflow submission, image retrieval
- **Workflow builder**: Correct node wiring, LoRA injection
- **Prompting**: Each strategy produces expected output
- **Model detection**: Pattern matching works for common model names
- **Pipeline**: Multi-step execution, error recovery
- **Imagine**: End-to-end flow

The tricky part was mocking ComfyUI. I created a `createMockFetch` that returns appropriate responses for each endpoint:

```typescript
function createMockFetch() {
  return vi.fn().mockImplementation(async (url, init) => {
    const urlStr = url.toString();

    if (urlStr.includes("/prompt")) {
      return Response.json({ prompt_id: "test-id", number: 1 });
    }

    if (urlStr.includes("/history")) {
      return Response.json({
        "test-id": {
          status: { completed: true },
          outputs: { "9": { images: [{ filename: "out.png" }] } }
        }
      });
    }

    if (urlStr.includes("/view")) {
      return new Response(new Uint8Array([/* PNG bytes */]));
    }

    // ... other endpoints
  });
}
```

---

## Deployment Options

### Local

Just configure Claude Code to spawn the server:

```json
{
  "mcpServers": {
    "comfyui": {
      "command": "node",
      "args": ["/path/to/comfyui-mcp/dist/index.js"],
      "env": {
        "COMFYUI_URL": "http://localhost:8188",
        "COMFYUI_MODEL": "dreamshaper_8.safetensors"
      }
    }
  }
}
```

### Remote GPU

For laptop users without a GPU, you can run ComfyUI on a cloud instance (RunPod, Vast.ai, etc.) and point the MCP server at it:

```
COMFYUI_URL=https://your-runpod-instance.com
```

The MCP server still runs locally—only the actual generation happens remotely. This keeps the protocol local while offloading compute.

---

## What I Learned

**Workflows are graphs, not configs.** ComfyUI's API reflects its node-based UI. You're not setting parameters on a generation endpoint—you're building a computation graph. This is powerful but verbose. The MCP server abstracts it into something Claude can work with.

**Prompting is model-dependent.** The same description produces wildly different results depending on how you format it. Tag-based prompts work great for anime models. Natural language works for Flux. "Best practices" are model-specific.

**Multi-step pipelines matter.** Single-pass generation rarely produces the best results. Hi-res fix is almost always worth the extra time for anything you'll actually use.

**MCP is simple.** The protocol is JSON-RPC over stdio. Define tools with schemas, handle calls, return results. The SDK handles the wire format. I spent way more time on ComfyUI integration than MCP plumbing.

---

## What's Next

A few things I want to add:

- **ControlNet support**: Use reference images for composition
- **Inpainting**: Edit specific regions of images
- **Batch generation**: Multiple variations from one prompt
- **Vision integration**: "Make something like this image"

But honestly? The current version handles 90% of my needs. I'm generating images without leaving my editor, and they come out looking right for whatever model I'm using.

The code is at [github link]. Install, configure, and tell Claude to imagine something.

---

## Appendix: Image Prompts for Illustrations

*For publication, here are prompts to generate supporting images:*

**Hero image (cyberpunk dev at terminal):**
```
A software developer at a terminal in a cyberpunk setting, multiple
monitors showing code and AI-generated artwork, neon lighting,
detailed environment, cinematic composition, 8K
```

**Architecture diagram style:**
```
Clean technical diagram on dark background, node-based workflow
visualization, connecting lines between boxes, modern flat design,
minimal, professional documentation style
```

**Before/after prompt comparison:**
```
Split image comparison, left side showing simple sketch, right side
showing refined artwork, transformation visualization, clean
presentation
```

**Pipeline visualization:**
```
Three connected stages visualization: rough sketch transforms to
detailed image transforms to high resolution output, arrows showing
flow, technical diagram style
```
