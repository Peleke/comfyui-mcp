# EPIC-04: Cross-Modal Pipelines

**Priority**: 🟡 MEDIUM
**Batch**: After core features complete
**Estimated Effort**: 2-3 weeks

## Overview

Build unified pipelines that chain multiple generation modalities together. Enable "describe once, generate everything" workflows where a single user request produces images, videos, talking heads, and music in coordinated fashion.

## Why This Matters

Individual generation tools are powerful. Pipelines make them transformative:
- **Single prompt → Full video production**: Character + animation + music
- **Consistent outputs**: Same seed/settings propagate through chain
- **Atomic operations**: Either everything succeeds or nothing does
- **Progress visibility**: Track multi-step generation in real-time

## The Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Pipeline Orchestration Layer                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   User Request                                                                  │
│        │                                                                        │
│        ▼                                                                        │
│   ┌─────────────┐                                                               │
│   │  Pipeline   │     Analyzes request, determines optimal path                 │
│   │  Planner    │     through available generation modules                      │
│   └──────┬──────┘                                                               │
│          │                                                                      │
│          ▼                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                         Execution Graph                                 │   │
│   │                                                                         │   │
│   │    ┌─────┐      ┌─────┐      ┌─────┐      ┌─────┐      ┌─────┐        │   │
│   │    │ T2I │ ───► │HiRes│ ───► │ I2V │ ───► │Music│ ───► │ Mux │        │   │
│   │    └─────┘      └─────┘      └─────┘      └─────┘      └─────┘        │   │
│   │       │                         │                         │            │   │
│   │       │      ┌─────────────────┐│                         │            │   │
│   │       └─────►│   ControlNet    │┘                         │            │   │
│   │              │   (optional)    │                          │            │   │
│   │              └─────────────────┘                          ▼            │   │
│   │                                                    Final Output        │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Issues

### Issue #XX: Pipeline Orchestrator Core

**Type**: Feature
**Labels**: `enhancement`, `pipeline`, `core`

#### Description

Build the core pipeline orchestration system:

```typescript
interface PipelineStep {
  id: string;
  type: "t2i" | "i2i" | "hires" | "upscale" | "controlnet" | "i2v" | "t2v" | "v2v" | "sonic" | "music" | "mux";
  config: Record<string, unknown>;
  dependsOn?: string[];  // Step IDs this depends on
}

interface PipelineDefinition {
  name: string;
  description: string;
  steps: PipelineStep[];
  inputs: Record<string, "string" | "number" | "boolean">;
  outputs: string[];  // Which step outputs to return
}

interface PipelineResult {
  success: boolean;
  outputs: Record<string, string>;  // step_id -> output path
  timing: Record<string, number>;   // step_id -> duration_ms
  errors?: Record<string, string>;  // step_id -> error message
}

class PipelineOrchestrator {
  async execute(
    definition: PipelineDefinition,
    inputs: Record<string, unknown>,
    onProgress?: (stepId: string, progress: number) => void
  ): Promise<PipelineResult>;

  // Validate pipeline before execution
  validate(definition: PipelineDefinition): ValidationResult;

  // Get execution plan showing order and parallelization
  plan(definition: PipelineDefinition): ExecutionPlan;
}
```

#### Acceptance Criteria

- [ ] Pipeline definition validation
- [ ] Dependency resolution (topological sort)
- [ ] Parallel execution where possible
- [ ] Progress callbacks per step
- [ ] Atomic rollback on failure
- [ ] Output artifact management

---

### Issue #XX: T2I → I2V Pipeline

**Type**: Feature
**Labels**: `enhancement`, `pipeline`, `video`

#### Description

Create pipeline for generating video from text via image intermediate:

