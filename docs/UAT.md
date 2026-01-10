# ComfyUI MCP Server - User Acceptance Testing (UAT)

This document provides comprehensive testing instructions for manually validating the ComfyUI MCP server functionality.

## Prerequisites

1. **ComfyUI Running**: ComfyUI must be running and accessible (default: `http://localhost:8188`)
2. **MCP Client**: Claude Code or another MCP client configured to use this server
3. **Models Installed**: At least one checkpoint model in ComfyUI
4. **Output Directory**: Writable directory for generated images

## Environment Setup

```bash
# Clone and install
git clone <repo-url>
cd comfyui-mcp
npm install
npm run build

# Configure environment
export COMFYUI_URL="http://localhost:8188"        # Your ComfyUI URL
export COMFYUI_MODEL="dreamshaper_8.safetensors"  # Default model (optional)
export COMFYUI_OUTPUT_DIR="/tmp/comfyui-output"   # Output directory
```

## MCP Client Configuration

Add to your Claude Code configuration:

```json
{
  "mcpServers": {
    "comfyui": {
      "command": "node",
      "args": ["/path/to/comfyui-mcp/dist/index.js"],
      "env": {
        "COMFYUI_URL": "http://localhost:8188",
        "COMFYUI_MODEL": "dreamshaper_8.safetensors",
        "COMFYUI_OUTPUT_DIR": "/tmp/comfyui-output"
      }
    }
  }
}
```

---

## Test Cases

### 1. Connection & Discovery Tests

#### TC-1.1: List Available Models
**Tool**: `list_models`
**Input**: None
**Expected**: JSON array of checkpoint model filenames
```
✅ PASS: Returns array with at least one model
❌ FAIL: Empty array or error
```

#### TC-1.2: List Available LoRAs
**Tool**: `list_loras`
**Input**: None
**Expected**: JSON array of LoRA filenames (may be empty)
```
✅ PASS: Returns array (empty is OK if no LoRAs installed)
❌ FAIL: Error response
```

#### TC-1.3: List Samplers
**Tool**: `list_samplers`
**Input**: None
**Expected**: Array including standard samplers (euler, euler_ancestral, dpm++, etc.)
```
✅ PASS: Returns array with common samplers
❌ FAIL: Empty or error
```

#### TC-1.4: List Schedulers
**Tool**: `list_schedulers`
**Input**: None
**Expected**: Array including schedulers (normal, karras, exponential, etc.)
```
✅ PASS: Returns array with schedulers
❌ FAIL: Empty or error
```

#### TC-1.5: List Upscale Models
**Tool**: `list_upscale_models`
**Input**: None
**Expected**: Array of upscale models (RealESRGAN_x4plus.pth, etc.)
```
✅ PASS: Returns array (may be empty)
❌ FAIL: Error response
```

#### TC-1.6: Get Queue Status
**Tool**: `get_queue_status`
**Input**: None
**Expected**: JSON with queue_running and queue_pending counts
```
✅ PASS: Returns queue status object
❌ FAIL: Error or malformed response
```

---

### 2. Basic Image Generation Tests

#### TC-2.1: Simple Text-to-Image
**Tool**: `generate_image`
**Input**:
```json
{
  "prompt": "a beautiful sunset over the ocean",
  "output_path": "/tmp/test/tc-2-1.png",
  "width": 512,
  "height": 768,
  "steps": 20
}
```
**Expected**: Image saved to specified path
```
✅ PASS: File exists at output_path, is valid PNG
❌ FAIL: No file created or error
```

#### TC-2.2: With Negative Prompt
**Tool**: `generate_image`
**Input**:
```json
{
  "prompt": "a professional portrait photo",
  "negative_prompt": "blurry, distorted, bad anatomy",
  "output_path": "/tmp/test/tc-2-2.png"
}
```
**Expected**: Image without artifacts
```
✅ PASS: File created, visually cleaner than without negative
❌ FAIL: No file or error
```

#### TC-2.3: With Specific Model
**Tool**: `generate_image`
**Input**:
```json
{
  "prompt": "anime girl with blue hair",
  "model": "<your-anime-model>.safetensors",
  "output_path": "/tmp/test/tc-2-3.png"
}
```
**Expected**: Anime-style image
```
✅ PASS: Style matches model capabilities
❌ FAIL: Wrong style or error
```

#### TC-2.4: With LoRA
**Tool**: `generate_image`
**Input**:
```json
{
  "prompt": "a detailed portrait",
  "loras": [{"name": "<your-lora>.safetensors", "strength_model": 0.8, "strength_clip": 0.8}],
  "output_path": "/tmp/test/tc-2-4.png"
}
```
**Expected**: Style influenced by LoRA
```
✅ PASS: LoRA effect visible in output
❌ FAIL: No effect or error
```

