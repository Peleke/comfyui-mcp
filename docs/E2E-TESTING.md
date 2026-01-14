# E2E Testing Guide

Complete guide for testing the GPU pipeline end-to-end, viewing results, and troubleshooting.

## Overview

The pipeline generates content on a RunPod GPU, uploads to Supabase storage, and provides URLs for viewing. You can run tests from:

1. **This Mac** (direct to RunPod) - Results open in browser automatically
2. **Fly container** (headless) - Returns URLs only, no auto-open

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌───────────┐ │
│  │ Your Mac    │     │ Fly (Jump)  │     │ RunPod GPU  │     │ Supabase  │ │
│  │             │────▶│             │────▶│             │────▶│ Storage   │ │
│  │ npm run e2e │     │ MCP Server  │     │ ComfyUI     │     │ (Private) │ │
│  └─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
│         │                                                           │       │
│         │◀──────────────── Signed URL ─────────────────────────────┘       │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────┐                                                           │
│  │ Browser     │ ◀── Auto-opens on Mac (optional)                          │
│  │ Preview     │                                                           │
│  └─────────────┘                                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### From Mac (Local)

```bash
# 1. Set environment
export COMFYUI_URL="https://<pod-id>-8188.proxy.runpod.net"
export STORAGE_PROVIDER="supabase"
export SUPABASE_URL="https://xxx.supabase.co"
export SUPABASE_SERVICE_KEY="eyJ..."
export SUPABASE_BUCKET="generated-assets"

# 2. Quick smoke test (~30 sec)
npm run e2e:smoke

# 3. Full pipeline test (~5-15 min)
npm run e2e:gpu
```

### From Fly Container (Headless)

```bash
# SSH into Fly container
fly ssh console

# Tests detect headless environment automatically
# No auto-open, just returns URLs
npm run e2e:smoke -- --no-download
npm run e2e:gpu -- --no-download

# Copy URL and paste in your local browser
```

## CLI Options

Both `e2e:smoke` and `e2e:gpu` support these flags:

| Flag | Description | Default (Mac) | Default (Fly) |
|------|-------------|---------------|---------------|
| `--open` | Open results in browser | Yes | No |
| `--no-open` | Skip browser open | - | - |
| `--download` | Download to local `./output` | Yes | No |
| `--no-download` | Skip download, URL only | - | - |
| `--output=PATH` | Download to custom path | - | - |

### Examples

```bash
# Mac: Generate but don't open browser
npm run e2e:smoke -- --no-open

# Mac: Download to specific folder
npm run e2e:gpu -- --output=/Users/me/Desktop/outputs

# Fly: Just get URLs (no download, no open)
npm run e2e:gpu -- --no-download --no-open

# Force open even if headless detected
npm run e2e:smoke -- --open
```

## Test Scripts

### Smoke Test (`npm run e2e:smoke`)

Quick 30-second verification:

1. **Ping ComfyUI** - Verify connectivity
2. **Check GPU** - Verify VRAM available
3. **List Models** - Verify models loaded
4. **Generate Test Image** - 4-step tiny image

**Expected Output (Mac):**
```
🔥 ComfyUI Smoke Test

URL: https://abc123-8188.proxy.runpod.net

1. Ping ComfyUI... ✓ (245ms)
2. Check GPU... ✓ NVIDIA A100-SXM4-80GB
   VRAM: 78.2GB free / 80.0GB
3. List models... ✓ Found 12 models
   First: flux1-schnell-fp8.safetensors
4. Quick generation (4 steps)... ✓ Generated in 2.3s
   Output: /tmp/smoke-test.png
   Opened in browser

✓ All smoke tests passed!

View options: autoOpen=true, download=true
Output: file:///tmp/smoke-test.png
```

### Full Pipeline Test (`npm run e2e:gpu`)

Complete pipeline test (5-15 minutes):

1. **Health Check** - Ping + GPU info
2. **List Models** - Enumerate available checkpoints
3. **Portrait Generation** - Generate character portrait
4. **TTS Generation** - Voice clone + speech synthesis
5. **Lip-Sync Video** - Animate portrait with audio
6. **Cloud Upload** - Upload to Supabase + get signed URL

