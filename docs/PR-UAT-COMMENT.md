# PR Review: ComfyUI MCP Server - Smart Prompting & Pipeline System

## Summary

This PR adds intelligent prompt generation and multi-step pipeline execution to the ComfyUI MCP server. The headline feature is the `imagine` tool, which takes natural language descriptions and handles everything automatically—model detection, prompt optimization, and pipeline execution.

**New tools:** 6
**Tests added:** 17 new (148 total)
**Files changed:** 15

---

## What's New

### 🎨 `imagine` Tool
The main event. Describe what you want, get an optimized image:

```typescript
imagine({
  description: "A cozy coffee shop with warm lighting and plants",
  output_path: "/tmp/coffee.png",
  style: "cinematic",
  quality: "high"  // enables hi-res fix automatically
})
```

It auto-detects your model family (Illustrious, Pony, Flux, etc.) and crafts prompts using best practices for that model.

### Pipeline Executor
Chain operations in one call:
- `txt2img` → `hires_fix` → `upscale`

### Smart Prompting System
6 model-specific strategies:
- **Illustrious/Pony**: Tag-based with quality boosters
- **Flux**: Natural language, no negative prompts
- **SDXL/Realistic**: Descriptive with camera terminology

---

## UAT Checklist

Run these tests against a live ComfyUI instance.

### Connection Tests
- [ ] `list_models` returns at least one model
- [ ] `list_samplers` returns standard samplers
- [ ] `get_queue_status` returns queue info

### Basic Generation
- [ ] `generate_image` with simple prompt creates valid PNG
- [ ] Same seed produces identical images
- [ ] LoRAs apply correctly (visible style change)

### Pipeline Tests
- [ ] `execute_pipeline` with `enable_hires_fix: false` → 1 step
- [ ] `execute_pipeline` with `enable_hires_fix: true` → 2 steps
- [ ] Full pipeline (hires + upscale) → 3 steps, large output

### Imagine Tool (Critical Path)
- [ ] Basic: `imagine` with just description + output_path works
- [ ] Model detection: Uses correct strategy for model name
- [ ] Style: `style: "anime"` produces anime-style output
- [ ] Quality presets:
  - [ ] `draft` → txt2img only
  - [ ] `high` → includes hi-res fix
  - [ ] `ultra` → includes upscale
- [ ] Artist reference appears in generated prompt
- [ ] Flux models: CFG ≤ 4, empty negative prompt
- [ ] Pony models: Prompt starts with `score_9`

### Prompt Crafting
- [ ] `craft_prompt` for Illustrious includes `masterpiece, best quality`
- [ ] `craft_prompt` for Flux returns empty negative
- [ ] `get_prompting_guide` returns tips array

### Error Handling
- [ ] Missing output_path → clear error message
- [ ] Invalid model → error mentions model issue
- [ ] ComfyUI offline → connection error (not hang)

---

## Quick Validation

Fastest way to verify the PR works:

```bash
# 1. Build
npm run build

# 2. Run tests (should be 148 passing)
npm test

# 3. Manual smoke test with MCP client
list_models  # Should return models

imagine({
  description: "red apple on white background",
  output_path: "/tmp/test-apple.png",
  quality: "draft"
})

# 4. Verify /tmp/test-apple.png exists and is valid
```

---

## Breaking Changes

None. All existing tools work as before.

---

## Notes for Reviewers

- The prompting strategies are based on community best practices (Civitai guides, model cards, etc.)
- Quality presets are opinionated defaults—`high` enables hi-res fix because it significantly improves detail
- Flux handling is special: these models don't use negative prompts and need low CFG (1-4)
- The `imagine` tool is designed to be the "just works" option for users who don't want to tune parameters

---

## Test Coverage

| Component | Tests |
|-----------|-------|
| imagine.test.ts | 17 |
| pipeline.test.ts | 7 |
| generator.test.ts | 22 |
| model-detection.test.ts | 13 |
| (existing tests) | 89 |
| **Total** | **148** |

All tests pass. Run `npm test` to verify.
