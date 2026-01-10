#!/bin/bash
#
# Start ComfyUI with recommended settings for MCP usage
#

COMFYUI_DIR="${COMFYUI_DIR:-/workspace/ComfyUI}"
PORT="${PORT:-8188}"
HOST="${HOST:-0.0.0.0}"

cd "$COMFYUI_DIR"

echo "Starting ComfyUI..."
echo "  Directory: $COMFYUI_DIR"
echo "  Host: $HOST"
echo "  Port: $PORT"
echo ""

# Check for NVIDIA GPU
if command -v nvidia-smi &> /dev/null; then
    echo "GPU Info:"
    nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader
    echo ""
fi

exec python main.py \
    --listen "$HOST" \
    --port "$PORT" \
    --enable-cors-header \
    "$@"
