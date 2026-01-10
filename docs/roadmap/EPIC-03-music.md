# EPIC-03: Music Generation (ACE-Step)

**Priority**: 🟢 MEDIUM
**Batch**: 3
**Estimated Effort**: 1 week

## Overview

Add music generation capabilities using ACE-Step, enabling text-to-audio (T2A), audio-to-audio (A2A) style transfer, and LoRA-based genre customization. Complete the media generation loop by adding sound to images and videos.

## Why This Matters

Music generation completes the multimedia pipeline:
- **T2A**: Generate background music/scores from descriptions
- **A2A**: Transform existing audio to different styles
- **LoRA styles**: Generate music in specific genres/artist styles
- **Video + Music**: Auto-generate soundtracks for generated videos

Pipeline potential: `imagine_video` → `generate_music` → full video with soundtrack

## ACE-Step Modes

Based on the workflow files in Downloads:

| Mode | Input | Output | Use Case |
|------|-------|--------|----------|
| T2A | Text prompt | Audio | Create music from description |
| A2A | Audio + prompt | Audio | Style transfer on existing audio |
| LoRA | Text + LoRA | Audio | Genre-specific generation |

## Issues

### Issue #XX: ACE-Step Workflow Builder

**Type**: Feature
**Labels**: `enhancement`, `music`, `ace-step`

#### Description

Create workflow builders for ACE-Step audio generation:

```typescript
interface ACEStepParams {
  // Common
  prompt: string;         // Music description
  duration?: number;      // Duration in seconds (default: 30)
  seed?: number;

  // Generation settings
  steps?: number;         // default: 100
  cfg?: number;           // default: 3.0

  // For A2A
  inputAudio?: string;    // Path to input audio
  denoise?: number;       // 0.0-1.0, how much to change

  // LoRA
  loraName?: string;
  loraStrength?: number;

  // Output
  sampleRate?: number;    // default: 44100
  outputFormat?: "wav" | "mp3";
}

function buildACEStepT2AWorkflow(params: ACEStepParams): ComfyWorkflow;
function buildACEStepA2AWorkflow(params: ACEStepParams): ComfyWorkflow;
function buildACEStepLoRAWorkflow(params: ACEStepParams): ComfyWorkflow;
```

#### Key Nodes (from workflow analysis)

Based on `ace-step-v1-t2a.json`:
- `ACEStepModelLoader` - Load ACE-Step model
- `ACEStepTextEncoder` - Encode prompt
- `ACEStepSampler` - Generate audio latents
- `ACEStepDecode` - Decode to audio
- `SaveAudio` - Save output

#### Acceptance Criteria

- [ ] T2A workflow produces valid audio
- [ ] A2A workflow accepts input audio
- [ ] LoRA workflow applies style correctly
- [ ] Duration configurable (10-120 seconds)
- [ ] Output in WAV and MP3 formats

---

### Issue #XX: Music MCP Tools

**Type**: Feature
**Labels**: `enhancement`, `music`, `mcp`

#### Description

Add MCP tools for music generation:

```typescript
// Tool: generate_music
{
  name: "generate_music",
  description: "Generate music from a text description",
  inputSchema: {
    properties: {
      prompt: {
        type: "string",
        description: "Description of the music (genre, mood, instruments, tempo)"
      },
      output_path: {
        type: "string",
        description: "Where to save the audio file"
      },
      duration: {
        type: "number",
        default: 30,
        description: "Duration in seconds (10-120)"
      },
      format: {
        enum: ["wav", "mp3"],
        default: "mp3"
      },
      seed: {
        type: "number",
        description: "Seed for reproducibility"
      }
    },
    required: ["prompt", "output_path"]
  }
}

// Tool: transform_music
{
  name: "transform_music",
  description: "Transform existing audio to a different style",
  inputSchema: {
    properties: {
      prompt: {
        type: "string",
        description: "Target style description"
      },
      input_audio: {
        type: "string",
        description: "Path to input audio file"
      },
      output_path: { type: "string" },
      transformation_strength: {
        type: "number",
        default: 0.7,
        description: "How much to change (0=none, 1=complete)"
      }
    },
    required: ["prompt", "input_audio", "output_path"]
  }
}

// Tool: list_music_loras
{
  name: "list_music_loras",
  description: "List available music style LoRAs"
}
```

#### Acceptance Criteria

- [ ] `generate_music` produces valid audio
- [ ] `transform_music` preserves some input characteristics
- [ ] LoRA style application works
- [ ] Duration limits enforced
- [ ] Format conversion works (WAV↔MP3)

---

### Issue #XX: Music Style Presets

**Type**: Feature
**Labels**: `enhancement`, `music`

#### Description

Add high-level style presets for common use cases:

