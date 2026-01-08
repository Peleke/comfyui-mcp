# ComfyUI MCP Server

**Give your AI assistant the power to generate images through your local Stable Diffusion setup.**

An MCP (Model Context Protocol) server that connects Claude Code (or any MCP-compatible AI) to ComfyUI for local image generation. Generate images, apply style transfers, upscale outputs, and leverage custom LoRA models—all through natural conversation.

```
You: "Generate a cyberpunk cityscape at sunset and save it to ./assets/hero.png"

Claude: I'll generate that image for you.
        [Calls generate_image with prompt, saves to ./assets/hero.png]
        Done! The cyberpunk cityscape has been saved to ./assets/hero.png
```

## Features

- **Text-to-Image**: Generate images from text prompts with full parameter control
- **Image-to-Image**: Transform existing images with AI guidance
- **AI Upscaling**: Enhance resolution using RealESRGAN and other models
- **LoRA Support**: Apply custom style and character LoRAs with adjustable weights
- **Model Discovery**: List available checkpoints, LoRAs, samplers, and schedulers
- **Queue Monitoring**: Check generation status and pending jobs

## Prerequisites

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) running locally
- Node.js 18+
- At least one Stable Diffusion checkpoint model

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/comfyui-mcp.git
cd comfyui-mcp
npm install
```

### 2. Configure Claude Code

Add to `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "comfyui": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/comfyui-mcp/src/index.ts"],
      "env": {
        "COMFYUI_URL": "http://localhost:8188",
        "COMFYUI_MODEL": "dreamshaper_8.safetensors"
      }
    }
  }
}
```

### 3. Start ComfyUI

Ensure ComfyUI is running at the configured URL (default: http://localhost:8188).

### 4. Generate Images

Restart Claude Code and start generating:

```
"Generate a portrait with warm lighting and save it to ./images/portrait.png"
```

## Available Tools

### generate_image

Generate an image from a text prompt (txt2img).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | string | required | What to generate |
| negative_prompt | string | "bad quality, blurry" | What to avoid |
| width | number | 512 | Image width in pixels |
| height | number | 768 | Image height in pixels |
| steps | number | 28 | Sampling steps |
| cfg_scale | number | 7 | Classifier-free guidance scale |
| sampler | string | "euler_ancestral" | Sampling algorithm |
| scheduler | string | "normal" | Noise scheduler |
| model | string | env default | Checkpoint model name |
| seed | number | random | Random seed for reproducibility |
| loras | array | none | LoRAs to apply (see below) |
| output_path | string | required | Where to save the image |

**LoRA format:**
```json
{
  "name": "style_lora.safetensors",
  "strength_model": 0.8,
  "strength_clip": 0.8
}
```

### img2img

Transform an existing image with AI guidance.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prompt | string | required | What to generate |
| input_image | string | required | Filename in ComfyUI input folder |
| denoise | number | 0.75 | 0.0 = no change, 1.0 = full regeneration |
| output_path | string | required | Where to save the result |
| *(plus all txt2img params)* | | | |

### upscale_image

Upscale an image using AI upscaling models.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| input_image | string | required | Filename in ComfyUI input folder |
| upscale_model | string | "RealESRGAN_x4plus.pth" | Upscaling model |
| target_width | number | native | Optional resize width |
| target_height | number | native | Optional resize height |
| output_path | string | required | Where to save the result |

### Discovery Tools

| Tool | Description |
|------|-------------|
| list_models | Available checkpoint models |
| list_loras | Available LoRA adapters |
| list_samplers | Sampling algorithms (euler, dpm++, etc.) |
| list_schedulers | Noise schedulers (normal, karras, etc.) |
| list_upscale_models | Upscaling models (RealESRGAN, etc.) |
| get_queue_status | Running and pending jobs |

## Usage Examples

### Basic Generation

```
"Generate a mountain landscape at golden hour, save to ./assets/landscape.png"
```

### With LoRAs

```
"Create an anime-style portrait using the animeStyle.safetensors LoRA
at 0.8 strength, save to ./output/anime_portrait.png"
```

### Image Transformation

```
"Take the sketch in ComfyUI's input folder called sketch.png and turn
it into a detailed illustration with 0.7 denoise"
```

### Upscaling

```
"Upscale hero.png to 4K using RealESRGAN"
```

### Batch Workflow

```
"Generate 3 variations of a forest scene with different lighting:
1. Misty morning
2. Harsh noon sun
3. Sunset through trees
Save them to ./scenes/forest_*.png"
```

## Architecture

```
┌─────────────┐     MCP Protocol    ┌─────────────┐     REST/WS     ┌──────────┐
│   Claude    │ ◄─────────────────► │  MCP Server │ ◄─────────────► │ ComfyUI  │
│   (Client)  │    Tool Calls       │  (Bridge)   │   Workflows     │  (API)   │
└─────────────┘                     └─────────────┘                 └──────────┘
```

The MCP server:
1. Exposes tools to the AI client
2. Receives requests with parameters
3. Builds ComfyUI workflow JSON
4. Queues workflows via REST API
5. Monitors progress via WebSocket
6. Retrieves and saves generated images

### How ComfyUI Workflows Work

ComfyUI represents image generation as a graph of nodes. Each node performs an operation:

```
CheckpointLoader → CLIPTextEncode → KSampler → VAEDecode → SaveImage
       ↓                                ↑
    LoraLoader(s) ──────────────────────┘
