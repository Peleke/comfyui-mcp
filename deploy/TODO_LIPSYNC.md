# SONIC Lipsync - Resume Tomorrow

**Date**: 2026-01-16
**Status**: Blocked on missing SVD model

## Current State

- TTS working and tested
- Supabase storage working (uploads return proper URLs)
- Portrait generation working
- SONIC sample files downloaded to worker (`avatars/anime1.png`, `sonic_rap_10s.mp3`)
- Handler updated to v16 with fixed `build_lipsync_workflow()`

## What's Blocking Lipsync

### 1. SVD Model Missing from Network Volume

The `ImageOnlyCheckpointLoader` only sees `Deliberate_v5.safetensors`. SONIC requires `svd_xt_1_1.safetensors`.

**Need to download:**
```bash
# On provisioner pod or via SSH to volume
cd /runpod-volume
mkdir -p checkpoints/video
wget -O checkpoints/video/svd_xt_1_1.safetensors \
  "https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt-1-1/resolve/main/svd_xt_1_1.safetensors"
```

Size: ~9GB

### 2. Workers Need Restart

Workers are still on v15. Template updated to v16 but workers need to be killed/restarted.

```bash
# Kill workers via RunPod console or wait for idle timeout
```

## What's Already Fixed in v16

The `build_lipsync_workflow()` function now includes all required SONIC node inputs:

| Node | Added Inputs |
|------|--------------|
| `SONICTLoader` | `ip_audio_scale=1`, `use_interframe=True`, `dtype="fp16"` |
| `SONIC_PreData` | `weight_dtype` connection, `min_resolution=256`, `duration`, `expand_ratio=0.5` |
| `SONICSampler` | `seed`, `control_after_generate`, `fps=25`, `dynamic_scale=1`, `inference_steps` |
| `VHS_VideoCombine` | `loop_count=0`, `format="video/h264-mp4"`, `pingpong=False`, `save_output=True` |

## SONIC Models on Volume (Confirmed Working)

The schema shows these are available:
- `Sonic/unet.pth`
- `Sonic/audio2bucket.pth`
- `Sonic/audio2token.pth`
- `RIFE/flownet.pkl`
- `whisper-tiny/*`

## Test Command (After Fix)

```bash
curl -X POST "https://api.runpod.ai/v2/urauigb5h66a1y/runsync" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "action": "lipsync",
      "portrait_image": "avatars/anime1.png",
      "audio": "sonic_rap_10s.mp3",
      "duration": 10
    }
  }'
```

## Infrastructure Details

- **Endpoint**: `urauigb5h66a1y`
- **Template**: `pqe07kvx5c`
- **Docker Image**: `pelekes/comfyui-serverless:v16`
- **Network Volume**: `g64svtzxd5`

## Files Modified

- `deploy/serverless/handler.py` - Fixed `build_lipsync_workflow()` with all required SONIC inputs
- `deploy/NETWORK_VOLUME_MODELS.md` - Documents expected volume structure

## Next Steps

1. Spin up provisioner pod (or any GPU pod with volume attached)
2. Download SVD model to `/runpod-volume/checkpoints/video/`
3. Kill serverless workers
4. Test lipsync with sample files
5. Commit and tag if working
