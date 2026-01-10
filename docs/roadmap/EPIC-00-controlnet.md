# EPIC-00: ControlNet Support for SD1.5

**Priority**: 🔴 HIGH
**Batch**: Pre-requisite / Foundation
**Estimated Effort**: 1-2 weeks

## Overview

Add comprehensive ControlNet support for SD1.5 models, enabling precise control over image generation through multiple control methods: edge detection (Canny), depth maps, pose estimation (OpenPose), hidden images (QR Code), style transfer (Scribble/Lineart), and composition control (Semantic Segmentation). This is foundational for character consistency, cross-modal pipelines, and creative image manipulation.

## Why This Matters

ControlNet transforms "I want an image" into "I want THIS specific composition/pose/style." Without it:
- Character consistency across frames is impossible
- Pose-matching for animations requires manual work
- Depth-guided generation for scenes isn't available
- Real photo stylization is hit-or-miss with img2img
- Hidden watermarks/images require manual compositing

With it:
- Generate consistent characters from reference poses
- Match compositions across image series
- Guide video generation with structural constraints
- Stylize real photos into anime/artistic versions
- Embed hidden images (logos, QR codes, watermarks)
- Control scene composition while allowing creative freedom

## ControlNet Types Overview

| Type | Use Case | Preprocessor | Reference Image Format |
|------|----------|--------------|------------------------|
| **Canny** | Edge-guided generation | `Canny` | White edges on black |
| **Depth** | 3D-aware composition | `DepthAnything` / `MiDaS` | Grayscale depth map |
| **OpenPose** | Character poses | `DWPreprocessor` | Colored stick figure |
| **QR Code** | Hidden images | None (direct input) | High contrast B&W |
| **Scribble/Lineart** | Style transfer | `AnyLine Lineart` | Line drawing |
| **Semantic Seg** | Scene composition | `OneFormer ADE20K` | Color-coded regions |

## Issues

### Issue #XX: ControlNet Workflow Builder - Core Types

**Type**: Feature
**Labels**: `enhancement`, `controlnet`, `high-priority`

#### Description

Create workflow builder functions for core ControlNet types (Canny, Depth, OpenPose):

```typescript
type ControlNetType =
  | "canny"
  | "depth"
  | "openpose"
  | "qrcode"
  | "scribble"
  | "lineart"
  | "semantic_seg";

interface ControlNetConfig {
  type: ControlNetType;
  image: string;              // Input image for control
  strength: number;           // 0.0-2.0 (can go above 1.0 for stronger effect)
  startPercent?: number;      // When to start applying (0.0-1.0)
  endPercent?: number;        // When to stop applying (0.0-1.0)

  // Type-specific options
  preprocessorOptions?: {
    // Canny
    lowThreshold?: number;    // default: 100
    highThreshold?: number;   // default: 200

    // OpenPose (DWPreprocessor)
    detectBody?: boolean;     // default: true
    detectFace?: boolean;     // default: true
    detectHands?: boolean;    // default: true

    // Lineart
    objectMinSize?: number;   // default: 35, increase to filter noise

    // Semantic Seg - no special options
  };
}

function buildControlNetWorkflow(params: {
  prompt: string;
  negativePrompt?: string;
  controlNets: ControlNetConfig[];  // Support multiple
  model: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
}): ComfyWorkflow;
```

#### Key ComfyUI Nodes

Core nodes:
- `ControlNetLoader` - Load the control model
- `ControlNetApplyAdvanced` - Apply with strength/timing

Preprocessor nodes (from ComfyUI Controlnet Aux):
- `Canny` - Edge detection
- `DepthAnythingPreprocessor` - Depth map extraction
- `DWPreprocessor` - OpenPose detection (body/face/hands)
- `AnyLineArtPreprocessor` - Lineart/scribble extraction
- `OneFormer-ADE20K-SemSeg` - Semantic segmentation

#### Acceptance Criteria

- [ ] Single ControlNet workflow (Canny)
- [ ] Single ControlNet workflow (Depth)
- [ ] Single ControlNet workflow (OpenPose)
- [ ] Multi-ControlNet workflow (combine 2-3)
- [ ] Strength and timing controls work correctly
- [ ] Tests for each control type

---

### Issue #XX: QR Code ControlNet - Hidden Images

**Type**: Feature
**Labels**: `enhancement`, `controlnet`, `creative`

#### Description

Implement QR Code ControlNet for embedding hidden images. This is one of the most fun controlnets - it embeds a high-contrast reference image "invisibly" into the generated output.

