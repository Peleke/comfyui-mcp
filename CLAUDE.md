# Claude Code Guidelines for ComfyUI MCP

## Architectural Principles

### Always Prefer Plugin/Backend Abstractions

**CRITICAL**: When implementing any feature that could work with multiple model types, backends, or variants:

1. **Never build for a single backend** - If you're implementing something for "Flux GGUF", recognize that non-quant models, SDXL, and other model families will inevitably be needed.

2. **Abstract from day one** - Create a `backend` parameter or similar abstraction that allows selecting between different implementations.

3. **Example pattern**:
   ```typescript
   // BAD: Single backend
   function buildFluxWorkflow(params) { ... }

   // GOOD: Abstracted backends
   function buildPortraitWorkflow(params, backend: "flux_gguf" | "flux_fp8" | "sdxl") {
     switch (backend) {
       case "flux_gguf": return buildFluxGGUFWorkflow(params);
       case "flux_fp8": return buildFluxFP8Workflow(params);
       case "sdxl": return buildSDXLWorkflow(params);
     }
   }
   ```

4. **Think ahead** - When you see one variant, assume there will be more. Design for extensibility.

### Current Backends

| Backend | Use Case | Models |
|---------|----------|--------|
| `flux_gguf` | Local quantized Flux (Mac, low VRAM) | flux1-schnell-Q8_0.gguf, flux1-dev-Q8_0.gguf |
| `flux_fp8` | Full precision Flux (RunPod, A100) | flux1-schnell-fp8.safetensors |
| `sdxl` | SDXL checkpoints (diverse styles) | novaFurry, yiffinhell, perfectdeliberate, etc. |

### Model Families

We support multiple model families for different use cases:

- **Realistic**: perfectdeliberate, cyberrealistic
- **Anime**: illustrious, mistoonAnime, AnythingXL
- **Furry/NSFW**: novaFurry, yiffinhell, yiffymix, furryDreams
- **Flux**: schnell (fast), dev (quality)

## Voice Samples

For F5-TTS voice cloning, any 10-30 second audio sample works. The model clones voice characteristics (timbre, pitch, speaking style) - not language. You can clone an English voice and have it speak Old Norse.

## Testing

Run tests before committing:
```bash
npx vitest run
```

## Directory Conventions

- `ComfyUI/input/avatars/` - Portrait images for lip-sync
- `ComfyUI/input/voices/` - Voice reference audio for TTS cloning