```typescript
// Pipeline definition
const T2I_TO_I2V: PipelineDefinition = {
  name: "text_to_animated_image",
  description: "Generate an image from text, then animate it",
  steps: [
    {
      id: "generate_image",
      type: "t2i",
      config: {
        width: 768,
        height: 512,
        // Inherited from inputs
      }
    },
    {
      id: "animate",
      type: "i2v",
      dependsOn: ["generate_image"],
      config: {
        model: "ltx",
        duration: 4,
        // Uses output from generate_image
      }
    }
  ],
  inputs: {
    prompt: "string",
    motion_prompt: "string",  // Optional, defaults to prompt
    quality: "string"
  },
  outputs: ["generate_image", "animate"]
};

// MCP Tool
{
  name: "imagine_and_animate",
  description: "Generate an image and animate it in one step",
  inputSchema: {
    properties: {
      description: {
        type: "string",
        description: "What to generate (used for both image and motion)"
      },
      motion_description: {
        type: "string",
        description: "Specific motion/animation description (optional)"
      },
      output_path: { type: "string" },
      duration: { type: "number", default: 4 },
      quality: { enum: ["draft", "standard", "high"], default: "standard" }
    },
    required: ["description", "output_path"]
  }
}
```

#### Example Usage

```
User: "Create a video of a majestic eagle soaring through clouds"

Claude: [Uses imagine_and_animate pipeline]

Generated:
1. Image: /tmp/eagle_frame.png (1024x768, realistic style)
2. Video: /tmp/eagle.mp4 (4 seconds, smooth soaring motion)

The eagle is shown gliding through fluffy white clouds with
subtle wing movements. Seed: 42 for reproducibility.
```

#### Acceptance Criteria

- [ ] Single tool call generates both image and video
- [ ] Motion prompt can differ from image prompt
- [ ] Intermediate image saved and accessible
- [ ] Quality presets affect both stages
- [ ] Style consistency between image and video

---

### Issue #XX: T2I → Sonic Pipeline (Talking Portrait)

**Type**: Feature
**Labels**: `enhancement`, `pipeline`, `sonic`

#### Description

Create pipeline for generating talking head content:

```typescript
const T2I_TO_SONIC: PipelineDefinition = {
  name: "generate_talking_head",
  description: "Generate a portrait and animate it with audio",
  steps: [
    {
      id: "generate_portrait",
      type: "t2i",
      config: {
        // Portrait-optimized settings
        prompt_suffix: ", portrait, front-facing, centered, good lighting",
        width: 512,
        height: 768,
        cfg: 7
      }
    },
    {
      id: "animate_with_audio",
      type: "sonic",
      dependsOn: ["generate_portrait"],
      config: {
        // Uses portrait output + audio input
      }
    }
  ],
  inputs: {
    character_description: "string",
    audio_file: "string",
    style: "string"  // "realistic" | "anime" | "3d"
  },
  outputs: ["generate_portrait", "animate_with_audio"]
};

// MCP Tool
{
  name: "create_talking_character",
  description: "Generate a character portrait and animate it speaking",
  inputSchema: {
    properties: {
      character: {
        type: "string",
        description: "Character description (appearance, age, style)"
      },
      audio: {
        type: "string",
        description: "Path to audio file (.wav)"
      },
      output_path: { type: "string" },
      style: {
        enum: ["realistic", "anime", "3d_render", "cartoon"],
        default: "realistic"
      },
      save_portrait: {
        type: "boolean",
        default: true,
        description: "Also save the generated portrait image"
      }
    },
    required: ["character", "audio", "output_path"]
  }
}
```

#### Acceptance Criteria

- [ ] Portrait optimized for Sonic (front-facing, good lighting)
- [ ] Audio automatically validated/converted
- [ ] Style affects portrait generation model selection
- [ ] Portrait reusable for multiple audio clips
- [ ] Handles various character descriptions

---

### Issue #XX: Full Video Production Pipeline

**Type**: Feature
**Labels**: `enhancement`, `pipeline`, `video`, `music`

#### Description

Create end-to-end pipeline for video with soundtrack:

