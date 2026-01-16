# Contract Testing for ComfyUI Workflows

## Overview

This project uses **contract testing** to validate ComfyUI workflow JSON against schema snapshots. This catches structural bugs (wrong node names, missing inputs, invalid connections) WITHOUT requiring GPU execution.

## Key Files

- `src/contracts/types.ts` - TypeScript interfaces
- `src/contracts/schema-fetcher.ts` - CLI to fetch /object_info from ComfyUI
- `src/contracts/comfyui-schema.json` - Schema snapshot (committed, source of truth)
- `src/contracts/workflow-validator.ts` - Core validation logic
- `src/contracts/workflow.contract.test.ts` - 41 contract tests for all workflow builders

## Commands

```bash
npm run test:contracts        # Run contract tests only
npm run contracts:update      # Fetch fresh schema from running ComfyUI
```

## Validation Rules

The validator checks:
1. Node type exists in schema (`class_type`)
2. All required inputs are provided
3. Input types match (INT, FLOAT, STRING, BOOLEAN, ENUM)
4. Numeric values within min/max constraints
5. Node connections reference valid nodes and output indices
6. Unknown inputs generate warnings

## Common Gotchas (Lessons Learned)

### 1. Schema vs Reality Mismatch

The schema must match what the **actual workflow builders** produce, not what `/object_info` says. Some inputs are technically required by ComfyUI but our builders use different patterns.

**Example:** IPAdapterAdvanced has `embeds_scaling` as required in /object_info, but our builder doesn't use it. We mark it optional in our schema.

### 2. Input Name Variations

Different ComfyUI node versions use different input names:

| Node | Old Names | Actual Names |
|------|-----------|--------------|
| F5TTSAudioInputs | gen_text, ref_text, ref_audio | speech, sample_text, sample_audio |
| SONICTLoader | svd_ckpt, unet | model, sonic_unet |
| SONIC_PreData | model, fps | clip_vision, vae |

**Always verify against `src/workflows/*.json`** - these are exported from working ComfyUI.

### 3. Workflow Builder Behavior

Builders may conditionally include/exclude nodes:

- `buildUpscaleWorkflow()` omits `ImageScale` node when no target dimensions provided
- `buildOutpaintWorkflow()` uses `VAEEncodeForInpaint`, not `SetLatentNoiseMask`

**Always read the builder source** before writing tests expecting specific nodes.

## Adding New Node Types

1. Find a working workflow using the node (export from ComfyUI)
2. Extract the node's inputs from the workflow JSON
3. Add to `COMMON_NODES` array in schema-fetcher.ts
4. Either run `contracts:update` OR manually add to comfyui-schema.json
5. Write contract tests for the new workflow builder
6. Run `npm run test:contracts` to verify

## When Tests Fail

If contract tests fail unexpectedly:

1. **Check the error message** - It tells you exactly what's wrong
2. **Compare schema vs workflow JSON** - Is the schema outdated?
3. **Compare test vs builder** - Does the test expect the right nodes?
4. **Never guess** - Read the actual source files
