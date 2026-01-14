# ComfyUI RunPod Serverless Deployment

Deploy ComfyUI as a serverless endpoint with stable URL, auto-scaling, and pay-per-compute pricing.

## Why Serverless?

| Aspect | Pods (Old Way) | Serverless (This) |
|--------|---------------|-------------------|
| URL | Changes on restart | **Stable forever** |
| Setup | SSH + Ansible | Docker image |
| Scaling | Manual | Auto 0→N |
| Billing | Per hour (idle too) | Per second (compute only) |

## Quick Start

### 1. Build the Docker Image

```bash
cd deploy/serverless

# Build locally
docker build -t yourdockerhub/comfyui-serverless:latest .

# Push to Docker Hub
docker login
docker push yourdockerhub/comfyui-serverless:latest
```

### 2. Create RunPod Serverless Endpoint

1. Go to [RunPod Console](https://www.runpod.io/console/serverless)
2. Click **New Endpoint**
3. Configure:
   - **Docker Image**: `yourdockerhub/comfyui-serverless:latest`
   - **GPU**: RTX 4090 (or A100 for SONIC)
   - **Min Workers**: 0 (scale to zero when idle)
   - **Max Workers**: 3 (adjust based on load)
   - **Idle Timeout**: 5 seconds
4. Click **Create**
5. Copy the **Endpoint ID** (e.g., `abc123def456`)

### 3. Test the Endpoint

```bash
# Set your credentials
export RUNPOD_ENDPOINT_ID="abc123def456"
export RUNPOD_API_KEY="your-runpod-api-key"

# Health check
curl -X POST "https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/runsync" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"input": {"action": "health"}}'

# Generate portrait
curl -X POST "https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/runsync" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "action": "portrait",
      "description": "Viking warrior with braided beard",
      "width": 768,
      "height": 1024,
      "steps": 20
    }
  }'
```

## API Reference

### Actions

#### `portrait` - Generate Portrait Image
```json
{
  "input": {
    "action": "portrait",
    "description": "A description of the portrait",
    "model": "sd_xl_base_1.0.safetensors",
    "width": 768,
    "height": 1024,
    "steps": 20,
    "cfg_scale": 7.0,
    "seed": -1
  }
}
```

#### `tts` - Text-to-Speech with Voice Cloning
```json
{
  "input": {
    "action": "tts",
    "text": "Hello, this is a test.",
    "voice_reference": "reference.wav",
    "voice_reference_text": "Optional transcript of reference",
    "speed": 1.0,
    "seed": -1
  }
}
```

#### `lipsync` - Lip-Sync Video Generation
```json
{
  "input": {
    "action": "lipsync",
    "portrait_image": "portrait.png",
    "audio": "speech.wav",
    "svd_checkpoint": "svd_xt_1_1.safetensors",
    "inference_steps": 25,
    "fps": 25.0
  }
}
```

#### `health` - Health Check
```json
{
  "input": {
    "action": "health"
  }
}
```

### Response Format

```json
{
  "status": "success",
  "action": "portrait",
  "files": [
    {
      "type": "image",
      "filename": "portrait_12345.png",
      "data": "base64-encoded-content",
      "encoding": "base64"
    }
  ],
  "prompt_id": "abc-123-def"
}
```

## Adding Models

### Option A: Bake into Docker Image (Larger image, faster cold start)

Uncomment the model download lines in Dockerfile:

```dockerfile
RUN wget -O /workspace/ComfyUI/models/checkpoints/sd_xl_base_1.0.safetensors \
    "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"
```

### Option B: Network Volume (Smaller image, slower cold start)

1. Create a Network Volume on RunPod
2. Upload models to the volume
3. Mount volume at `/workspace/ComfyUI/models` in endpoint config

## Cost Optimization

| Strategy | Savings |
|----------|---------|
| Scale to zero | No cost when idle |
| Use 4090 instead of A100 | 60% cheaper |
| Batch requests | Amortize cold start |
| Enable FlashBoot | Faster cold starts |

## Troubleshooting

### Cold Start Timeout
- Increase `Idle Timeout` in endpoint settings
- Consider `min_workers=1` during active development

### Out of Memory
- Use A100-40GB for SONIC
- Reduce batch size
- Use fp16 models

### Model Not Found
- Check model path in workflow
- Verify model is in Docker image or network volume