```typescript
const FULL_VIDEO_PRODUCTION: PipelineDefinition = {
  name: "complete_video_production",
  description: "Generate video with matching soundtrack",
  steps: [
    {
      id: "generate_keyframe",
      type: "t2i",
      config: { /* video-optimized dimensions */ }
    },
    {
      id: "animate_keyframe",
      type: "i2v",
      dependsOn: ["generate_keyframe"],
      config: { duration: 10 }
    },
    {
      id: "generate_soundtrack",
      type: "music",
      config: {
        // Duration matched to video automatically
        // Mood derived from video prompt
      }
    },
    {
      id: "combine_av",
      type: "mux",
      dependsOn: ["animate_keyframe", "generate_soundtrack"],
      config: {
        // FFmpeg combination
      }
    }
  ],
  inputs: {
    scene_description: "string",
    music_style: "string",
    duration: "number"
  },
  outputs: ["generate_keyframe", "animate_keyframe", "generate_soundtrack", "combine_av"]
};

// MCP Tool
{
  name: "produce_video",
  description: "Generate a complete video with image, animation, and soundtrack",
  inputSchema: {
    properties: {
      scene: {
        type: "string",
        description: "Scene description for visuals"
      },
      music: {
        type: "string",
        description: "Music style/mood description"
      },
      output_path: { type: "string" },
      duration: {
        type: "number",
        default: 10,
        description: "Video duration in seconds (5-30)"
      },
      quality: {
        enum: ["draft", "standard", "high"],
        default: "standard"
      }
    },
    required: ["scene", "output_path"]
  }
}
```

#### Parallel Execution

```
generate_keyframe ─────► animate_keyframe ─────┐
                                               ├──► combine_av ──► OUTPUT
generate_soundtrack ───────────────────────────┘

Music generation runs in parallel with image→video chain
```

#### Acceptance Criteria

- [ ] Video and music durations synchronized
- [ ] Music style auto-derived if not specified
- [ ] All intermediate assets accessible
- [ ] Final video properly muxed with audio
- [ ] Quality presets affect all stages

---

### Issue #XX: ControlNet-Guided Pipelines

**Type**: Feature
**Labels**: `enhancement`, `pipeline`, `controlnet`

#### Description

Add ControlNet as a composable step in pipelines:

```typescript
// Pipeline with ControlNet preprocessing
const POSE_TRANSFER_PIPELINE: PipelineDefinition = {
  name: "pose_transfer",
  description: "Generate image matching reference pose",
  steps: [
    {
      id: "extract_pose",
      type: "preprocess",
      config: { type: "openpose" }
    },
    {
      id: "generate_with_pose",
      type: "controlnet",
      dependsOn: ["extract_pose"],
      config: {
        control_type: "openpose",
        strength: 0.8
      }
    }
  ],
  inputs: {
    reference_image: "string",
    character_description: "string"
  },
  outputs: ["generate_with_pose"]
};

// Consistent character pipeline
const CHARACTER_CONSISTENCY_PIPELINE: PipelineDefinition = {
  name: "consistent_character_series",
  description: "Generate multiple images of same character in different poses",
  steps: [
    {
      id: "base_character",
      type: "t2i",
      config: { /* character reference */ }
    },
    {
      id: "extract_style",
      type: "preprocess",
      dependsOn: ["base_character"],
      config: { type: "canny" }
    },
    // Multiple controlled variations
    {
      id: "variation_1",
      type: "controlnet",
      dependsOn: ["extract_style"],
      config: { pose_reference: "pose_1.png" }
    },
    {
      id: "variation_2",
      type: "controlnet",
      dependsOn: ["extract_style"],
      config: { pose_reference: "pose_2.png" }
    }
  ]
};
```

#### Acceptance Criteria

- [ ] ControlNet integrates with any image generation step
- [ ] Preprocessing automatic when needed
- [ ] Multi-ControlNet in single step supported
- [ ] Works with video pipelines (per-frame control)

---

### Issue #XX: Pipeline Templates

**Type**: Feature
**Labels**: `enhancement`, `pipeline`, `ux`