```typescript
const MUSIC_PRESETS = {
  "ambient_background": {
    prompt_prefix: "ambient, atmospheric, background music,",
    cfg: 2.5,
    steps: 80
  },
  "cinematic_score": {
    prompt_prefix: "cinematic orchestral score, epic,",
    cfg: 3.5,
    steps: 100
  },
  "lo_fi_beats": {
    prompt_prefix: "lo-fi hip hop, chill beats, relaxing,",
    cfg: 3.0,
    steps: 100
  },
  "electronic_edm": {
    prompt_prefix: "electronic dance music, EDM, energetic,",
    cfg: 3.5,
    steps: 120
  },
  "acoustic_folk": {
    prompt_prefix: "acoustic folk music, guitar, warm,",
    cfg: 3.0,
    steps: 100
  }
};

// Usage in tool:
{
  name: "generate_music",
  inputSchema: {
    properties: {
      style_preset: {
        enum: ["ambient_background", "cinematic_score", "lo_fi_beats", ...],
        description: "Predefined style (or use custom prompt)"
      },
      prompt: {
        description: "Custom description (combined with preset if both provided)"
      }
    }
  }
}
```

#### Acceptance Criteria

- [ ] Presets produce genre-appropriate output
- [ ] Custom prompts can override/extend presets
- [ ] Settings optimized for each genre

---

### Issue #XX: Video + Music Pipeline

**Type**: Feature
**Labels**: `enhancement`, `music`, `pipeline`

#### Description

Create pipeline for generating video with soundtrack:

```typescript
interface VideoWithMusicParams {
  // Video params
  videoPrompt: string;
  videoDuration: number;  // seconds

  // Music params
  musicPrompt?: string;      // Auto-generates from video prompt if not provided
  musicStyle?: string;       // Preset name

  // Output
  outputPath: string;        // .mp4 with embedded audio
  separateAudio?: boolean;   // Also save .mp3 separately
}

async function generateVideoWithMusic(
  client: ComfyUIClient,
  params: VideoWithMusicParams
): Promise<{
  videoPath: string;
  audioPath?: string;
  duration: number;
}>;
```

#### Workflow

1. Generate video (T2V or I2V)
2. Generate music (duration matches video)
3. Combine video + audio using FFmpeg
4. Output final video with soundtrack

#### Acceptance Criteria

- [ ] Video and audio durations match
- [ ] Audio embedded in output video
- [ ] Optional separate audio file
- [ ] Music style appropriate for video content

---

## Prompt Engineering for Music

ACE-Step responds well to specific prompts:

### Good Prompts

```
"Upbeat electronic dance music with synth leads, driving bass, 128 BPM, energetic"

"Soft acoustic guitar melody, fingerpicking style, warm and intimate, 80 BPM"

"Cinematic orchestral score, strings and brass, building tension, epic climax"

"Lo-fi hip hop beat, vinyl crackle, mellow piano chords, relaxing vibe"
```

### Prompt Components

| Component | Examples |
|-----------|----------|
| Genre | electronic, jazz, classical, hip hop, rock |
| Mood | energetic, relaxing, tense, happy, melancholic |
| Instruments | piano, guitar, drums, synth, strings, brass |
| Tempo | 60 BPM (slow), 120 BPM (moderate), 180 BPM (fast) |
| Style | ambient, cinematic, lo-fi, epic, minimalist |

---

## Example Usage

```
User: "Generate some chill background music for a coding stream"

Claude: [Uses generate_music with lo_fi_beats preset]

Generated 30 seconds of lo-fi hip hop at /path/to/output.mp3.
Seed: 12345 (use this to regenerate the same track)

---

User: "Take this rock song and make it sound more jazzy"

Claude: [Uses transform_music with jazz style prompt]

---

User: "Create a video of a sunset and add relaxing music"

Claude: [Uses generateVideoWithMusic pipeline]
- Generated 10-second sunset video
- Created ambient background music
- Combined into final video with soundtrack
```

## Required Models

| Model | Size | Location |
|-------|------|----------|
| ACE-Step base | ~2GB | `models/ace-step/` |
| ACE-Step LoRAs | ~100MB each | `models/ace-step/loras/` |

## Technical Notes

### Audio Generation Time

- ~10 seconds to generate 30 seconds of audio
- Faster than video generation
- CPU fallback available (slower)

### VRAM Usage

- ~4GB minimum
- Can run on CPU with longer generation time

### Audio Quality

- Native: 44.1kHz, 16-bit
- Supports: mono and stereo output
- Format: WAV native, MP3 via conversion

## Dependencies

- ACE-Step ComfyUI nodes
- FFmpeg (for format conversion and video muxing)
- Optional: Audio LoRAs for specific styles