#### TC-2.5: Reproducibility with Seed
**Tool**: `generate_image` (run twice)
**Input**:
```json
{
  "prompt": "a red car",
  "seed": 12345,
  "output_path": "/tmp/test/tc-2-5-a.png"
}
```
Then again with same seed to `/tmp/test/tc-2-5-b.png`
**Expected**: Identical images
```
✅ PASS: Files are byte-identical (or visually identical)
❌ FAIL: Different images
```

---

### 3. Image-to-Image Tests

#### TC-3.1: Basic Img2Img
**Prerequisite**: Upload an image to ComfyUI input folder or use previous output
**Tool**: `img2img`
**Input**:
```json
{
  "prompt": "turn into oil painting style",
  "input_image": "tc-2-1.png",
  "denoise": 0.6,
  "output_path": "/tmp/test/tc-3-1.png"
}
```
**Expected**: Modified version of input image
```
✅ PASS: Output shows oil painting style while retaining composition
❌ FAIL: Completely different image or error
```

#### TC-3.2: Low Denoise (Preserve Original)
**Tool**: `img2img`
**Input**:
```json
{
  "prompt": "enhance details",
  "input_image": "tc-2-1.png",
  "denoise": 0.2,
  "output_path": "/tmp/test/tc-3-2.png"
}
```
**Expected**: Very similar to input with minor enhancement
```
✅ PASS: Image barely changed
❌ FAIL: Drastically different
```

#### TC-3.3: High Denoise (Major Change)
**Tool**: `img2img`
**Input**:
```json
{
  "prompt": "futuristic cyberpunk city",
  "input_image": "tc-2-1.png",
  "denoise": 0.9,
  "output_path": "/tmp/test/tc-3-3.png"
}
```
**Expected**: Major transformation
```
✅ PASS: Cyberpunk style, heavily modified
❌ FAIL: Too similar to original
```

---

### 4. Upscaling Tests

#### TC-4.1: Basic Upscale
**Tool**: `upscale_image`
**Input**:
```json
{
  "input_image": "tc-2-1.png",
  "output_path": "/tmp/test/tc-4-1.png"
}
```
**Expected**: 4x larger image
```
✅ PASS: Output dimensions are 4x input
❌ FAIL: Same size or error
```

#### TC-4.2: With Target Dimensions
**Tool**: `upscale_image`
**Input**:
```json
{
  "input_image": "tc-2-1.png",
  "target_width": 1920,
  "target_height": 1080,
  "output_path": "/tmp/test/tc-4-2.png"
}
```
**Expected**: Image at exactly 1920x1080
```
✅ PASS: Correct dimensions
❌ FAIL: Wrong size
```

---

### 5. Prompt Engineering Tests

#### TC-5.1: Craft Prompt - Illustrious
**Tool**: `craft_prompt`
**Input**:
```json
{
  "description": "a girl with cat ears sitting in a garden",
  "model_family": "illustrious",
  "style": "anime"
}
```
**Expected**: Prompt with quality tags (masterpiece, best quality, etc.)
```
✅ PASS: Contains "masterpiece", "best quality", tag-based format
❌ FAIL: Missing quality tags
```

#### TC-5.2: Craft Prompt - Pony
**Tool**: `craft_prompt`
**Input**:
```json
{
  "description": "a fantasy warrior",
  "model_family": "pony",
  "rating": "safe"
}
```
**Expected**: Prompt with score tags
```
✅ PASS: Contains "score_9", "score_8_up", "rating_safe"
❌ FAIL: Missing score tags
```

#### TC-5.3: Craft Prompt - Flux
**Tool**: `craft_prompt`
**Input**:
```json
{
  "description": "a peaceful mountain landscape",
  "model_family": "flux"
}
```
**Expected**: Natural language prompt, NO negative prompt
```
✅ PASS: Sentence-style prompt, negative is empty
❌ FAIL: Tag-based or has negative prompt
```

#### TC-5.4: Craft Prompt - Realistic
**Tool**: `craft_prompt`
**Input**:
```json
{
  "description": "professional headshot of a businesswoman",
  "model_family": "realistic",
  "camera_focal_length": "85mm",
  "camera_aperture": "f/1.4"
}
```
**Expected**: Prompt with camera terminology
```
✅ PASS: Contains "85mm", "f/1.4", "RAW photo"
❌ FAIL: Missing camera terms
```

#### TC-5.5: Get Prompting Guide
**Tool**: `get_prompting_guide`
**Input**:
```json
{
  "model_family": "illustrious"
}
```
**Expected**: Tips and example prompt
```
✅ PASS: Returns tips array and examplePrompt
❌ FAIL: Empty or error
```

#### TC-5.6: List Prompting Strategies
**Tool**: `list_prompting_strategies`
**Input**: None
**Expected**: All 6 model families listed
```
✅ PASS: Contains illustrious, pony, flux, sdxl, realistic, sd15
❌ FAIL: Missing families
```