#### Description

Create predefined pipeline templates for common workflows:

```typescript
const PIPELINE_TEMPLATES = {
  // Quick content creation
  "social_media_video": {
    description: "Generate short video for social media",
    defaults: { duration: 5, quality: "standard", aspect: "9:16" }
  },

  // Character animation
  "character_animation": {
    description: "Generate and animate a character",
    defaults: { style: "anime", duration: 4 }
  },

  // Podcast/video avatar
  "talking_avatar": {
    description: "Create speaking avatar from description",
    defaults: { style: "realistic", portrait_only: false }
  },

  // Music video
  "music_video": {
    description: "Generate visuals with matching soundtrack",
    defaults: { duration: 30, music_style: "ambient" }
  },

  // Product showcase
  "product_showcase": {
    description: "Generate product image and animate rotation",
    defaults: { quality: "high", background: "studio" }
  },

  // Story sequence
  "story_panels": {
    description: "Generate consistent character across multiple scenes",
    defaults: { panels: 4, style: "comic" }
  }
};

// MCP Tool for template selection
{
  name: "list_pipeline_templates",
  description: "List available pipeline templates"
}

{
  name: "run_pipeline_template",
  description: "Execute a predefined pipeline template",
  inputSchema: {
    properties: {
      template: {
        enum: Object.keys(PIPELINE_TEMPLATES),
        description: "Template name"
      },
      inputs: {
        type: "object",
        description: "Template-specific inputs"
      },
      output_dir: { type: "string" }
    },
    required: ["template", "inputs", "output_dir"]
  }
}
```

#### Acceptance Criteria

- [ ] Templates cover common use cases
- [ ] Sensible defaults for each template
- [ ] Easy to customize template parameters
- [ ] Templates discoverable via tool

---

### Issue #XX: Pipeline Progress & Monitoring

**Type**: Feature
**Labels**: `enhancement`, `pipeline`, `ux`

#### Description

Add comprehensive progress tracking for multi-step pipelines:

```typescript
interface PipelineProgress {
  pipelineId: string;
  status: "planning" | "executing" | "completed" | "failed";
  currentStep: string;
  completedSteps: string[];
  pendingSteps: string[];

  // Per-step progress
  stepProgress: Record<string, {
    status: "pending" | "running" | "completed" | "failed";
    progress: number;  // 0-100
    startTime?: number;
    endTime?: number;
    output?: string;
    error?: string;
  }>;

  // Overall timing
  startTime: number;
  estimatedCompletion?: number;

  // Outputs available so far
  availableOutputs: Record<string, string>;
}

// Progress callback
type ProgressCallback = (progress: PipelineProgress) => void;

// MCP tool for checking progress
{
  name: "get_pipeline_status",
  description: "Check status of a running pipeline",
  inputSchema: {
    properties: {
      pipeline_id: { type: "string" }
    }
  }
}

// Cancel a running pipeline
{
  name: "cancel_pipeline",
  description: "Cancel a running pipeline",
  inputSchema: {
    properties: {
      pipeline_id: { type: "string" },
      keep_completed: {
        type: "boolean",
        default: true,
        description: "Keep outputs from completed steps"
      }
    }
  }
}
```

#### Progress Display

```
Pipeline: full_video_production (ID: abc123)
Status: Executing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 65%

Steps:
✓ generate_keyframe    [====================] 100%  (2.3s)
⟳ animate_keyframe     [============        ]  60%  (~45s remaining)
⟳ generate_soundtrack  [================    ]  80%  (~10s remaining)
○ combine_av           [                    ]   0%  (waiting)

Outputs available:
  • generate_keyframe: /tmp/pipeline_abc123/keyframe.png

Estimated completion: ~55 seconds
```

#### Acceptance Criteria

- [ ] Real-time progress for each step
- [ ] Overall pipeline progress calculation
- [ ] Time estimates based on historical data
- [ ] Partial outputs accessible before completion
- [ ] Cancellation preserves completed work