```

Our server dynamically constructs these graphs based on your parameters. When you specify LoRAs, we inject LoraLoader nodes into the chain. The workflow is submitted as JSON to ComfyUI's `/prompt` endpoint.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| COMFYUI_URL | http://localhost:8188 | ComfyUI API endpoint |
| COMFYUI_MODEL | (none) | Default checkpoint model |
| COMFYUI_OUTPUT_DIR | /tmp/comfyui-output | Fallback output directory |

## Project Structure

```
comfyui-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── comfyui-client.ts     # ComfyUI REST/WebSocket client
│   ├── workflows/
│   │   ├── txt2img.json      # Text-to-image template
│   │   ├── img2img.json      # Image-to-image template
│   │   ├── upscale.json      # Upscaling template
│   │   └── builder.ts        # Workflow parameterization & LoRA injection
│   └── tools/
│       ├── generate.ts       # generate_image, img2img
│       ├── upscale.ts        # upscale_image, list_upscale_models
│       ├── list-models.ts    # Model discovery tools
│       └── queue-status.ts   # Queue monitoring
├── package.json
├── tsconfig.json
├── ARTICLE.md                # Full tutorial article
└── README.md
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## Troubleshooting

### "Connection refused"
Ensure ComfyUI is running at the configured COMFYUI_URL.

### "Model not found"
Run `list_models` to see available checkpoints. Model names must match exactly, including file extension.

### "No image in output"
Check ComfyUI's web interface for workflow errors. The queued prompt may have failed due to missing nodes or invalid parameters.

### Slow generation
Generation time depends on hardware, model size, and step count. Reduce steps for faster drafts.

### LoRA not applying
Verify the LoRA filename with `list_loras`. Ensure strength values are reasonable (0.5-1.2 typically).

## Extending

The codebase is designed for extension:

- **ControlNet**: Add conditioning workflows in `src/workflows/` and corresponding tools
- **Inpainting**: Extend img2img with mask support
- **Video**: ComfyUI supports AnimateDiff—same workflow pattern applies
- **Custom nodes**: Any ComfyUI custom node can be integrated into workflow templates

## Related

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI) - The backend we're wrapping
- [MCP SDK](https://github.com/modelcontextprotocol/sdk) - The protocol implementation
- [Claude Code](https://claude.ai/code) - Primary MCP client

## License

MIT

---

**Full Tutorial**: See [ARTICLE.md](./ARTICLE.md) for a detailed walkthrough of building this server from scratch, including architecture decisions and implementation details.
