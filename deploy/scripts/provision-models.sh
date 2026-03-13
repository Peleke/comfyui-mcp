#!/bin/bash
#
# Provision models for ComfyUI serverless (SONIC, TTS, SVD)
# Run this in a RunPod provisioner pod with network volume mounted
#
# IMPORTANT: On provisioning pods, the volume is at /workspace
#            On serverless containers, it's at /runpod-volume
#
# Usage:
#   ./provision-models.sh hf_YOURTOKEN
#   # Or: curl -sL <raw-url> | bash -s hf_YOURTOKEN
#

set -e

# Provisioning pod mounts at /workspace, NOT /runpod-volume
VOLUME="${WORKSPACE:-/workspace}"
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
    err "If on a provisioning pod, try: WORKSPACE=/workspace $0 $1"
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
mkdir -p "$VOLUME"/{sonic,video,whisper,f5_tts,checkpoints,voices,avatars}

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

# SONIC - downloads to $VOLUME/sonic/ with Sonic/ subdirectory
sonic_marker = "$VOLUME/sonic/Sonic/unet.pth"
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

# Whisper - SONIC needs this in the sonic folder
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

# =============================================================================
# FIX SONIC MODEL STRUCTURE
# =============================================================================
# The SONIC download puts models in $VOLUME/sonic/Sonic/ subdirectory
# but ComfyUI expects them at $VOLUME/sonic/
# We need to symlink them up one level

log ""
log "=== Fixing SONIC model structure ==="

cd "$VOLUME/sonic"

# Remove empty placeholder files and create symlinks to Sonic/ subdirectory
for model in unet.pth audio2bucket.pth audio2token.pth; do
    if [ -f "Sonic/$model" ]; then
        # Remove empty placeholder if exists
        if [ -f "$model" ] && [ ! -s "$model" ]; then
            rm -f "$model"
            log "Removed empty placeholder: $model"
        fi
        # Create symlink if not exists
        if [ ! -e "$model" ]; then
            ln -sf "Sonic/$model" "$model"
            log "Linked SONIC model: $model -> Sonic/$model"
        fi
    fi
done

# Symlink whisper-tiny into sonic folder (SONIC expects it here)
if [ -d "$VOLUME/whisper/whisper-tiny" ] && [ ! -e "$VOLUME/sonic/whisper-tiny" ]; then
    cd "$VOLUME/sonic"
    ln -sf ../whisper/whisper-tiny whisper-tiny
    log "Linked whisper-tiny into sonic folder"
fi

# =============================================================================
# CREATE COMFYUI SYMLINK STRUCTURE
# =============================================================================
# Note: This is for if you want to pre-create the structure on the volume.
# The serverless handler also creates these symlinks at runtime.

log ""
log "=== Setting up ComfyUI symlinks ==="

# Create ComfyUI directory structure
mkdir -p "$VOLUME/ComfyUI/models"
mkdir -p "$VOLUME/ComfyUI/input"
mkdir -p "$VOLUME/ComfyUI/output"

# Symlink model directories
for dir in sonic video whisper f5_tts checkpoints controlnet loras vae animatediff_models; do
    src="$VOLUME/$dir"
    dst="$VOLUME/ComfyUI/models/$dir"
    if [ -d "$src" ]; then
        [ -d "$dst" ] && [ ! -L "$dst" ] && rm -rf "$dst"
        [ ! -e "$dst" ] && ln -sf "$src" "$dst" && log "Linked: $dir"
    fi
done

# Symlink input directories
for dir in voices avatars; do
    src="$VOLUME/$dir"
    dst="$VOLUME/ComfyUI/input/$dir"
    mkdir -p "$src"
    [ -d "$dst" ] && [ ! -L "$dst" ] && rm -rf "$dst"
    [ ! -e "$dst" ] && ln -sf "$src" "$dst" && log "Linked input: $dir"
done

# =============================================================================
# VERIFICATION
# =============================================================================

log ""
log "=== Verification ==="

# Check critical files
check_file() {
    if [ -e "$1" ]; then
        size=$(ls -lh "$1" 2>/dev/null | awk '{print $5}')
        log "OK: $1 ($size)"
    else
        err "MISSING: $1"
    fi
}

log "SONIC models:"
check_file "$VOLUME/sonic/unet.pth"
check_file "$VOLUME/sonic/audio2token.pth"
check_file "$VOLUME/sonic/audio2bucket.pth"
check_file "$VOLUME/sonic/whisper-tiny/preprocessor_config.json"

log ""
log "Video models:"
check_file "$VOLUME/video/svd_xt_1_1.safetensors"

log ""
log "TTS models:"
check_file "$VOLUME/f5_tts/F5TTS_v1_Base"

# Summary
log ""
log "=== Summary ==="
du -sh "$VOLUME"/* 2>/dev/null | head -20 || true
log ""
log "Total: $(du -sh "$VOLUME" | cut -f1)"
log ""
log "Volume ready for serverless!"
log ""
log "IMPORTANT: Serverless containers mount this volume at /runpod-volume"
log "           (not /workspace like provisioning pods)"
