# ComfyUI MCP Build Journal

A chronological narrative of feature development, architectural decisions, and implementation details.

---

## Issue #13: Inpainting, Outpainting, and Intelligent Mask Generation

**Date:** January 2026
**Branch:** `feat/inpainting-outpainting`
**Status:** Complete

### The Problem

Image generation is great, but real creative workflows need *editing*. Users want to:
- Fix hands (the eternal AI art nemesis)
- Extend a composition beyond its original bounds
- Selectively regenerate parts of an image while preserving the rest
- Do all of this without manually creating masks in Photoshop

### Architecture: Three Tools, One Philosophy

We implemented three complementary tools:

| Tool | Purpose |
|------|---------|
| `inpaint` | Regenerate masked regions while preserving context |
| `outpaint` | Extend canvas in any direction with coherent generation |
| `create_mask` | Generate masks intelligently using AI segmentation |

The key insight: **masks are the lingua franca of selective editing**. Both inpaint and outpaint operate on masks—the difference is who creates the mask and how.

### Inpainting: SetLatentNoiseMask

The core inpainting workflow uses ComfyUI's `SetLatentNoiseMask` node, which applies a mask to the latent space itself. This is more sophisticated than simple image compositing:

```
LoadImage(source) → VAEEncode → SetLatentNoiseMask ← LoadImage(mask)
                                      ↓
                                   KSampler → VAEDecode → SaveImage
```

The mask controls *where* noise is applied. White regions get full denoising (complete regeneration), black regions get none (perfect preservation). The `denoise_strength` parameter controls how aggressively we regenerate—0.75 is a good default that maintains coherence with surrounding context.

### Outpainting: ImagePadForOutpaint

Outpainting is conceptually different: we're *extending* the canvas, not editing within it. ComfyUI provides the `ImagePadForOutpaint` node that:

1. Pads the image with configurable pixels in each direction
2. **Automatically generates the corresponding mask** (new regions are white)
3. Applies intelligent feathering at the boundary

This node outputs *both* the padded image (slot 0) and the mask (slot 1). The workflow then feeds these into the standard inpainting pipeline. The `feathering` parameter (default 40px) creates smooth transitions at boundaries.

```typescript
// ImagePadForOutpaint outputs:
// - Slot 0: Padded image (original image with extended canvas)
// - Slot 1: Generated mask (white = new regions, black = original)
```

