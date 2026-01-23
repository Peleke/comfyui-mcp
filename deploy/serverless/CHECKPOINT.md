# SONIC Lipsync Serverless - Checkpoint

**Date:** 2026-01-22
**Status:** BROKEN - workflow errors, no output

## Goal

Get SONIC lip-sync working on RunPod serverless with Supabase upload.

## Current State

- Docker image: `pelekes/comfyui-serverless:v25`
- RunPod endpoint: `urauigb5h66a1y`
- Handler version: `v25-match-working-workflow`

### What Works
- ComfyUI starts successfully on RunPod
- Model symlinks work (checkpoints, sonic, video, voices, avatars)
- Supabase integration is configured
- Portrait generation workflow (untested recently but was working)

### What's Broken
- SONIC lipsync workflow returns `status_str: "error"` with empty outputs
- `history_output_nodes: []` means ComfyUI workflow fails silently

## Working Reference

The MCP server has a working workflow at `src/workflows/lipsync-sonic.json`:

```json
{
  "1": {"class_type": "ImageOnlyCheckpointLoader", "inputs": {"ckpt_name": "video/svd_xt_1_1.safetensors"}},
  "4": {"class_type": "LoadImage", "inputs": {"image": "portrait.png"}},
  "5": {"class_type": "LoadAudio", "inputs": {"audio": "speech.wav"}},
  "6": {"class_type": "SONICTLoader", "inputs": {"model": ["1", 0], "sonic_unet": "unet.pth", "ip_audio_scale": 1.0, "use_interframe": true, "dtype": "fp16"}},
  "7": {"class_type": "SONIC_PreData", "inputs": {"clip_vision": ["1", 1], "vae": ["1", 2], "audio": ["5", 0], "image": ["4", 0], "min_resolution": 512, "duration": 99999, "expand_ratio": 1}},
  "8": {"class_type": "SONICSampler", "inputs": {"model": ["6", 0], "data_dict": ["7", 0], "seed": 0, "randomize": "randomize", "inference_steps": 25, "dynamic_scale": 1.0, "fps": 25.0}},
  "9": {"class_type": "VHS_VideoCombine", "inputs": {"images": ["8", 0], "audio": ["5", 0], "frame_rate": ["8", 1], "loop_count": 0, "filename_prefix": "ComfyUI_LipSync", "format": "video/h264-mp4", "pingpong": false, "save_output": true}}
}
```

## Test Files on RunPod Volume

- Portrait: `/runpod-volume/avatars/anime1.png`
- Audio: `/runpod-volume/voices/talk_male_10s.wav`
- SVD model: `/runpod-volume/video/svd_xt_1_1.safetensors`
- SONIC unet: `/runpod-volume/sonic/unet.pth`

## Known Issues

1. **`duration: 99999`** - Magic number meaning "use full audio". Probably wrong, needs actual audio duration or reasonable default.

2. **No error details** - ComfyUI returns `status_str: "error"` but we don't capture the actual error message from the execution. Need to check `history.get("status", {}).get("messages", [])` or similar.

3. **Workflow not validated locally** - We've been deploying to RunPod without testing the workflow structure locally first. Should test against local ComfyUI or use ComfyUI's `/prompt` validation endpoint.

## Next Steps

1. **Get actual error message** - Modify handler to return full `history["status"]` to see why workflow fails

2. **Test workflow locally** - Use the MCP server's existing lipsync tools to verify the workflow works before porting to serverless

3. **Check SONIC node versions** - The ComfyUI_Sonic plugin on RunPod may have different node signatures than expected

4. **Validate inputs exist** - Before running workflow, verify portrait/audio files actually exist at expected paths

## Test Command

```bash
curl -s -X POST "https://api.runpod.ai/v2/urauigb5h66a1y/runsync" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":{"action":"lipsync","portrait_image":"avatars/anime1.png","audio":"voices/talk_male_10s.wav","svd_checkpoint":"video/svd_xt_1_1.safetensors"}}' | jq .
```

## Debug Command

```bash
curl -s -X POST "https://api.runpod.ai/v2/urauigb5h66a1y/runsync" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":{"action":"debug"}}' | jq .
```

## Files

- Handler: `deploy/serverless/handler.py`
- Dockerfile: `deploy/serverless/Dockerfile`
- Working workflow reference: `src/workflows/lipsync-sonic.json`
- MCP lipsync tool: `src/tools/lipsync.ts`