```typescript
interface QRCodeControlConfig {
  hiddenImage: string;        // Path to B&W high contrast image
  strength?: number;          // default: 1.0, try 1.25 for more visible
  // No preprocessor needed - direct input
}

// MCP Tool
{
  name: "generate_with_hidden_image",
  description: "Generate an image with a hidden image embedded (like a watermark or secret symbol)",
  inputSchema: {
    properties: {
      prompt: { type: "string" },
      hidden_image: {
        type: "string",
        description: "Path to high-contrast B&W image to hide"
      },
      output_path: { type: "string" },
      visibility: {
        enum: ["subtle", "moderate", "obvious"],
        default: "subtle",
        description: "How visible the hidden image should be"
      }
    },
    required: ["prompt", "hidden_image", "output_path"]
  }
}
```

#### How It Works

1. User provides a high-contrast (ideally B&W) reference image
2. QR Code controlnet guides generation to incorporate that shape
3. Result: hidden image visible when you "unfocus" or view from distance
4. Original use: embedding scannable QR codes
5. Creative use: hidden logos, symbols, faces, patterns

#### Example

```
User: "Create a city night scene with my company logo hidden in it"

Claude: [Uses generate_with_hidden_image]
- Loads company logo (B&W version)
- Generates city scene
- Logo subtly embedded in light/shadow patterns

Result: Normal-looking city scene, but step back and the logo appears!
```

#### Acceptance Criteria

- [ ] QR Code controlnet workflow working
- [ ] Strength maps to visibility presets
- [ ] Works with any high-contrast input image
- [ ] Optional: QR code generator for actual scannable codes

---

### Issue #XX: Scribble/Lineart ControlNet - Style Transfer

**Type**: Feature
**Labels**: `enhancement`, `controlnet`, `style-transfer`

#### Description

Implement Scribble/Lineart ControlNet for stylizing real photos. This extracts line art from a photo and uses it to guide generation in a different style.

```typescript
interface ScribbleControlConfig {
  sourceImage: string;        // Real photo to stylize
  style: string;              // Target style (prompt will include this)
  objectMinSize?: number;     // Filter noise (default: 35, increase for cleaner)
}

// MCP Tool
{
  name: "stylize_photo",
  description: "Transform a real photo into an artistic style (anime, painting, etc.) while preserving composition",
  inputSchema: {
    properties: {
      source_image: {
        type: "string",
        description: "Path to photo to stylize"
      },
      style: {
        enum: ["anime", "oil_painting", "watercolor", "comic", "sketch", "ghibli"],
        description: "Target artistic style"
      },
      prompt: {
        type: "string",
        description: "Additional description (optional, enhances the style)"
      },
      output_path: { type: "string" },
      preserve_detail: {
        enum: ["low", "medium", "high"],
        default: "medium",
        description: "How closely to follow the original lines"
      }
    },
    required: ["source_image", "style", "output_path"]
  }
}
```

#### How It Works

1. Load source photo (real photo)
2. Run through `AnyLineArtPreprocessor` to extract line art
3. Use Scribble controlnet with extracted lines
4. Generate with style-appropriate prompt and checkpoint
5. Result: Artistic version that maintains composition

#### Example (from book)

```
Source: Photo of a crow on a balcony
Style: anime
Checkpoint: Anything v5

Result: Anime-style crow in same pose/composition
(Fixed 3-leg problem by increasing objectMinSize from 35 to 100)
```

#### Acceptance Criteria

- [ ] Lineart extraction working
- [ ] Style presets with appropriate prompts
- [ ] objectMinSize configurable (fixes limb count issues)
- [ ] Works with various photo types
- [ ] Preview of extracted lineart available

---

### Issue #XX: OpenPose ControlNet - Pose Matching

**Type**: Feature
**Labels**: `enhancement`, `controlnet`, `poses`

#### Description

Implement OpenPose ControlNet for exact pose matching. Extract pose from reference image and apply to new generation.

```typescript
interface OpenPoseControlConfig {
  referenceImage: string;     // Image with pose to copy
  detectBody?: boolean;       // default: true
  detectFace?: boolean;       // default: true
  detectHands?: boolean;      // default: true
}

// MCP Tool
{
  name: "generate_with_pose",
  description: "Generate a character matching the exact pose from a reference image",
  inputSchema: {
    properties: {
      prompt: { type: "string", description: "Character/scene description" },
      pose_reference: {
        type: "string",
        description: "Image with the pose to copy"
      },
      output_path: { type: "string" },
      copy_face: {
        type: "boolean",
        default: true,
        description: "Also match facial expression"
      },
      copy_hands: {
        type: "boolean",
        default: true,
        description: "Also match hand positions"
      }
    },
    required: ["prompt", "pose_reference", "output_path"]
  }
}
```

#### How It Works

