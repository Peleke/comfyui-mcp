# Backend Architecture

## Overview

The comfyui-mcp supports multiple backends for running ComfyUI workflows:

```
┌─────────────────────────────────────────────────────────────┐
│  MCP Tools (lipsync, tts, imagine, etc.)                    │
│                          │                                  │
│                          ▼                                  │
│              ┌───────────────────────┐                      │
│              │    ComfyBackend       │                      │
│              │    (interface)        │                      │
│              └───────────────────────┘                      │
│                    │           │                            │
│           ┌───────┴───┐   ┌───┴────────┐                   │
│           ▼           ▼   ▼            ▼                   │
│    ┌──────────┐  ┌──────────┐  ┌──────────────┐            │
│    │  Local   │  │  RunPod  │  │   Future     │            │
│    │ ComfyUI  │  │Serverless│  │  (Hedra,etc) │            │
│    └──────────┘  └──────────┘  └──────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

Set environment variables to choose backend:

```bash
# Use RunPod serverless (recommended for production)
export COMFY_BACKEND=runpod
export RUNPOD_ENDPOINT_ID=urauigb5h66a1y
export RUNPOD_API_KEY=your-api-key

# Use local ComfyUI (for development)
export COMFY_BACKEND=local
export COMFYUI_URL=http://localhost:8188
```

## Usage

```typescript
import { getBackend } from "./backend/index.js";

// Get the configured backend
const backend = getBackend();

// Use it for any operation - works the same regardless of backend
const result = await backend.lipsync({
  portraitImage: "avatars/odin.png",
  audio: "voices/speech.wav",
  outputPath: "/tmp/output.mp4",
});

if (result.success) {
  console.log("Video URL:", result.files[0].remoteUrl);
}
```

## Backend Interface

```typescript
interface ComfyBackend {
  name: "local" | "runpod";

  healthCheck(): Promise<{ healthy: boolean; version?: string }>;

  portrait(params: PortraitParams): Promise<GenerationResult>;
  tts(params: TTSParams): Promise<GenerationResult>;
  lipsync(params: LipSyncParams): Promise<GenerationResult>;
  imagine(params: ImagineParams): Promise<GenerationResult>;
}
```

## Files

| File | Purpose |
|------|---------|
| `src/backend/types.ts` | Common types and interface |
| `src/backend/runpod.ts` | RunPod serverless implementation |
| `src/backend/index.ts` | Factory and exports |

---

# Model Registry

## Overview

The model registry system tracks models between local ComfyUI and RunPod:

```
┌─────────────────┐         ┌─────────────────┐
│  Local ComfyUI  │ ◄─────► │  RunPod Volume  │
│  ~/Documents/   │  sync   │  /runpod-volume │
│  ComfyUI/models │         │                 │
└─────────────────┘         └─────────────────┘
        │                           │
        ▼                           ▼
┌───────────────────────────────────────────┐
│         models-registry.yaml              │
│  - Required models for serverless         │
│  - Optional models                        │
│  - Local scan results                     │
│  - RunPod status                          │
└───────────────────────────────────────────┘
```

## Scripts

```bash
# Scan local ComfyUI and output JSON manifest
./deploy/scripts/scan-models.sh

# Provision models to RunPod volume
./deploy/scripts/provision-models.sh hf_TOKEN

# Check what's on RunPod
curl -X POST "https://api.runpod.ai/v2/ENDPOINT/runsync" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{"input":{"action":"debug"}}'
```

## MCP Tools

```typescript
// Scan local models
const local = await scanLocalModels({});
console.log(local.categories.checkpoints);

// List what's on RunPod
const remote = await listRemoteModels({});
console.log(remote.checkpoints);

// Compare local vs remote
const diff = await compareModels({});
console.log(diff.summary.missing_on_remote);
```

## Registry File

`deploy/models-registry.yaml` tracks:

- **Required models**: Needed for serverless pipeline (SONIC, SVD, F5-TTS)
- **Optional models**: Nice to have (extra checkpoints, LoRAs)
- **Local scan**: Auto-populated by scan script
- **RunPod status**: Current state of remote volume

## Sync Workflow

1. **Scan local**: `./scan-models.sh > local-manifest.json`
2. **Compare**: Check what's missing on RunPod
3. **Provision**: Run provision script to download missing models
4. **Verify**: Use debug endpoint to confirm
