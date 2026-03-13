# SONIC Lipsync Serverless - Checkpoint

**Date:** 2026-01-23
**Status:** v34 - WORKING! Full pipeline: portrait gen, TTS, lipsync with Supabase upload

## What Works

- **Lipsync**: Portrait + audio → talking head video
- **Portrait Generation**: Text prompt → image (saved directly to avatars folder)
- **TTS**: Text + voice sample → cloned speech audio
- **Supabase Upload**: All outputs uploaded with signed URLs

## Critical Lessons Learned

### Volume Mount Paths (THE BIG ONE)

| Environment | Volume Path |
|-------------|-------------|
| Provisioning Pod | `/workspace` |
| Serverless Container | `/runpod-volume` |
| Docker Container (ComfyUI) | `/workspace/ComfyUI` |

The handler creates symlinks at runtime from `/runpod-volume/*` → `/workspace/ComfyUI/models/*`.

### SONIC Model Structure Gotcha

The HuggingFace download puts models in a **subdirectory**:
```
/workspace/sonic/
├── Sonic/           ← Actual models here!
│   ├── unet.pth     ← 5.9GB
│   ├── audio2token.pth
│   └── audio2bucket.pth
├── unet.pth         ← EMPTY 0-byte placeholder!
├── audio2token.pth  ← EMPTY!
└── audio2bucket.pth ← EMPTY!
```

**Fix**: Symlink the real models up one level:
```bash
cd /workspace/sonic
rm -f unet.pth audio2token.pth audio2bucket.pth
ln -s Sonic/unet.pth unet.pth
ln -s Sonic/audio2token.pth audio2token.pth
ln -s Sonic/audio2bucket.pth audio2bucket.pth
```

### Whisper-tiny Location

SONIC expects whisper-tiny INSIDE the sonic folder:
```bash
cd /workspace/sonic
ln -sf ../whisper/whisper-tiny whisper-tiny
```

### SONIC_PreData weight_dtype

The `weight_dtype` input must be a **connection** to SONICTLoader's second output, NOT a string:
```python
# WRONG
"weight_dtype": "fp16"

# CORRECT
"weight_dtype": ["4", 1]  # SONICTLoader output index 1 = DTYPE
```

### Seed Limits

ComfyUI seeds max at 32-bit signed int:
```python
seed = seed % 2147483647
```

## Handler v34 Features

- **save_to_avatars**: Portrait action can save directly to avatars folder
- **Auto audio duration**: ffprobe detection, warns on mismatch
- **Input validation**: Checks files exist before running
- **Supabase error details**: Shows actual error message on upload failure
- **Runtime symlinks**: Creates volume → ComfyUI symlinks at startup

## Test Commands

### Health Check
```bash
curl -s -X POST "https://api.runpod.ai/v2/YOUR_ENDPOINT/runsync" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":{"action":"health"}}' | jq .
```

### Portrait (with save to avatars)
```bash
curl -s -X POST "https://api.runpod.ai/v2/YOUR_ENDPOINT/run" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "action": "portrait",
      "model": "Deliberate_v5.safetensors",
      "description": "Odin, Norse god, one eye, grey beard, wise, portrait",
      "save_to_avatars": true,
      "avatar_name": "odin"
    }
  }' | jq .
```

Response includes:
```json
{
  "avatar_saved": "avatars/odin.png",
  "lipsync_ready": true
}
```

### Lipsync
```bash
curl -s -X POST "https://api.runpod.ai/v2/YOUR_ENDPOINT/run" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "action": "lipsync",
      "portrait_image": "avatars/odin.png",
      "audio": "voices/talk_male_10s.wav"
    }
  }' | jq .
```

### TTS
```bash
curl -s -X POST "https://api.runpod.ai/v2/YOUR_ENDPOINT/run" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "action": "tts",
      "text": "Hello, I am Odin, the Allfather.",
      "voice_sample": "voices/sample.wav"
    }
  }' | jq .
```

## Files on Volume

```
/workspace/  (provisioning) or /runpod-volume/ (serverless)
├── sonic/
│   ├── Sonic/          ← Real models
│   ├── unet.pth        ← Symlink to Sonic/unet.pth
│   ├── audio2token.pth ← Symlink
│   ├── audio2bucket.pth← Symlink
│   └── whisper-tiny    ← Symlink to ../whisper/whisper-tiny
├── video/
│   └── svd_xt_1_1.safetensors
├── whisper/
│   └── whisper-tiny/
├── f5_tts/
│   └── F5TTS_v1_Base/
├── checkpoints/
│   └── Deliberate_v5.safetensors
├── voices/             ← Voice samples for TTS
├── avatars/            ← Portrait images for lipsync
└── ComfyUI/            ← Symlink structure (created by handler)
    ├── models/
    │   ├── sonic -> /runpod-volume/sonic
    │   ├── video -> /runpod-volume/video
    │   └── ...
    └── input/
        ├── voices -> /runpod-volume/voices
        └── avatars -> /runpod-volume/avatars
```

## Provisioning

Run `deploy/scripts/provision-models.sh` on a provisioning pod:
```bash
curl -sL https://raw.githubusercontent.com/.../provision-models.sh | bash -s hf_YOURTOKEN
```

The script:
1. Downloads all models from HuggingFace
2. Fixes SONIC model symlinks
3. Links whisper-tiny into sonic folder
4. Creates ComfyUI directory structure
5. Verifies all critical files

## Build & Deploy

```bash
cd deploy/serverless
docker buildx build --platform linux/amd64 -t pelekes/comfyui-serverless:v34 --push .
```

Then update RunPod template to use new image version.