---

### 6. Pipeline Tests

#### TC-6.1: Pipeline - txt2img Only
**Tool**: `execute_pipeline`
**Input**:
```json
{
  "prompt": "a majestic dragon",
  "model": "<your-model>.safetensors",
  "output_path": "/tmp/test/tc-6-1.png",
  "enable_hires_fix": false,
  "enable_upscale": false
}
```
**Expected**: Single-step pipeline
```
✅ PASS: steps contains only "txt2img"
❌ FAIL: More steps or error
```

#### TC-6.2: Pipeline - With Hi-Res Fix
**Tool**: `execute_pipeline`
**Input**:
```json
{
  "prompt": "detailed character portrait",
  "model": "<your-model>.safetensors",
  "output_path": "/tmp/test/tc-6-2.png",
  "enable_hires_fix": true,
  "hires_denoise": 0.4,
  "enable_upscale": false
}
```
**Expected**: Two-step pipeline
```
✅ PASS: steps contains "txt2img" and "hires_fix"
❌ FAIL: Missing hires_fix step
```

#### TC-6.3: Pipeline - Full (txt2img + hires + upscale)
**Tool**: `execute_pipeline`
**Input**:
```json
{
  "prompt": "epic landscape panorama",
  "model": "<your-model>.safetensors",
  "output_path": "/tmp/test/tc-6-3.png",
  "enable_hires_fix": true,
  "enable_upscale": true
}
```
**Expected**: Three-step pipeline, large output
```
✅ PASS: steps contains all 3, output is high resolution
❌ FAIL: Missing steps or small output
```

---

### 7. Imagine Tool Tests (The Main Event!)

#### TC-7.1: Imagine - Basic
**Tool**: `imagine`
**Input**:
```json
{
  "description": "A cozy coffee shop interior with warm lighting and plants",
  "output_path": "/tmp/test/tc-7-1.png"
}
```
**Expected**: High-quality image, auto-detected model family
```
✅ PASS: Image generated, modelFamily in response
❌ FAIL: Error or no model detection
```

#### TC-7.2: Imagine - With Style
**Tool**: `imagine`
**Input**:
```json
{
  "description": "A samurai warrior in battle",
  "output_path": "/tmp/test/tc-7-2.png",
  "style": "anime"
}
```
**Expected**: Anime-styled output
```
✅ PASS: Anime style visible
❌ FAIL: Realistic or wrong style
```

#### TC-7.3: Imagine - Quality Presets
**Tool**: `imagine` (test each quality level)

**Draft** (fast):
```json
{
  "description": "quick test image",
  "output_path": "/tmp/test/tc-7-3-draft.png",
  "quality": "draft"
}
```
**Expected**: Fast generation, txt2img only

**High** (hi-res fix):
```json
{
  "description": "detailed portrait",
  "output_path": "/tmp/test/tc-7-3-high.png",
  "quality": "high"
}
```
**Expected**: txt2img + hires_fix

**Ultra** (full pipeline):
```json
{
  "description": "epic landscape",
  "output_path": "/tmp/test/tc-7-3-ultra.png",
  "quality": "ultra"
}
```
**Expected**: txt2img + hires_fix + upscale
```
✅ PASS: Each quality level produces expected pipeline
❌ FAIL: Wrong pipeline steps
```

#### TC-7.4: Imagine - Artist Reference
**Tool**: `imagine`
**Input**:
```json
{
  "description": "A mystical forest",
  "output_path": "/tmp/test/tc-7-4.png",
  "artist_reference": "studio ghibli"
}
```
**Expected**: Ghibli-style aesthetic
```
✅ PASS: Prompt contains artist reference, style matches
❌ FAIL: No artist influence
```

#### TC-7.5: Imagine - Model Family Override
**Tool**: `imagine`
**Input**:
```json
{
  "description": "A character design",
  "output_path": "/tmp/test/tc-7-5.png",
  "model": "some_model.safetensors",
  "model_family": "pony"
}
```
**Expected**: Pony-style prompt with score tags
```
✅ PASS: Prompt has score_9, score_8_up
❌ FAIL: Wrong prompt format
```

#### TC-7.6: Imagine - Flux Model (Natural Language)
**Tool**: `imagine`
**Input**:
```json
{
  "description": "A professional photograph of a sunset",
  "output_path": "/tmp/test/tc-7-6.png",
  "model": "flux1-schnell.safetensors"
}
```
**Expected**: Natural language prompt, low CFG
```
✅ PASS: cfgScale <= 4, no negative prompt
❌ FAIL: High CFG or tag-based prompt
```

