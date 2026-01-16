# Build Journal: RunPod Serverless Deployment for ComfyUI

**Date:** January 15, 2026
**Duration:** ~4 hours
**Status:** Partial Success - Core infrastructure working, pending model downloads

---

## The Goal

Deploy a serverless GPU infrastructure for ComfyUI that can generate:
- AI portraits (txt2img)
- Voice cloning (F5-TTS)
- Lip-synced talking head videos (SONIC)
- Panel animations for graphic novels (AnimateLCM)
- Background music (ACE-Step)

The key constraint: **scale to zero** when not in use, so we're not burning $2/hour on idle GPUs.

---

## What We Built

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Client (MCP Server)                         │
│                            │                                    │
│                            ▼                                    │
│              RunPod Serverless Endpoint                         │
│              (scales 0-3 workers on demand)                     │
│                            │                                    │
│                            ▼                                    │
│    ┌──────────────────────────────────────────┐                │
│    │           GPU Worker (RTX 4090)          │                │
│    │  ┌─────────────────────────────────┐     │                │
│    │  │    Docker: comfyui-serverless   │     │                │
│    │  │    - ComfyUI                    │     │                │
│    │  │    - handler.py (RunPod SDK)    │     │                │
│    │  │    - Custom nodes (SONIC, etc)  │     │                │
│    │  └─────────────────────────────────┘     │                │
│    │                  │                        │                │
│    │                  ▼                        │                │
│    │     Network Volume (100GB)               │                │
│    │     /runpod-volume                       │                │
│    │     - checkpoints/                       │                │
│    │     - sonic/                             │                │
│    │     - animatediff_models/                │                │
│    └──────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

### Components Delivered

| Component | Status | Notes |
|-----------|--------|-------|
| Network Volume | Working | 100GB, US-TX-3, ID: `g64svtzxd5` |
| Docker Image | Working | `pelekes/comfyui-serverless:v2` |
| Serverless Endpoint | Working | ID: `urauigb5h66a1y` |
| Portrait Generation | Working | Deliberate v5 model |
| TTS (Voice Cloning) | Pending | Needs F5-TTS models |
| Lip-Sync (SONIC) | Pending | Needs HuggingFace auth for models |
| Panel Animation | Pending | AnimateLCM 404'd, need alt source |
| Music Generation | Pending | ACE-Step not downloaded |

---

## The Journey (Including the Fuckups)

### Hour 1: Terraform Wrestling

**What we tried:** Use Terraform's RunPod provider to create network volumes.

**What happened:** The provider doesn't support `runpod_network_storage`.

```hcl
# This doesn't exist in the provider
resource "runpod_network_storage" "models" {
  name = "comfyui-models"
  size = 100
}
```

**The fix:** Switched to RunPod's GraphQL API for volume creation:

```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{"query": "mutation { createNetworkVolume(input: { name: \"comfyui-models\", size: 100, dataCenterId: \"US-TX-3\" }) { id } }"}'
```

**Lesson:** RunPod's Terraform provider is incomplete. API fallbacks are necessary.

---

### Hour 2: SSH Hell

**What we tried:** SSH into a provisioner pod to download models.

**What happened:** Permission denied. Every. Single. Time.

```
cyk5ekqpw14d28-644114f6@ssh.runpod.io: Permission denied (publickey).
```

**Things we tried:**
1. Different SSH keys (`id_ed25519`, `runpod_ed25519`)
2. Adding keys to RunPod account
3. Creating new pods after adding keys
4. Different pod templates

**Root cause:** SSH keys must be in your RunPod account BEFORE pod creation. Keys aren't injected retroactively.

**The fix:** Used RunPod's web terminal instead. Less elegant, but it works.

**Lesson:** RunPod's SSH is finicky. Web terminal is the reliable fallback.

---

### Hour 3: Docker Architecture Mismatch

**What we tried:** Deploy the serverless endpoint.

**What happened:** Workers stuck "initializing" for 40+ minutes.

```json
{"workers": {"idle": 0, "initializing": 3, "ready": 0}}
```

**The actual error (found in RunPod logs):**
```
error creating container: failed to pull image: no matching manifest for linux/amd64
```

**Root cause:** Built Docker image on Mac (ARM64), RunPod needs linux/amd64.

**The fix:**
```bash
docker buildx build --platform linux/amd64 -t pelekes/comfyui-serverless:latest --push .
```

**Lesson:** Always specify `--platform linux/amd64` when building for cloud deployment from Mac.

---

### Hour 4: Volume Attachment Mystery

**What we tried:** Test the endpoint after fixing Docker.

**What happened:** Debug action showed volume not mounted:

```json
{
  "volume_exists": false,
  "checkpoints_contents": []
}
```

**Root cause:** Network volume wasn't attached to the endpoint. The UI for attaching volumes during endpoint creation is... non-obvious.

**The fix:** User found the volume attachment option in RunPod UI and recreated the endpoint.

**Final debug output:**
```json
{
  "volume_exists": true,
  "checkpoints_contents": ["Deliberate_v5.safetensors", "video"],
  "comfyui_api_status": 200,
  "comfyui_process_alive": true
}
```