---

### Issue #XX: Error Recovery & Retry

**Type**: Feature
**Labels**: `enhancement`, `pipeline`, `reliability`

#### Description

Add robust error handling and retry capabilities:

```typescript
interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];  // Error types to retry
}

interface PipelineOptions {
  retry?: RetryConfig;

  // On step failure
  onStepFailure?: "abort" | "skip" | "retry";

  // Checkpoint for long pipelines
  enableCheckpoints?: boolean;
  checkpointDir?: string;

  // Resume from checkpoint
  resumeFrom?: string;  // Checkpoint ID
}

// Error classification
type PipelineError = {
  type: "transient" | "permanent" | "resource" | "validation";
  step: string;
  message: string;
  retryable: boolean;
  details?: unknown;
};

// Recovery tool
{
  name: "retry_pipeline_step",
  description: "Retry a failed pipeline step",
  inputSchema: {
    properties: {
      pipeline_id: { type: "string" },
      step_id: { type: "string" },
      override_config: {
        type: "object",
        description: "Optional config overrides for retry"
      }
    }
  }
}

{
  name: "resume_pipeline",
  description: "Resume a failed pipeline from last checkpoint",
  inputSchema: {
    properties: {
      checkpoint_id: { type: "string" }
    }
  }
}
```

#### Error Scenarios

| Error | Classification | Action |
|-------|----------------|--------|
| VRAM OOM | resource | Retry with lower settings |
| Network timeout | transient | Retry with backoff |
| Invalid prompt | validation | Abort, report to user |
| Model not found | permanent | Abort, report to user |
| ComfyUI crash | transient | Retry after reconnect |

#### Acceptance Criteria

- [ ] Automatic retry for transient errors
- [ ] Smart backoff between retries
- [ ] Checkpointing for long pipelines
- [ ] Resume from any checkpoint
- [ ] Clear error classification

---

## Example Complex Pipeline

```
User: "Create a 30-second anime music video of a cyberpunk city at night
       with synthwave music"

Pipeline Execution:
═══════════════════════════════════════════════════════════════════════

Step 1: Generate Keyframe
├── Model: IllustriousXL
├── Style: anime, cyberpunk
├── Output: keyframe.png (1280x720)
└── Duration: 3.2s

Step 2: Generate Video (parallel with Step 3)
├── Model: Wan 2.2 (anime-optimized)
├── Input: keyframe.png
├── Prompt: "camera slowly panning through neon-lit streets, rain,
│            flying cars, holographic advertisements"
├── Duration: 30s video
└── Time: 8m 45s

Step 3: Generate Music (parallel with Step 2)
├── Model: ACE-Step
├── Style: synthwave preset
├── Duration: 30s
└── Time: 15s

Step 4: Combine A/V
├── FFmpeg mux
├── Output: cyberpunk_mv.mp4
└── Duration: 2.1s

═══════════════════════════════════════════════════════════════════════
Total Time: 9m 5s (8m 45s video-bound)

Outputs:
  • Keyframe: /output/cyberpunk_keyframe.png
  • Video (no audio): /output/cyberpunk_video.mp4
  • Music: /output/cyberpunk_music.mp3
  • Final: /output/cyberpunk_mv.mp4
```

## Dependencies

- All individual modality implementations (EPIC-00 through EPIC-03)
- ComfyUI with all required custom nodes
- FFmpeg for A/V muxing
- Sufficient VRAM for parallel operations (or sequential fallback)

## Technical Notes

### VRAM Management

Pipelines need smart VRAM management:
- Sequential execution when VRAM constrained
- Model unloading between steps
- Parallel only when resources allow

### Output Management

- Unique pipeline IDs for artifact organization
- Intermediate outputs preserved
- Cleanup configurable (keep all, keep final, none)

### Timing Considerations

- Video generation dominates timing (~minutes)
- Image generation fast (~seconds)
- Music generation moderate (~10-30s)
- Plan parallel execution around video step