#### TC-7.7: Imagine - With LoRAs
**Tool**: `imagine`
**Input**:
```json
{
  "description": "A portrait",
  "output_path": "/tmp/test/tc-7-7.png",
  "loras": [{"name": "<your-lora>.safetensors", "strength_model": 0.7, "strength_clip": 0.7}]
}
```
**Expected**: LoRA effect applied
```
✅ PASS: LoRA visible in result
❌ FAIL: No LoRA effect
```

---

### 8. Error Handling Tests

#### TC-8.1: Missing Required Field
**Tool**: `generate_image`
**Input**:
```json
{
  "prompt": "test"
}
```
**Expected**: Clear error about missing output_path
```
✅ PASS: Error message mentions required field
❌ FAIL: Cryptic error or crash
```

#### TC-8.2: Invalid Model
**Tool**: `generate_image`
**Input**:
```json
{
  "prompt": "test",
  "model": "nonexistent_model.safetensors",
  "output_path": "/tmp/test/error.png"
}
```
**Expected**: Clear error about model not found
```
✅ PASS: Error indicates model issue
❌ FAIL: Silent failure
```

#### TC-8.3: ComfyUI Not Available
**Setup**: Stop ComfyUI, then:
**Tool**: `list_models`
**Expected**: Connection error
```
✅ PASS: Error indicates connection failed
❌ FAIL: Hangs or cryptic error
```

---

## Remote Deployment Testing (Fly.io + RunPod)

### Setup for Remote ComfyUI

1. Deploy ComfyUI on RunPod (GPU instance)
2. Note the RunPod URL (e.g., `https://xyz123.runpod.io`)
3. Update environment:
```bash
export COMFYUI_URL="https://xyz123.runpod.io"
```

### TC-9.1: Remote Connection
**Tool**: `list_models`
**Expected**: Returns models from remote ComfyUI
```
✅ PASS: Models listed from remote instance
❌ FAIL: Connection timeout or error
```

### TC-9.2: Remote Generation
**Tool**: `imagine`
**Input**:
```json
{
  "description": "A test image from remote GPU",
  "output_path": "/tmp/test/remote.png",
  "quality": "standard"
}
```
**Expected**: Image generated on remote GPU
```
✅ PASS: Image generated (may take longer due to network)
❌ FAIL: Timeout or error
```

---

## Test Summary Checklist

| Test ID | Category | Status |
|---------|----------|--------|
| TC-1.1 | Connection | ⬜ |
| TC-1.2 | Connection | ⬜ |
| TC-1.3 | Connection | ⬜ |
| TC-1.4 | Connection | ⬜ |
| TC-1.5 | Connection | ⬜ |
| TC-1.6 | Connection | ⬜ |
| TC-2.1 | txt2img | ⬜ |
| TC-2.2 | txt2img | ⬜ |
| TC-2.3 | txt2img | ⬜ |
| TC-2.4 | txt2img | ⬜ |
| TC-2.5 | txt2img | ⬜ |
| TC-3.1 | img2img | ⬜ |
| TC-3.2 | img2img | ⬜ |
| TC-3.3 | img2img | ⬜ |
| TC-4.1 | Upscale | ⬜ |
| TC-4.2 | Upscale | ⬜ |
| TC-5.1 | Prompting | ⬜ |
| TC-5.2 | Prompting | ⬜ |
| TC-5.3 | Prompting | ⬜ |
| TC-5.4 | Prompting | ⬜ |
| TC-5.5 | Prompting | ⬜ |
| TC-5.6 | Prompting | ⬜ |
| TC-6.1 | Pipeline | ⬜ |
| TC-6.2 | Pipeline | ⬜ |
| TC-6.3 | Pipeline | ⬜ |
| TC-7.1 | Imagine | ⬜ |
| TC-7.2 | Imagine | ⬜ |
| TC-7.3 | Imagine | ⬜ |
| TC-7.4 | Imagine | ⬜ |
| TC-7.5 | Imagine | ⬜ |
| TC-7.6 | Imagine | ⬜ |
| TC-7.7 | Imagine | ⬜ |
| TC-8.1 | Errors | ⬜ |
| TC-8.2 | Errors | ⬜ |
| TC-8.3 | Errors | ⬜ |
| TC-9.1 | Remote | ⬜ |
| TC-9.2 | Remote | ⬜ |

---

## Quick Validation Script

Run these commands to quickly validate the setup:

```bash
# In your MCP client (Claude Code), run these tools in sequence:

1. list_models           # Should return at least one model
2. list_samplers         # Should return samplers
3. get_queue_status      # Should return queue info

# Then generate a test image:
4. imagine with:
   - description: "A simple test: red apple on white background"
   - output_path: "/tmp/validation-test.png"
   - quality: "draft"

# Verify the file was created:
5. Check /tmp/validation-test.png exists and is a valid image
```

If all 5 steps pass, the server is properly configured and functional!
