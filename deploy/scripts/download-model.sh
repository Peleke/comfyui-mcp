#!/bin/bash
#
# Download a model from Civitai to ComfyUI
# Usage: ./download-model.sh <model-id> <filename> <type>
#
# Types: checkpoints, loras, vae, upscale_models
#
# Example:
#   ./download-model.sh 128713 dreamshaper_8.safetensors checkpoints
#

set -e

MODEL_ID="$1"
FILENAME="$2"
TYPE="${3:-checkpoints}"

if [ -z "$MODEL_ID" ] || [ -z "$FILENAME" ]; then
    echo "Usage: $0 <model-id> <filename> [type]"
    echo ""
    echo "Arguments:"
    echo "  model-id  : Civitai model version ID (from URL)"
    echo "  filename  : Name to save as (e.g., dreamshaper_8.safetensors)"
    echo "  type      : Model type (default: checkpoints)"
    echo "              Options: checkpoints, loras, vae, upscale_models"
    echo ""
    echo "Example:"
    echo "  $0 128713 dreamshaper_8.safetensors checkpoints"
    echo ""
    echo "To find the model ID:"
    echo "  1. Go to the model page on Civitai"
    echo "  2. Click the version you want"
    echo "  3. Look at URL: civitai.com/models/xxxx?modelVersionId=YYYYY"
    echo "  4. Use YYYYY as the model-id"
    exit 1
fi

COMFYUI_DIR="${COMFYUI_DIR:-/workspace/ComfyUI}"
TARGET_DIR="$COMFYUI_DIR/models/$TYPE"

if [ ! -d "$TARGET_DIR" ]; then
    echo "Creating directory: $TARGET_DIR"
    mkdir -p "$TARGET_DIR"
fi

TARGET_PATH="$TARGET_DIR/$FILENAME"

if [ -f "$TARGET_PATH" ]; then
    echo "File already exists: $TARGET_PATH"
    read -p "Overwrite? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
fi

echo "Downloading model $MODEL_ID..."
echo "  From: https://civitai.com/api/download/models/$MODEL_ID"
echo "  To:   $TARGET_PATH"
echo ""

# Download with progress
wget --progress=bar:force:noscroll \
    -O "$TARGET_PATH" \
    "https://civitai.com/api/download/models/$MODEL_ID"

echo ""
echo "✓ Downloaded: $TARGET_PATH"
echo ""
echo "Size: $(du -h "$TARGET_PATH" | cut -f1)"
