# ComfyUI MCP Server - ControlNet UAT

## Overview

This UAT covers the newly implemented ControlNet functionality alongside the existing T2I capabilities. Run through each section to verify the implementation works correctly.

## Prerequisites

1. ComfyUI running at `http://localhost:8188` (or your configured URL)
2. At least one checkpoint model installed
3. For ControlNet tests: ControlNet models installed (optional but recommended)
4. For ControlNet tests: A reference image in ComfyUI's `input/` folder

---

## Part 1: Core T2I Generation (Existing Functionality)

### Test 1.1: Basic Text-to-Image
```
Use the generate_image tool:
- prompt: "a majestic dragon flying over a castle at sunset"
- output_path: "/tmp/uat/dragon.png"
- width: 768, height: 512

Expected: Image generated successfully, file saved to path
```

### Test 1.2: Image-to-Image
```
Use the img2img tool:
- prompt: "oil painting style"
- input_image: "dragon.png" (from test 1.1 - copy to ComfyUI input folder first)
- output_path: "/tmp/uat/dragon_painted.png"
- denoise: 0.6

Expected: Stylized version of the original image
```

### Test 1.3: Upscaling
```
Use the upscale_image tool:
- input_image: "dragon.png"
- output_path: "/tmp/uat/dragon_upscaled.png"

Expected: Higher resolution version of the image
```

### Test 1.4: List Models
```
Use list_models, list_samplers, list_schedulers, list_loras

Expected: JSON arrays of available options
```

---

## Part 2: ControlNet Generation (New Functionality)

### Test 2.1: List ControlNet Models
```
Use list_controlnet_models tool

Expected: JSON object with models categorized by type:
{
  "canny": ["control_v11p_sd15_canny..."],
  "depth": ["control_v11p_sd15_depth..."],
  ...
}
```

### Test 2.2: Single ControlNet (Canny Edge Detection)
```
Use controlnet_generate tool:
- prompt: "anime girl portrait"
- control_image: "reference.png" (a photo in input folder)
- control_type: "canny"
- strength: 0.8
- preprocess: true
- output_path: "/tmp/uat/canny_result.png"

Expected: Generated image following the edge structure of the reference
```

### Test 2.3: Single ControlNet (Depth)
```
Use controlnet_generate tool:
- prompt: "fantasy landscape with mountains"
- control_image: "reference.png"
- control_type: "depth"
- strength: 0.7
- preprocess: true
- output_path: "/tmp/uat/depth_result.png"

Expected: Generated image matching the depth/3D structure
```

### Test 2.4: OpenPose (Pose Matching)
```
Use pose_generate tool:
- prompt: "cyberpunk warrior in dynamic pose"
- pose_reference: "person_photo.png"
- copy_face: true
- copy_hands: true
- output_path: "/tmp/uat/pose_result.png"

Expected: Generated character matching the pose from reference
```

### Test 2.5: Style Transfer (Photo Stylization)
```
Use stylize_photo tool:
- source_image: "photo.jpg"
- style: "anime" (or "sketch", "oil_painting", "watercolor", "comic", "ghibli")
- preserve_detail: "medium"
- output_path: "/tmp/uat/stylized.png"

Expected: Photo converted to the specified artistic style
```

### Test 2.6: Hidden Image (QR Code ControlNet)
```
Use hidden_image_generate tool:
- prompt: "beautiful forest with hidden message"
- hidden_image: "qrcode.png" (high contrast B&W image)
- visibility: "subtle" (or "moderate", "obvious")
- output_path: "/tmp/uat/hidden.png"

Expected: Generated image with the QR code/pattern subtly embedded
```

### Test 2.7: Composition (Semantic Segmentation)
```
Use composition_generate tool:
- prompt: "a peaceful village scene"
- composition_reference: "layout.png"
- strength: 0.7
- output_path: "/tmp/uat/composition.png"

Expected: Generated image following the spatial composition of reference
```

### Test 2.8: Multi-ControlNet
```
Use multi_controlnet_generate tool:
- prompt: "elegant dancer in dramatic lighting"
- controls: [
    { "type": "openpose", "image": "pose.png", "strength": 0.9 },
    { "type": "canny", "image": "outline.png", "strength": 0.5 }
  ]
- preprocess: true
- output_path: "/tmp/uat/multi_control.png"

Expected: Generated image influenced by both pose AND edge structure
```

