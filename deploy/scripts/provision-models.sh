#!/bin/bash
#
# Provision models for ComfyUI serverless (SONIC, TTS, SVD)
# Run this in a RunPod provisioner pod with network volume mounted
#
# Usage:
#   ./provision-models.sh hf_YOURTOKEN
#   # Or: curl -sL <raw-url> | bash -s hf_YOURTOKEN
#

set -e

VOLUME="${RUNPOD_VOLUME:-/runpod-volume}"
HF_TOKEN="${1:-$HF_TOKEN}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[X]${NC} $1"; }

# Check volume
if [ ! -d "$VOLUME" ]; then
    err "Network volume not found at $VOLUME"
    exit 1
fi

log "Network volume: $VOLUME"
log "Free space: $(df -h "$VOLUME" | tail -1 | awk '{print $4}')"

# Check token
if [ -z "$HF_TOKEN" ]; then
    err "No HF token provided!"
    err "Usage: $0 hf_YOURTOKEN"
    exit 1
fi

log "HF Token: ${HF_TOKEN:0:10}..."

# Create directories
mkdir -p "$VOLUME"/{sonic,video,whisper,f5_tts,checkpoints}

# Use Python directly - CLI is broken on many images
log "Downloading models via Python API..."

python3 << PYTHON_EOF
import os
os.environ["HF_TOKEN"] = "$HF_TOKEN"
from huggingface_hub import snapshot_download, hf_hub_download

def log(msg):
    print(f"\033[0;32m[+]\033[0m {msg}")

def warn(msg):
    print(f"\033[1;33m[!]\033[0m {msg}")

# SONIC
sonic_marker = "$VOLUME/sonic/unet.pth"
if os.path.exists(sonic_marker):
    log("SONIC already downloaded, skipping")
else:
    log("Downloading SONIC...")
    snapshot_download("LeonJoe13/Sonic", local_dir="$VOLUME/sonic", local_dir_use_symlinks=False)

# SVD
svd_marker = "$VOLUME/video/svd_xt_1_1.safetensors"
if os.path.exists(svd_marker):
    log("SVD already downloaded, skipping")
else:
    log("Downloading SVD XT 1.1...")
    hf_hub_download("stabilityai/stable-video-diffusion-img2vid-xt-1-1", filename="svd_xt_1_1.safetensors", local_dir="$VOLUME/video", local_dir_use_symlinks=False)

# Whisper
whisper_marker = "$VOLUME/whisper/whisper-tiny/config.json"
if os.path.exists(whisper_marker):
    log("Whisper already downloaded, skipping")
else:
    log("Downloading Whisper Tiny...")
    snapshot_download("openai/whisper-tiny", local_dir="$VOLUME/whisper/whisper-tiny", local_dir_use_symlinks=False)

# F5-TTS
f5_marker = "$VOLUME/f5_tts/F5TTS_v1_Base"
if os.path.exists(f5_marker):
    log("F5-TTS already downloaded, skipping")
else:
    log("Downloading F5-TTS...")
    snapshot_download("SWivid/F5-TTS", local_dir="$VOLUME/f5_tts", local_dir_use_symlinks=False)

log("All downloads complete!")
PYTHON_EOF

# Summary
log ""
log "=== Summary ==="
du -sh "$VOLUME"/* 2>/dev/null || true
log ""
log "Total: $(du -sh "$VOLUME" | cut -f1)"
