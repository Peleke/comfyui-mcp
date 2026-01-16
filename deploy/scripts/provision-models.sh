#!/bin/bash
#
# Provision models for ComfyUI serverless (SONIC, TTS, SVD)
# Run this in a RunPod provisioner pod with network volume mounted
#
# Usage:
#   # Set HF_TOKEN env var or pass as argument
#   export HF_TOKEN="hf_xxxxx"
#   ./provision-models.sh
#
#   # Or pass token directly
#   ./provision-models.sh hf_xxxxx
#

set -e

# Configuration
VOLUME="${RUNPOD_VOLUME:-/runpod-volume}"
HF_TOKEN="${1:-$HF_TOKEN}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[X]${NC} $1"; }

# Check volume
if [ ! -d "$VOLUME" ]; then
    err "Network volume not found at $VOLUME"
    err "Make sure you're running this in a pod with the volume mounted"
    exit 1
fi

log "Network volume: $VOLUME"
log "Free space: $(df -h "$VOLUME" | tail -1 | awk '{print $4}')"

# Install HuggingFace CLI if needed
if ! command -v huggingface-cli &> /dev/null; then
    log "Installing huggingface_hub..."
    pip install -q "huggingface_hub[cli]"
fi

# Login if token provided
if [ -n "$HF_TOKEN" ]; then
    log "Logging in to HuggingFace..."
    huggingface-cli login --token "$HF_TOKEN" --add-to-git-credential
else
    warn "No HF_TOKEN provided - some gated models may fail"
    warn "Set HF_TOKEN env var or pass as argument"
fi

# Create directories
mkdir -p "$VOLUME"/{checkpoints,sonic,f5_tts,whisper,video}

# ============================================================================
# SONIC (Lip-Sync)
# ============================================================================
log ""
log "=== SONIC Models ==="

if [ -f "$VOLUME/sonic/unet.pth" ]; then
    log "SONIC already downloaded, skipping"
else
    log "Downloading SONIC from LeonJoe13/Sonic..."
    huggingface-cli download LeonJoe13/Sonic \
        --local-dir "$VOLUME/sonic" \
        --local-dir-use-symlinks False
fi

# ============================================================================
# SVD (Stable Video Diffusion for SONIC)
# ============================================================================
log ""
log "=== SVD XT 1.1 ==="

if [ -f "$VOLUME/video/svd_xt_1_1.safetensors" ]; then
    log "SVD already downloaded, skipping"
else
    log "Downloading SVD XT 1.1..."
    huggingface-cli download stabilityai/stable-video-diffusion-img2vid-xt-1-1 \
        svd_xt_1_1.safetensors \
        --local-dir "$VOLUME/video" \
        --local-dir-use-symlinks False
fi

# ============================================================================
# Whisper (for SONIC audio processing)
# ============================================================================
log ""
log "=== Whisper Tiny ==="

if [ -d "$VOLUME/whisper/whisper-tiny" ]; then
    log "Whisper already downloaded, skipping"
else
    log "Downloading Whisper Tiny..."
    huggingface-cli download openai/whisper-tiny \
        --local-dir "$VOLUME/whisper/whisper-tiny" \
        --local-dir-use-symlinks False
fi

# ============================================================================
# F5-TTS (Voice Cloning)
# ============================================================================
log ""
log "=== F5-TTS ==="

if [ -f "$VOLUME/f5_tts/F5TTS_v1_Base/model_1250000.safetensors" ]; then
    log "F5-TTS already downloaded, skipping"
else
    log "Downloading F5-TTS..."
    huggingface-cli download SWivid/F5-TTS \
        --local-dir "$VOLUME/f5_tts" \
        --local-dir-use-symlinks False
fi

# ============================================================================
# Summary
# ============================================================================
log ""
log "=== Download Complete ==="
log ""
log "Volume contents:"
ls -la "$VOLUME"
log ""
log "SONIC:"
ls -la "$VOLUME/sonic" 2>/dev/null || warn "SONIC not found"
log ""
log "Checkpoints:"
ls -la "$VOLUME/checkpoints" 2>/dev/null || warn "No checkpoints"
log ""
log "Video:"
ls -la "$VOLUME/video" 2>/dev/null || warn "No video models"
log ""
log "Disk usage:"
du -sh "$VOLUME"/*
log ""
log "Total: $(du -sh "$VOLUME" | cut -f1)"
