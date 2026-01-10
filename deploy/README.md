# RunPod Deployment Guide

Deploy ComfyUI on a RunPod GPU instance and connect your local MCP server to it.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Your Machine (Local)                                            │
│                                                                 │
│   ┌─────────────┐        ┌─────────────┐                       │
│   │ Claude Code │ ◄────► │ MCP Server  │                       │
│   └─────────────┘        └──────┬──────┘                       │
│                                 │                               │
└─────────────────────────────────┼───────────────────────────────┘
                                  │ HTTPS
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│ RunPod (Remote GPU)                                             │
│                                                                 │
│   ┌─────────────┐                                              │
│   │  ComfyUI    │ ◄── Your models, LoRAs, etc.                │
│   │  :8188      │                                              │
│   └─────────────┘                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

The MCP server runs locally (fast tool responses), but actual image generation happens on RunPod's GPUs.

## Quick Start

### 1. Create RunPod Account

Go to [runpod.io](https://runpod.io) and add credits ($10-20 is plenty for testing).

### 2. Deploy ComfyUI Template

**Option A: Use RunPod's Template (Easiest)**

1. Go to "Pods" → "Deploy"
2. Search for "ComfyUI" in Community Templates
3. Select one with SDXL support (e.g., "ComfyUI + SDXL")
4. Choose GPU (RTX 4090 recommended, A40/A100 for heavier work)
5. Click "Deploy"

**Option B: Custom Deployment**

Use our setup script after deploying a base PyTorch template:

```bash
# SSH into your pod
ssh root@<POD_IP> -p <SSH_PORT>

# Download and run setup
curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/main/deploy/setup-runpod.sh | bash
```

### 3. Get Your Pod URL

Once running, your pod exposes ComfyUI on port 8188. RunPod provides a proxy URL:

```
https://<POD_ID>-8188.proxy.runpod.net
```

Find this in the RunPod dashboard under "Connect" → "HTTP Service [Port 8188]".

### 4. Configure Local MCP Server

Update your Claude Code settings:

```json
{
  "mcpServers": {
    "comfyui": {
      "command": "node",
      "args": ["/path/to/comfyui-mcp/dist/index.js"],
      "env": {
        "COMFYUI_URL": "https://<POD_ID>-8188.proxy.runpod.net",
        "COMFYUI_MODEL": "dreamshaper_8.safetensors"
      }
    }
  }
}
```

### 5. Test Connection

In Claude Code:
```
list_models
```

Should return models from your RunPod instance.

---

## Detailed Setup

### Installing Models on RunPod

SSH into your pod:

```bash
# Using RunPod's web terminal or SSH
ssh root@<POD_IP> -p <SSH_PORT> -i ~/.ssh/runpod_key
```

Download models:

```bash
cd /workspace/ComfyUI/models/checkpoints

# Example: Download DreamShaper
wget https://civitai.com/api/download/models/128713 -O dreamshaper_8.safetensors

# Example: Download Illustrious XL
wget https://civitai.com/api/download/models/xxxxxx -O illustrious_xl.safetensors
```

For LoRAs:

```bash
cd /workspace/ComfyUI/models/loras
wget https://civitai.com/api/download/models/xxxxx -O your_lora.safetensors
```

### Persistent Storage

By default, RunPod pods are ephemeral—they reset when stopped. For persistent models:

1. **Network Volume**: Attach a network volume to `/workspace`
2. **Or**: Use `runpodctl` to sync models from cloud storage

```bash
# Install runpodctl
pip install runpodctl

# Sync from your S3/GCS bucket
runpodctl sync s3://your-bucket/models /workspace/ComfyUI/models
```

### Using the Helper Scripts

We provide scripts to make common tasks easier:

```bash
# Check connection to your pod
./deploy/scripts/check-connection.sh https://your-pod-url

# Download a model from Civitai
./deploy/scripts/download-model.sh 128713 dreamshaper_8.safetensors checkpoints

# Tail ComfyUI logs
./deploy/scripts/tail-logs.sh
```

---

## Cost Optimization

### Spot Instances

Use spot/interruptible instances for 50-80% savings:
- Great for development and testing
- May be reclaimed with 30s notice
- Re-deploy if interrupted

### Stop When Not Using

RunPod charges per-minute. Stop your pod when done:
- Models persist on network volumes
- Restarts in ~30 seconds

### Right-size GPU

| Use Case | GPU | ~Cost/hr |
|----------|-----|----------|
| Testing, small models | RTX 3090 | $0.30 |
| SDXL, normal use | RTX 4090 | $0.50 |
| Fast generation, large batches | A40 | $0.80 |
| Maximum performance | A100 | $1.50+ |

---

## Troubleshooting

### "Connection refused"

- Check pod is running in RunPod dashboard
- Verify URL includes `-8188.proxy.runpod.net`
- Check ComfyUI is started (view pod logs)

### "Model not found"

SSH into pod and verify model exists:
```bash
ls /workspace/ComfyUI/models/checkpoints/
```

### Slow generation

- Check GPU utilization in pod metrics
- Consider upgrading GPU tier
- Ensure you're not running out of VRAM (check logs for OOM)

### Timeout errors

Increase timeout in MCP server config or check:
- Network latency to RunPod region
- Pod region (choose closest to you)
- Consider using websocket mode for long generations

---

## Security Notes

- RunPod proxy URLs are **public by default**
- For production, consider:
  - Adding authentication proxy
  - Using RunPod's private networking
  - VPN to your pod
- Never expose sensitive workflows

---

## Files in This Directory

```
deploy/
├── README.md              # This file
├── setup-runpod.sh        # Initial ComfyUI setup script
└── scripts/
    ├── check-connection.sh    # Test connectivity
    ├── download-model.sh      # Download from Civitai
    ├── sync-models.sh         # Sync models from S3/GCS
    └── start-comfyui.sh       # Start ComfyUI with custom args
```
