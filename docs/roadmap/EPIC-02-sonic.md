# EPIC-02: Talking Heads (Sonic)

**Priority**: 🟡 MEDIUM
**Batch**: 2
**Estimated Effort**: 1-2 weeks

## Overview

Add audio-driven talking head generation using the Sonic workflow. Given a portrait image and an audio file, generate a video of the character speaking/singing with lip sync.

## Why This Matters

Talking head generation enables:
- **Character animation**: Turn any generated portrait into a speaking character
- **Avatar creation**: Personal avatars for content creation
- **Voice-over visualization**: Pair voice recordings with AI-generated faces
- **Podcast/content thumbnails**: Animated preview clips

Key pipeline: `imagine` (portrait) → `sonic` (animate with audio)

## The Sonic Pipeline

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Portrait  │     │    Audio    │     │   Sonic     │
│   Image     │ ──► │   (.wav)    │ ──► │  Workflow   │ ──► Video
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               ▼
                                    ┌─────────────────────┐
                                    │ Lip-synced video    │
                                    │ with head movement  │
                                    └─────────────────────┘
```

## Issues

### Issue #XX: Sonic Workflow Builder

**Type**: Feature
**Labels**: `enhancement`, `sonic`, `talking-heads`

#### Description

Create workflow builder for Sonic audio-to-video generation:

```typescript
interface SonicParams {
  // Inputs
  portraitImage: string;  // Path to portrait image
  audioFile: string;      // Path to audio file (.wav)

  // Output
  outputPath: string;

  // Optional settings
  faceDetectionThreshold?: number;  // default: 0.5
  headMovementScale?: number;       // default: 1.0
  lipSyncStrength?: number;         // default: 1.0

  // Frame interpolation
  fps?: number;           // Output FPS, default: 25
  interpolation?: boolean; // Use RIFE for smoother motion

  // SVD settings (underlying model)
  motionBucketId?: number;  // default: 127
  augmentationLevel?: number;  // default: 0
}

function buildSonicWorkflow(params: SonicParams): ComfyWorkflow;
```

#### Key Nodes

- `LoadImage` - Load portrait
- `LoadAudio` - Load audio file
- `SonicSampler` - Core Sonic processing
- `SonicAudioEncoder` - Audio feature extraction
- `YoloFaceDetect` - Face detection in image
- `VHS_VideoCombine` - Combine frames

#### Required Models

```
models/
├── sonic/
│   ├── unet.pth           # Main Sonic model
│   ├── audio2bucket.pth   # Audio processing
│   └── audio2token.pth    # Token extraction
├── svd/
│   └── svd_xt_1_1.safetensors  # Base video model
└── yolo/
    └── yolov8n-face.pt    # Face detection
```

#### Acceptance Criteria

- [ ] Workflow loads and executes without error
- [ ] Portrait image face is detected
- [ ] Audio drives lip movement
- [ ] Output video has correct duration matching audio
- [ ] FPS and interpolation settings work

---

### Issue #XX: Sonic MCP Tool

**Type**: Feature
**Labels**: `enhancement`, `sonic`, `mcp`

#### Description

Add MCP tool for Sonic generation:

```typescript
{
  name: "animate_portrait",
  description: "Animate a portrait image with audio to create a talking head video",
  inputSchema: {
    type: "object",
    properties: {
      portrait_image: {
        type: "string",
        description: "Path to portrait image (should be front-facing)"
      },
      audio_file: {
        type: "string",
        description: "Path to audio file (.wav format)"
      },
      output_path: {
        type: "string",
        description: "Where to save the output video"
      },
      head_movement: {
        type: "number",
        default: 1.0,
        description: "Scale of head movement (0.5-2.0)"
      },
      fps: {
        type: "number",
        default: 25,
        description: "Output video FPS"
      },
      smooth: {
        type: "boolean",
        default: true,
        description: "Apply frame interpolation for smoother motion"
      }
    },
    required: ["portrait_image", "audio_file", "output_path"]
  }
}
```

#### Acceptance Criteria

- [ ] Tool callable from Claude
- [ ] Handles both local paths and ComfyUI input folder refs
- [ ] Audio format validation (.wav required)
- [ ] Portrait face detection validation
- [ ] Clear error messages for common issues

---

### Issue #XX: Portrait + Sonic Pipeline

**Type**: Feature
**Labels**: `enhancement`, `sonic`, `pipeline`

#### Description

Create a combined pipeline for generating and animating a portrait:

```typescript
// Single call: Generate portrait, then animate with audio
const result = await executeSonicPipeline(client, {
  // Portrait generation (T2I)
  portraitPrompt: "A friendly female podcaster, professional headshot, warm smile",
  portraitModel: "realistic_model.safetensors",

  // Audio
  audioFile: "/path/to/voiceover.wav",

  // Output
  outputPath: "/tmp/podcaster_intro.mp4",

  // Options
  portraitQuality: "high",  // Use hi-res fix
  videoSmooth: true
});

