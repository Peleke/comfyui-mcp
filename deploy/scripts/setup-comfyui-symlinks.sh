#!/bin/bash
#
# Create ComfyUI directory structure with symlinks to network volume
#
# The problem:
#   - Provisioning scripts download models to /workspace/<dir>/
#   - Serverless handler expects /workspace/ComfyUI/models/<dir>/
#   - Docker creates empty /workspace/ComfyUI/models/ dirs
#   - Network volume has models at root, not in ComfyUI subdirs
#
# This script creates the symlink bridge.
#
# Usage (on provisioning pod):
#   ./setup-comfyui-symlinks.sh
#
# Or run inline:
#   curl -sL <raw-url> | bash
#

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }

WORKSPACE="/workspace"

log "Setting up ComfyUI symlink structure..."

# Create ComfyUI directory structure
mkdir -p "$WORKSPACE/ComfyUI/models"
mkdir -p "$WORKSPACE/ComfyUI/input"
mkdir -p "$WORKSPACE/ComfyUI/output"

# Model directories to symlink
MODEL_DIRS=(
    "checkpoints"
    "video"
    "sonic"
    "f5_tts"
    "whisper"
    "controlnet"
    "loras"
    "vae"
    "clip"
    "clip_vision"
    "animatediff_models"
    "text_encoders"
)

# Create model symlinks
for dir in "${MODEL_DIRS[@]}"; do
    src="$WORKSPACE/$dir"
    dst="$WORKSPACE/ComfyUI/models/$dir"

    if [ -d "$src" ]; then
        # Remove existing (could be empty dir from Docker)
        if [ -d "$dst" ] && [ ! -L "$dst" ]; then
            rmdir "$dst" 2>/dev/null || rm -rf "$dst"
        fi

        if [ ! -e "$dst" ]; then
            ln -sf "$src" "$dst"
            log "Linked: $dir"
        else
            warn "Already exists: $dst"
        fi
    fi
done

# Input directories (voices, avatars)
INPUT_DIRS=("voices" "avatars")

for dir in "${INPUT_DIRS[@]}"; do
    src="$WORKSPACE/$dir"
    dst="$WORKSPACE/ComfyUI/input/$dir"

    if [ -d "$src" ]; then
        if [ -d "$dst" ] && [ ! -L "$dst" ]; then
            rmdir "$dst" 2>/dev/null || rm -rf "$dst"
        fi

        if [ ! -e "$dst" ]; then
            ln -sf "$src" "$dst"
            log "Linked input: $dir"
        fi
    else
        # Create empty dir if doesn't exist
        mkdir -p "$src"
        if [ ! -e "$dst" ]; then
            ln -sf "$src" "$dst"
            log "Created and linked input: $dir"
        fi
    fi
done

log ""
log "=== Symlink Structure ==="
log "Models:"
ls -la "$WORKSPACE/ComfyUI/models/" 2>/dev/null | grep -E "^l" || log "  (none)"
log ""
log "Inputs:"
ls -la "$WORKSPACE/ComfyUI/input/" 2>/dev/null | grep -E "^l" || log "  (none)"
log ""
log "Done! Handler will find models at /workspace/ComfyUI/models/"