1. Load reference image with desired pose
2. Run through `DWPreprocessor` to extract pose skeleton
3. Colored stick figure shows body/face/hand positions
4. Use OpenPose controlnet with extracted skeleton
5. Generate new character in exact same pose

#### Example (from book)

```
Reference: Statue of Patanjali meditating
Prompt: "cyberpunk ninja meditating in lotus position surrounded by scifi garden"

Result: Completely different character but EXACT same meditation pose
```

#### Acceptance Criteria

- [ ] DWPreprocessor integration working
- [ ] Toggle body/face/hands independently
- [ ] Preview of extracted pose skeleton
- [ ] Works with various pose complexities
- [ ] Handles partial poses (seated, cropped, etc.)

---

### Issue #XX: Semantic Segmentation ControlNet - Composition Control

**Type**: Feature
**Labels**: `enhancement`, `controlnet`, `composition`

#### Description

Implement Semantic Segmentation ControlNet for composition control without exact replication. This identifies WHAT objects are WHERE without dictating exact appearance.

```typescript
interface SemanticSegControlConfig {
  referenceImage: string;     // Image with composition to copy
  // Segments image into 150 object types (trees, buildings, sky, etc.)
}

// MCP Tool
{
  name: "generate_with_composition",
  description: "Generate an image with the same general composition/layout as a reference, but creative freedom in details",
  inputSchema: {
    properties: {
      prompt: { type: "string", description: "What to generate" },
      composition_reference: {
        type: "string",
        description: "Image with composition to match"
      },
      output_path: { type: "string" }
    },
    required: ["prompt", "composition_reference", "output_path"]
  }
}
```

#### How It Works

1. Load reference image
2. Run through `OneFormer-ADE20K-SemSeg` preprocessor
3. Creates color-coded map: trees=green, sky=blue, buildings=gray, etc.
4. Model knows "trees go here, sky goes there" but creates new trees/sky
5. Result: Same composition, completely different details

#### Example (from book)

```
Reference: Spring street with cherry blossoms
Prompt: "neighborhood sidewalk with beautiful trees and leaves falling"

Result: Autumn scene with falling leaves, same tree/sidewalk layout
        but completely reimagined details
```

#### Color Coding Reference

The segmentation uses 150 object classes. Key ones:
- Trees/vegetation: various greens
- Sky: light blue
- Buildings: grays
- Roads/sidewalks: dark grays
- People: specific colors per body part
- Water: blues