**Lesson:** Always verify volume attachment with a debug endpoint.

---

## Test Results

### Portrait Generation

**Request:**
```bash
curl -X POST "https://api.runpod.ai/v2/urauigb5h66a1y/runsync" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{"input": {
    "action": "portrait",
    "description": "Viking warrior with braided beard, fierce expression",
    "model": "Deliberate_v5.safetensors"
  }}'
```

**Response:**
```json
{
  "status": "COMPLETED",
  "executionTime": 78197,
  "output": {
    "files": [{
      "type": "image",
      "filename": "ComfyUI_00001_.png",
      "data": "base64...",
      "encoding": "base64"
    }]
  }
}
```

**Result:**

![Viking Portrait](/tmp/viking.png)

*1.2MB PNG, ~78 seconds generation time including cold start*

---

## Code Samples

### The Handler (Simplified)

```python
# deploy/serverless/handler.py

def handler(event: dict) -> dict:
    """RunPod serverless handler for ComfyUI."""

    # Start ComfyUI if not running
    start_comfyui()

    action = event.get("input", {}).get("action", "portrait")

    if action == "portrait":
        workflow = build_portrait_workflow(event["input"])
    elif action == "health":
        return {"status": "healthy", "comfyui_url": COMFYUI_URL}
    elif action == "debug":
        return get_debug_info()  # Volume/model status

    # Queue workflow and wait
    prompt_id = queue_prompt(workflow)
    history = wait_for_completion(prompt_id)

    # Return base64-encoded outputs
    return {"files": encode_outputs(history), "status": "success"}
```

### Volume Symlink Setup

```python
def setup_model_paths():
    """Symlink network volume models into ComfyUI."""

    NETWORK_VOLUME = "/runpod-volume"
    COMFYUI_MODELS = "/workspace/ComfyUI/models"

    model_dirs = ["checkpoints", "sonic", "animatediff_models", ...]

    for model_dir in model_dirs:
        volume_path = os.path.join(NETWORK_VOLUME, model_dir)
        comfyui_path = os.path.join(COMFYUI_MODELS, model_dir)

        if os.path.exists(volume_path):
            os.symlink(volume_path, comfyui_path)
            print(f"Linked {model_dir}")
```

---

## What's Left

### Tomorrow's Tasks

1. **Supabase Storage Integration** - Images currently return as base64. Need to upload to Supabase and return URLs instead. Prompt doc created at `deploy/SUPABASE_STORAGE_INTEGRATION.md`.

2. **SONIC Model Downloads** - Gated on HuggingFace, need auth token:
   ```bash
   huggingface-cli login
   huggingface-cli download AIFSH/SONIC --local-dir /runpod-volume/sonic
   ```

3. **AnimateLCM Models** - Original URLs 404'd, need to find mirror.

4. **Full Pipeline Test** - Portrait → TTS → Lip-sync → Talking head video.

---

## Cost Analysis

| Resource | Cost | Notes |
|----------|------|-------|
| Network Volume | ~$7/month | 100GB @ $0.07/GB/month |
| GPU Workers | $0/idle | Scale to zero when not in use |
| GPU Workers | ~$0.50/run | RTX 4090, ~1-2 min per generation |
| Docker Registry | Free | Docker Hub public repo |

**Monthly estimate:** $7-15 for light usage (volume + occasional generations)

---

## AI Experience Reflection

### What Worked Well

**Iterative debugging with explicit tool outputs.** When the endpoint wasn't working, adding a `debug` action that returned volume/model/process status made diagnosis 10x faster. Instead of guessing, we could see exactly what the worker saw.

**Clear error messages in responses.** Capturing ComfyUI startup logs when it failed to start (`ComfyUI failed to start within 120s. Logs: ...`) would have been invaluable earlier.

### What Was Frustrating

**RunPod's documentation gaps.** The Terraform provider silently lacking network volume support, SSH key timing requirements, and volume attachment UX were all undocumented gotchas.

**Human context switches.** Several times I was mid-task when interrupted with new information or direction changes. Keeping track of what we were doing vs. what we pivoted to required careful state management.

### Communication Notes

**Explicit frustration is useful signal.** When the human said "for fuck's sake" about empty model files, that was clear signal to stop, simplify, and provide a working solution rather than continuing to debug.

**Pace matching matters.** Long-running commands (2+ minutes) without progress updates led to user interruption. Short async checks with status polling worked better.

### For Next Time

1. Add `debug` action from the start on any new endpoint
2. Always build Docker with `--platform linux/amd64`
3. Verify volume attachment immediately after endpoint creation
4. Use async requests + polling instead of long sync timeouts

---

## Files Changed

```
deploy/
├── terraform/
│   └── main.tf                    # Endpoint config (volume via API)
├── serverless/
│   ├── Dockerfile                 # Added video/audio nodes
│   └── handler.py                 # Actions: portrait, health, debug
├── scripts/
│   └── provision-volume.sh        # Model download script
├── NETWORK_VOLUME_MODELS.md       # Model manifest
└── SUPABASE_STORAGE_INTEGRATION.md # Tomorrow's prompt
```

---

*Next entry: Supabase storage integration and SONIC model setup*
