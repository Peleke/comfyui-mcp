# EPIC-01: Video Generation

**Priority**: 🟡 MEDIUM-HIGH
**Batch**: 1
**Estimated Effort**: 2-3 weeks

## Overview

Add text-to-video (T2V), image-to-video (I2V), and video-to-video (V2V) generation capabilities using LTX-Video, Hunyuan, and Wan 2.2 models. Enable seamless pipelines from image generation to video.

## Why This Matters

Video generation is the natural next step from image generation:
- **I2V**: Turn any generated image into a short video clip
- **T2V**: Generate video directly from descriptions
- **V2V**: Restyle or extend existing video content

Key use case: `imagine` → `image_to_video` pipeline for character animations.

## Supported Models

| Model | T2V | I2V | V2V | Notes |
|-------|-----|-----|-----|-------|
| LTX-Video | ✅ | ✅ | ✅ | Fast, good quality, ~2B params |
| Hunyuan | ✅ | ✅ | - | High quality, longer generation |
| Wan 2.2 | ✅ | ✅ | ✅ | Good for anime/stylized |

## Issues

### Issue #XX: Video Workflow Builder - LTX-Video

**Type**: Feature
**Labels**: `enhancement`, `video`, `ltx`

#### Description

Create workflow builders for LTX-Video generation:

```typescript
interface LTXVideoParams {
  // Common
  prompt: string;
  negativePrompt?: string;
  width?: number;   // default: 768
  height?: number;  // default: 512
  numFrames?: number;  // default: 97 (about 4 seconds at 24fps)
  fps?: number;  // default: 24
  seed?: number;

  // Model config
  steps?: number;  // default: 30
  cfg?: number;    // default: 3.0

  // For I2V
  inputImage?: string;

  // For V2V
  inputVideo?: string;
  denoise?: number;
}

function buildLTXVideoT2VWorkflow(params: LTXVideoParams): ComfyWorkflow;
function buildLTXVideoI2VWorkflow(params: LTXVideoParams): ComfyWorkflow;
function buildLTXVideoV2VWorkflow(params: LTXVideoParams): ComfyWorkflow;
```

#### Key Nodes

- `LTXVLoader` - Load LTX model
- `LTXVCLIPModelLoader` - Load T5 text encoder
- `EmptyLTXVLatentVideo` - Create empty latent for T2V
- `LTXVImgToVideo` - For I2V
- `SamplerCustomAdvanced` - Advanced sampling
- `VHS_VideoCombine` - Combine frames to video

#### Acceptance Criteria

- [ ] T2V workflow produces valid video
- [ ] I2V workflow accepts image input
- [ ] V2V workflow accepts video input
- [ ] Frame count configurable (25-200)
- [ ] Output as MP4/GIF

---

### Issue #XX: Video Workflow Builder - Hunyuan

**Type**: Feature
**Labels**: `enhancement`, `video`, `hunyuan`

#### Description

Add Hunyuan video support:

```typescript
interface HunyuanVideoParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;   // default: 848
  height?: number;  // default: 480
  numFrames?: number;  // default: 129

  // Hunyuan-specific
  flowShift?: number;  // default: 7.0
  steps?: number;      // default: 30
  embeddedGuidance?: number;  // default: 6.0

  // For I2V
  inputImage?: string;
}

function buildHunyuanT2VWorkflow(params: HunyuanVideoParams): ComfyWorkflow;
function buildHunyuanI2VWorkflow(params: HunyuanVideoParams): ComfyWorkflow;
```

#### Key Nodes

- `HunyuanVideo/TextEncode`
- `HunyuanVideo/Sampler`
- `HunyuanVideo/Decode`

#### Acceptance Criteria

- [ ] T2V workflow produces valid video
- [ ] I2V workflow accepts image input
- [ ] Quality comparable to reference implementations

---

### Issue #XX: Video MCP Tools

**Type**: Feature
**Labels**: `enhancement`, `video`, `mcp`

#### Description

Add MCP tools for video generation:

```typescript
// Tool: text_to_video
{
  name: "text_to_video",
  description: "Generate a video from a text description",
  inputSchema: {
    properties: {
      prompt: { type: "string", description: "Detailed description of the video" },
      model: { enum: ["ltx", "hunyuan", "wan"], default: "ltx" },
      duration: { type: "number", description: "Duration in seconds", default: 4 },
      output_path: { type: "string" },
      width: { type: "number" },
      height: { type: "number" },
      fps: { type: "number", default: 24 }
    }
  }
}

// Tool: image_to_video
{
  name: "image_to_video",
  description: "Animate a static image into a video",
  inputSchema: {
    properties: {
      prompt: { type: "string", description: "Description of the motion/animation" },
      input_image: { type: "string", description: "Path to source image" },
      model: { enum: ["ltx", "hunyuan", "wan"], default: "ltx" },
      duration: { type: "number", default: 4 },
      output_path: { type: "string" }
    }
  }
}

// Tool: video_to_video
{
  name: "video_to_video",
  description: "Transform or restyle an existing video",
  inputSchema: {
    properties: {
      prompt: { type: "string" },
      input_video: { type: "string" },
      denoise: { type: "number", default: 0.7, description: "0=keep original, 1=full regen" },
      model: { enum: ["ltx", "wan"], default: "ltx" },
      output_path: { type: "string" }
    }
  }
}
```

#### Acceptance Criteria

- [ ] `text_to_video` working with LTX
- [ ] `image_to_video` working with LTX
- [ ] `video_to_video` working with LTX
- [ ] Model selection between LTX/Hunyuan/Wan
- [ ] Progress reporting during generation
- [ ] Output format options (MP4, GIF)

---

### Issue #XX: Video Pipeline Integration

**Type**: Feature
**Labels**: `enhancement`, `video`, `pipeline`

#### Description

Extend the pipeline system to support video generation:

```typescript
// New pipeline: T2I → I2V
const result = await executePipeline(client, {
  prompt: "A warrior princess",
  output_path: "/tmp/warrior.mp4",

  // Image generation
  enable_hires_fix: true,

  // Video generation (new!)
  enable_video: true,
  video_prompt: "The warrior raises her sword heroically, wind blowing her hair",
  video_duration: 4,
  video_model: "ltx"
});

// Result includes:
// - Intermediate image at /tmp/warrior_frame.png
// - Final video at /tmp/warrior.mp4
```

#### Acceptance Criteria

- [ ] Pipeline supports `enable_video` option
- [ ] T2I output automatically feeds into I2V
- [ ] Intermediate image can be saved
- [ ] Video prompt can differ from image prompt

---

### Issue #XX: Video Imagine Tool

**Type**: Feature
**Labels**: `enhancement`, `video`

#### Description

Create a high-level `imagine_video` tool:

```typescript
{
  name: "imagine_video",
  description: "Generate a video from natural language. Auto-detects best model and settings.",
  inputSchema: {
    properties: {
      description: { type: "string" },
      output_path: { type: "string" },

      // Optional
      style: { enum: ["cinematic", "anime", "realistic", ...] },
      duration: { type: "number", default: 4 },
      quality: { enum: ["draft", "standard", "high"], default: "standard" },

      // For I2V
      source_image: { type: "string" },

      // For T2I→I2V pipeline
      generate_keyframe: { type: "boolean", default: false }
    }
  }
}
```

#### Acceptance Criteria

- [ ] Auto-selects best model based on style
- [ ] Quality presets affect steps/resolution
- [ ] `source_image` triggers I2V mode
- [ ] `generate_keyframe` does T2I first, then I2V
- [ ] Helpful output message with seed for reproducibility

---

## Required Models

| Model | Files | Size | Location |
|-------|-------|------|----------|
| LTX-Video | `ltx-video-2b-v0.9.5.safetensors` | ~4GB | `checkpoints/` |
| LTX T5 | `t5xxl_fp16.safetensors` | ~10GB | `text_encoders/` |
| Hunyuan | Multiple files | ~25GB | Various |
| Wan 2.2 | `wan2.2_5B.safetensors` | ~10GB | `checkpoints/` |

## Example Usage

```
User: "Generate a 4-second video of a cat playing with yarn"

Claude: [Uses text_to_video with ltx model]

---

User: "Take this portrait I just generated and animate it"

Claude: [Uses image_to_video with the previous output]

---

User: "Create a cinematic shot of a spaceship, then animate it flying"

Claude: [Uses imagine with generate_keyframe + video enabled]
```

## Technical Notes

### Video Generation is SLOW

Unlike image generation (seconds), video generation takes minutes:
- LTX: ~1-3 min for 4 seconds of video
- Hunyuan: ~5-10 min
- Wan: ~2-5 min

Consider:
- Async execution / background jobs
- Progress callbacks
- Lower resolution drafts first

### VRAM Requirements

Video models are VRAM-hungry:
- LTX: ~12GB minimum, 16GB recommended
- Hunyuan: ~20GB minimum
- Wan: ~16GB minimum

For lower VRAM: reduce resolution, frame count, or use quantized models.

## Dependencies

- ComfyUI-VideoHelperSuite (for video encoding)
- Model-specific custom nodes
- FFmpeg (usually included in ComfyUI)