### Test 2.9: Preprocess Only (Debug/Preview)
```
Use controlnet_preprocess tool:
- input_image: "photo.png"
- control_type: "canny" (or "depth", "openpose", etc.)
- output_path: "/tmp/uat/canny_preview.png"

Expected: Preprocessed control signal image (edges, depth map, pose skeleton, etc.)
```

---

## Part 3: Advanced Features

### Test 3.1: LoRA Support with ControlNet
```
Use controlnet_generate tool with LoRAs:
- prompt: "stylized portrait"
- control_image: "reference.png"
- control_type: "canny"
- loras: [{ "name": "style_lora.safetensors", "strength_model": 0.8 }]
- output_path: "/tmp/uat/lora_controlnet.png"

Expected: ControlNet + LoRA both applied correctly
```

### Test 3.2: ControlNet Timing (Start/End Percent)
```
Use controlnet_generate tool:
- prompt: "fantasy character"
- control_image: "reference.png"
- control_type: "canny"
- start_percent: 0.2
- end_percent: 0.8
- output_path: "/tmp/uat/timed_control.png"

Expected: ControlNet influence limited to 20%-80% of generation steps
```

### Test 3.3: Imagine Pipeline (Natural Language)
```
Use imagine tool:
- description: "a cute fox girl sitting in a coffee shop, warm lighting, cozy atmosphere"
- quality: "high"
- style: "anime"
- output_path: "/tmp/uat/imagine_result.png"

Expected: Automatically crafted optimized prompt, hi-res fix applied
```

---

## Part 4: Error Handling

### Test 4.1: Missing Model
```
Use generate_image without model env var and no model parameter

Expected: Clear error "No model specified and COMFYUI_MODEL not set"
```

### Test 4.2: Invalid Control Type
```
Use controlnet_generate with control_type: "invalid"

Expected: Validation error from schema
```

### Test 4.3: Empty Controls Array
```
Use multi_controlnet_generate with controls: []

Expected: Error "At least one ControlNet configuration is required"
```

---

## Tool Reference

### Existing Tools (15)
| Tool | Description |
|------|-------------|
| `generate_image` | Text-to-image generation |
| `img2img` | Image-to-image transformation |
| `upscale_image` | AI upscaling with RealESRGAN etc. |
| `list_models` | List checkpoint models |
| `list_loras` | List LoRA models |
| `list_samplers` | List available samplers |
| `list_schedulers` | List available schedulers |
| `list_upscale_models` | List upscale models |
| `get_queue_status` | Get ComfyUI queue status |
| `craft_prompt` | Generate optimized prompts |
| `execute_pipeline` | Run txt2img → hires fix → upscale |
| `imagine` | Natural language generation |
| `analyze_model` | Detect model family |
| `detect_model_family` | Model family detection |
| `get_model_defaults` | Get model-specific defaults |

### New ControlNet Tools (8)
| Tool | Description |
|------|-------------|
| `controlnet_generate` | Single ControlNet generation |
| `multi_controlnet_generate` | Multiple ControlNets chained |
| `controlnet_preprocess` | Preview control signal |
| `hidden_image_generate` | QR Code / hidden image ControlNet |
| `stylize_photo` | Photo to art style transfer |
| `pose_generate` | OpenPose pose matching |
| `composition_generate` | Semantic segmentation control |
| `list_controlnet_models` | List available ControlNet models |

**Total: 23 MCP tools**

---

## Test Results

| Test | Pass/Fail | Notes |
|------|-----------|-------|
| 1.1 Basic T2I | | |
| 1.2 Img2Img | | |
| 1.3 Upscale | | |
| 1.4 List Models | | |
| 2.1 List ControlNet | | |
| 2.2 Canny ControlNet | | |
| 2.3 Depth ControlNet | | |
| 2.4 OpenPose | | |
| 2.5 Style Transfer | | |
| 2.6 Hidden Image | | |
| 2.7 Composition | | |
| 2.8 Multi-ControlNet | | |
| 2.9 Preprocess Only | | |
| 3.1 LoRA + ControlNet | | |
| 3.2 Start/End Timing | | |
| 3.3 Imagine Pipeline | | |
| 4.1 Missing Model | | |
| 4.2 Invalid Control | | |
| 4.3 Empty Controls | | |

---

## Notes

- ControlNet models need to be downloaded separately into ComfyUI's `models/controlnet/` folder
- Control images must be in ComfyUI's `input/` folder before use
- Multi-ControlNet chains up to 5 controls
- Preprocessing is automatic but can be disabled with `preprocess: false`
- Default strengths vary by control type (QR code uses 1.2, semantic seg uses 0.7, etc.)