// Returns:
{
  success: true,
  portraitPath: "/tmp/podcaster_intro_portrait.png",
  videoPath: "/tmp/podcaster_intro.mp4",
  duration: 12.5  // seconds, matches audio
}
```

#### Acceptance Criteria

- [ ] Single function call generates portrait + video
- [ ] Portrait uses existing prompting system
- [ ] Intermediate portrait saved
- [ ] Pipeline handles failures gracefully (save portrait even if video fails)

---

### Issue #XX: Sonic Imagine Tool

**Type**: Feature
**Labels**: `enhancement`, `sonic`

#### Description

High-level tool for generating talking head content:

```typescript
{
  name: "imagine_talking_head",
  description: "Generate a talking head video from a character description and audio",
  inputSchema: {
    properties: {
      description: {
        type: "string",
        description: "Character description (will generate portrait first)"
      },
      audio_file: {
        type: "string",
        description: "Audio file path"
      },
      output_path: { type: "string" },

      // Optional
      style: {
        type: "string",
        enum: ["realistic", "anime", "3d_render"],
        default: "realistic"
      },
      gender_hint: {
        type: "string",
        enum: ["male", "female", "neutral"]
      },
      existing_portrait: {
        type: "string",
        description: "Use existing image instead of generating"
      }
    }
  }
}
```

#### Acceptance Criteria

- [ ] Generates portrait if not provided
- [ ] Uses audio to animate portrait
- [ ] Style selection affects portrait generation
- [ ] Works with both generated and provided portraits

---

## Audio Requirements

Sonic works best with:
- **Format**: WAV (16-bit PCM)
- **Sample rate**: 16kHz or 44.1kHz
- **Channels**: Mono preferred
- **Duration**: 1-60 seconds (longer videos may have issues)

### Issue #XX: Audio Preprocessing Tool

**Type**: Feature
**Labels**: `enhancement`, `sonic`, `audio`

#### Description

Add tool for preparing audio files:

```typescript
{
  name: "prepare_audio",
  description: "Convert and prepare audio file for talking head generation",
  inputSchema: {
    properties: {
      input_file: { type: "string" },
      output_file: { type: "string" }
    }
  }
}

// Converts MP3, M4A, etc. to compatible WAV format
```

---

## Example Usage

```
User: "Create a talking head video of an anime character saying this voiceover"

Claude: Let me generate an anime portrait first, then animate it with your audio.

[Uses imagine with style: anime, model_family: illustrious]
[Uses animate_portrait with the generated image + audio]

Done! Video saved to /path/to/output.mp4. The 15-second clip shows your
anime character speaking the voiceover with lip sync and natural head movement.

---

User: "Use this existing photo of me as the portrait"

Claude: [Uses animate_portrait with user's existing image + audio]
```

## Technical Notes

### Face Detection Requirements

Sonic requires:
- Front-facing portrait (not profile)
- Face clearly visible
- Reasonable lighting
- Single face (no groups)

The workflow will fail if face detection fails. Consider adding validation step.

### VRAM Usage

- SVD model: ~6GB
- Sonic models: ~2GB
- Total: ~10GB minimum

### Generation Time

- ~30 seconds per 1 second of video
- 10 second audio = ~5 minutes generation

## Dependencies

- ComfyUI_Sonic custom nodes
- ComfyUI-VideoHelperSuite
- SVD model (Stable Video Diffusion)
- Sonic-specific models
- YOLOv8 face detection
- Optional: RIFE for interpolation