**Expected Output:**
```
╔══════════════════════════════════════════════════════════════╗
║           GPU E2E Pipeline Test                              ║
╚══════════════════════════════════════════════════════════════╝

ComfyUI URL: https://abc123-8188.proxy.runpod.net
Output Dir:  /tmp/comfyui-e2e
Storage:     supabase

[1/6] Health Check
──────────────────────────────────────────────────
✓ Ping ComfyUI (245ms)
✓ Check GPU & System
  GPU: NVIDIA A100-SXM4-80GB
  VRAM: 78.2GB free / 80.0GB total

[2/6] Check Available Models
──────────────────────────────────────────────────
✓ List checkpoint models
  Found 12 models:
    • flux1-schnell-fp8.safetensors
    • perfectdeliberate_v6.safetensors
    ...

[3/6] Portrait Generation
──────────────────────────────────────────────────
  Using model: perfectdeliberate_v6.safetensors
✓ Generate portrait
  Output: /tmp/comfyui-e2e/e2e_portrait.png (847KB)

[4/6] TTS Voice Cloning
──────────────────────────────────────────────────
✓ Check TTS availability
  F5-TTS: Available
✓ Generate speech
  Output: /tmp/comfyui-e2e/e2e_speech.wav (156KB)

[5/6] Lip-Sync Video Generation
──────────────────────────────────────────────────
✓ Generate lip-sync video
  Output: /tmp/comfyui-e2e/e2e_talking.mp4 (2.4MB)

[6/6] Cloud Upload Verification
──────────────────────────────────────────────────
✓ Upload to supabase
  Uploaded to: e2e-tests/e2e-test-1736523456789.png
  View URL: https://xxx.supabase.co/storage/v1/object/sign/...
  Opened in browser

╔══════════════════════════════════════════════════════════════╗
║                      Test Summary                            ║
╚══════════════════════════════════════════════════════════════╝

✓ Ping ComfyUI (245ms)
✓ Check GPU & System (312ms)
✓ List checkpoint models (89ms)
✓ Generate portrait (45231ms)
✓ Check TTS availability (156ms)
✓ Generate speech (12456ms)
✓ Generate lip-sync video (89234ms)
✓ Upload to supabase (1234ms)

Results: 8/8 passed
All tests passed!
```

## Content Types

### Images (PNG, JPG)

Generated by: `create_portrait`, `generate_image`, `imagine`

```bash
# Generate and view immediately
npm run e2e:smoke -- --open

# Output opens in browser or Preview.app on Mac
```

### Videos (MP4)

Generated by: `lipsync_generate`, `talk`

```bash
# Generate talking head video
npm run e2e:gpu -- --open

# Output opens in default video player (QuickTime on Mac)
```

### Audio (WAV, MP3)

Generated by: `tts_generate`, (future: `ace_step_generate`)

```bash
# Audio files open in default audio player
# Signed URLs work for streaming in browser
```

## Viewing Results

### On Mac

Results auto-open in appropriate app:
- **Images**: Preview.app or browser
- **Videos**: QuickTime or browser
- **Audio**: Music.app or browser

Or manually:
```bash
# Open specific file
open /tmp/comfyui-e2e/e2e_portrait.png

# Open URL in browser
open "https://xxx.supabase.co/storage/v1/object/sign/..."
```

### On Fly (Headless)

Copy the signed URL from test output and paste in your local browser:

```bash
# Test output shows URL like:
# View URL: https://xxx.supabase.co/storage/v1/object/sign/generated-assets/e2e-tests/test.png?token=...

# Copy that URL to your local browser
```

### Programmatic Access

```typescript
import { getStorageProvider } from "./storage/index.js";

// Get signed URL for any file
const provider = getStorageProvider();
const signedUrl = await provider.getSignedUrl("path/to/file.png", 3600);
console.log("View at:", signedUrl);
```

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `COMFYUI_URL` | RunPod proxy URL | `https://abc123-8188.proxy.runpod.net` |

### Optional (Storage)

| Variable | Description | Example |
|----------|-------------|---------|
| `STORAGE_PROVIDER` | `supabase`, `gcp`, or `local` | `supabase` |
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Service role key | `eyJ...` |
| `SUPABASE_BUCKET` | Bucket name | `generated-assets` |

### Optional (Viewing)

| Variable | Description | Example |
|----------|-------------|---------|
| `OUTPUT_PATH` | Default download path | `./output` |

## Troubleshooting

### ComfyUI Not Reachable

```
✗ Ping ComfyUI
  Error: ComfyUI not reachable
```

**Fix**: Check RunPod pod is running and URL is correct:
```bash
curl $COMFYUI_URL/system_stats
```

### No Models Found

```
3. List models... ⚠ Skipped (no models)
```

**Fix**: Run Ansible setup or manually download models:
```bash
ansible-playbook -i inventory/runpod.yml playbooks/full-setup.yml --tags models
```

### Upload Failed

```
✗ Upload to supabase
  Error: Bucket access failed
```

**Fix**: Check Supabase credentials:
```bash
# Verify bucket exists and service key has access
echo $SUPABASE_URL
echo $SUPABASE_BUCKET
```

### Signed URL Expired

Signed URLs expire after 1 hour. Re-run test or generate new URL:
```bash
npm run e2e:gpu  # Generates fresh URLs
```

## Extending for Audio (ACE-Step)

When ACE-Step music generation is added, the same patterns apply:

```typescript
// Future: src/tools/music.ts
export async function generateMusic(params, client): Promise<{
  audio: string;      // Local path
  remote_url?: string; // Supabase URL
  signedUrl?: string;  // For private buckets
}> {
  // ... generate music ...

  // Upload to cloud
  if (params.upload_to_cloud) {
    const result = await provider.upload(audioPath, remotePath);
    return {
      audio: audioPath,
      remote_url: result.url,
      signedUrl: result.signedUrl,
    };
  }

  return { audio: audioPath };
}
```

CLI viewing will work the same:
```bash
# Generate music and open
npm run e2e:music -- --open

# Get URL only (headless)
npm run e2e:music -- --no-download
```