Full reference: [ADE20K Color Coding](https://docs.google.com/spreadsheets/d/1se8YEtb2detS7OuPE86fXGyD269pMycAWe2mtKUj2W8)

#### Acceptance Criteria

- [ ] OneFormer segmentation working
- [ ] Preview of segmentation map
- [ ] Works with complex scenes
- [ ] Optional: Manual composition painting tool

---

### Issue #XX: ControlNet MCP Tools - Unified Interface

**Type**: Feature
**Labels**: `enhancement`, `controlnet`, `mcp`

#### Description

Add unified MCP tools that handle all ControlNet types:

```typescript
// Unified tool for any control type
{
  name: "generate_with_control",
  description: "Generate an image guided by a control image",
  inputSchema: {
    properties: {
      prompt: { type: "string" },
      control_image: { type: "string" },
      control_type: {
        enum: ["canny", "depth", "openpose", "qrcode", "scribble", "semantic_seg"],
        description: "Type of control to apply"
      },
      strength: { type: "number", default: 1.0 },
      output_path: { type: "string" },

      // Auto-preprocessing
      preprocess: {
        type: "boolean",
        default: true,
        description: "Automatically preprocess the control image"
      }
    },
    required: ["prompt", "control_image", "control_type", "output_path"]
  }
}

// Multi-control for complex compositions
{
  name: "generate_with_multi_control",
  description: "Generate with multiple control conditions (e.g., pose + depth)",
  inputSchema: {
    properties: {
      prompt: { type: "string" },
      controls: {
        type: "array",
        items: {
          type: "object",
          properties: {
            image: { type: "string" },
            type: { enum: ["canny", "depth", "openpose", "qrcode", "scribble", "semantic_seg"] },
            strength: { type: "number", default: 1.0 }
          }
        },
        description: "Multiple control conditions to combine"
      },
      output_path: { type: "string" }
    },
    required: ["prompt", "controls", "output_path"]
  }
}

// Preprocess only (for inspection)
{
  name: "preprocess_control_image",
  description: "Run preprocessing on an image to see the control signal",
  inputSchema: {
    properties: {
      image: { type: "string" },
      type: { enum: ["canny", "depth", "openpose", "scribble", "semantic_seg"] },
      output_path: { type: "string" }
    },
    required: ["image", "type", "output_path"]
  }
}
```

#### Acceptance Criteria

- [ ] Unified `generate_with_control` working for all types
- [ ] Multi-control combinations working
- [ ] Preprocessing preview tool working
- [ ] Auto-preprocessing enabled by default
- [ ] Integration with `imagine` tool via optional `control` param

---

### Issue #XX: ControlNet Model Management

**Type**: Feature
**Labels**: `enhancement`, `controlnet`, `models`

#### Description

Add tools for listing and verifying ControlNet models:

```typescript
{
  name: "list_controlnet_models",
  description: "List available ControlNet models by type"
}

// Returns:
{
  "canny": ["control_v11p_sd15_canny_fp16.safetensors"],
  "depth": ["control_v11f1p_sd15_depth_fp16.safetensors"],
  "openpose": ["control_v11p_sd15_openpose_fp16.safetensors"],
  "qrcode": ["control_v1p_sd15_qrcode.safetensors"],
  "scribble": ["control_v11p_sd15_scribble_fp16.safetensors"],
  "semantic_seg": ["control_v11p_sd15_seg_fp16.safetensors"],
  "lineart": ["control_v11p_sd15_lineart_fp16.safetensors"]
}
```

#### Acceptance Criteria

- [ ] List available ControlNet models by type
- [ ] Auto-detect model type from filename
- [ ] Warn if requested control type has no model
- [ ] Model download suggestions for missing types

---

## Required Models

| Type | Model File | Size | Source |
|------|------------|------|--------|
| Canny | `control_v11p_sd15_canny_fp16.safetensors` | ~700MB | comfyanonymous |
| Depth | `control_v11f1p_sd15_depth_fp16.safetensors` | ~700MB | comfyanonymous |
| OpenPose | `control_v11p_sd15_openpose_fp16.safetensors` | ~700MB | comfyanonymous |
| QR Code | `control_v1p_sd15_qrcode.safetensors` | ~1.4GB | DionTimmer |
| Scribble | `control_v11p_sd15_scribble_fp16.safetensors` | ~700MB | comfyanonymous |
| Lineart | `control_v11p_sd15_lineart_fp16.safetensors` | ~700MB | comfyanonymous |
| Semantic Seg | `control_v11p_sd15_seg_fp16.safetensors` | ~700MB | comfyanonymous |

**Download Sources:**
- FP16 versions: https://huggingface.co/comfyanonymous/ControlNet-v1-1_fp16_safetensors
- QR Code: https://huggingface.co/DionTimmer/controlnet_qrcode-control_v1p_sd15

## Required Custom Nodes

**ComfyUI Controlnet Aux** - Install via ComfyUI Manager
- GitHub: https://github.com/Fannovel16/comfyui_controlnet_aux
- Provides all preprocessor nodes
- One-click install from Manager UI

## Example Usage

```
User: "Generate a character in the same pose as this reference image"
Claude: [Uses generate_with_control with openpose]

User: "Now make variations with the same composition but different styles"
Claude: [Uses generate_with_control with semantic_seg, iterating styles]

User: "Turn this photo of my cat into a Studio Ghibli style"
Claude: [Uses stylize_photo with style: ghibli]

User: "Create an image with my logo hidden in it"
Claude: [Uses generate_with_hidden_image with the logo]

User: "Generate a character with this pose AND this depth map"
Claude: [Uses generate_with_multi_control combining openpose + depth]
```

## Recommended Checkpoints

For best results with SD1.5 ControlNets:
- **CyberRealistic v9** - Realistic photos
- **Anything v5** - Anime style (use with VAE: vae-ft-mse-840000-ema-pruned)

## Technical Notes

### Strength Guidelines

| Type | Subtle | Normal | Strong |
|------|--------|--------|--------|
| Canny | 0.5 | 0.8 | 1.0 |
| Depth | 0.5 | 0.8 | 1.0 |
| OpenPose | 0.8 | 1.0 | 1.2 |
| QR Code | 0.8 | 1.0 | 1.25 |
| Scribble | 0.6 | 0.8 | 1.0 |
| Semantic Seg | 0.5 | 0.7 | 0.9 |

### Common Issues & Fixes

1. **Extra limbs with Scribble**: Increase `objectMinSize` in preprocessor
2. **QR Code too subtle**: Increase strength to 1.25
3. **Pose not matching hands**: Enable `detectHands` in DWPreprocessor
4. **Semantic seg too rigid**: Lower strength to 0.5-0.6

## Dependencies

- ComfyUI with ControlNet nodes (built-in)
- ComfyUI Controlnet Aux (install via Manager)
- SD1.5 checkpoint model
- ControlNet model files (see Required Models)
- Optional: Custom VAE for anime checkpoints