We default `denoise_strength` to 0.8 for outpainting (higher than inpaint's 0.75) because new regions need stronger generation—there's no existing content to preserve.

### Intelligent Mask Generation: GroundingDINO + SAM

The real magic is in `create_mask`. Instead of requiring users to manually paint masks, we leverage AI segmentation:

**GroundingDINO** (Grounded DINO) performs open-vocabulary object detection. Give it a text prompt like "hands" or "red shirt" and it finds bounding boxes.

**SAM** (Segment Anything Model) takes those boxes and generates precise segmentation masks.

Together, they enable natural-language mask creation:

```typescript
// User says: create_mask({ preset: "hands", source_image: "portrait.png" })
// System generates: A mask isolating just the hands

// User says: create_mask({ text_prompt: "the cat on the left", ... })
// System generates: A mask for that specific cat
```

We implemented preset mappings for common use cases:

```typescript
const presetPrompts: Record<MaskPreset, string> = {
  hands: "hands, fingers",
  face: "face, head",
  eyes: "eyes",
  body: "person, human body",
  background: "background",
  foreground: "foreground, main subject",
};
```

### Workflow Node Wiring

The most error-prone part of ComfyUI workflow building is getting the node connections right. Each connection specifies:
- Source node ID
- Output slot index
- Destination node (via input name)

For inpainting:
```typescript
// VAEEncode connects its output (slot 0) to SetLatentNoiseMask's "samples" input
workflow["3"].inputs.samples = ["2", 0];  // [nodeId, slotIndex]

// SetLatentNoiseMask connects to KSampler's "latent_image" input
workflow["6"].inputs.latent_image = ["3", 0];
```

For mask workflow with segmentation:
```typescript
// GroundingDINO → SAM → mask processing chain
workflow["3"].inputs.image = ["1", 0];        // LoadImage → GroundingDINO
workflow["4"].inputs.grounding_dino_model = ["2", 0];  // ModelLoader → SAM
workflow["4"].inputs.image = ["1", 0];         // LoadImage → SAM
workflow["4"].inputs.prompt = groundingDinoDetections;  // Detection boxes → SAM
```

### Testing Strategy

The user was emphatic about exhaustive testing. We delivered 83 tests for the tool handlers alone:

**Inpaint tests (25):**
- Basic workflow generation
- Image handling (source + mask)
- Model selection (default vs explicit)
- Sampler parameters
- Prompt handling (positive + negative)
- LoRA injection (single, multiple, strength variations)
- Denoise edge cases (0.0, 1.0, bounds)
- Cloud upload integration

**Outpaint tests (22):**
- Basic extension in single direction
- Multi-direction extension
- Validation (must extend at least one direction)
- Feathering parameter
- Denoise strength
- LoRA integration
- Error handling

**CreateMask tests (25):**
- All preset types
- Custom text prompts
- Manual region specification
- Mask processing options (expand, feather, invert)
- SAM/GroundingDINO model configuration
- Threshold parameter
- Error cases (no method specified)

**Schema validation tests (11):**
- Required fields
- Optional defaults
- Type coercion
- Range validation

Builder tests added another 53 tests covering:
- Workflow structure validation
- Node wiring verification
- LoRA injection at correct points
- Output node configurations

### Lessons Learned

1. **Mock output node IDs matter**: Different workflows use different save node IDs (8, 9, 10). Our initial mock only had node "9", causing 33 test failures. The fix was trivial but the debugging was not.

2. **Preset-to-prompt mapping is art**: Translating "hands" to "hands, fingers" seems obvious, but "background" vs "foreground" requires understanding what GroundingDINO actually responds to.

3. **Feathering is crucial for outpainting**: Without edge feathering, outpainted regions have visible seams. 40px default strikes a balance between smooth blending and not eating into the original image.

4. **SAM requires GroundingDINO for text prompts**: SAM alone can segment anything *given a point or box*. For text-based selection, you need GroundingDINO to find the objects first.

### Files Changed

```
src/workflows/inpaint.json      # New: Base workflow template
src/workflows/outpaint.json     # New: Outpaint workflow template
src/workflows/builder.ts        # Added: 4 new builder functions + types
src/tools/inpaint.ts            # New: Tool handlers (394 lines)
src/index.ts                    # Modified: 3 new tool registrations
src/tools/inpaint.test.ts       # New: 83 exhaustive tests
src/workflows/builder.test.ts   # Modified: +53 tests
src/__mocks__/comfyui-responses.ts  # Modified: Multi-node output support
```

### Usage Examples

```typescript
// Fix those pesky AI hands
await inpaint({
  prompt: "realistic human hands, detailed fingers, natural pose",
  negative_prompt: "deformed, extra fingers, fused fingers",
  source_image: "portrait.png",
  mask_image: "hands_mask.png",  // Or use create_mask first
  denoise_strength: 0.85,        // Higher for more aggressive fix
  output_path: "/output/fixed.png"
});

// Extend a landscape to the right
await outpaint({
  prompt: "continuation of forest landscape, same style, coherent",
  source_image: "forest.png",
  extend_right: 512,
  feathering: 60,
  output_path: "/output/extended.png"
});

// Create mask for a specific object
await createMask({
  source_image: "photo.png",
  text_prompt: "the red car",
  expand_pixels: 10,   // Grow mask slightly for safety
  feather_pixels: 5,   // Soft edges
  output_path: "/output/car_mask.png"
});
```

---

*Next up: Issue #14 or whatever chaos the user throws at us.*
