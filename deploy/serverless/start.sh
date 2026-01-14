#!/bin/bash
# Start script for ComfyUI Serverless
# Can be used for debugging or running ComfyUI standalone

set -e

echo "Starting ComfyUI..."
cd /workspace/ComfyUI

# Start ComfyUI in background
python main.py --listen 0.0.0.0 --port 8188 &
COMFYUI_PID=$!

echo "ComfyUI started with PID $COMFYUI_PID"

# Wait for it to be ready
echo "Waiting for ComfyUI to be ready..."
for i in {1..60}; do
    if curl -s http://127.0.0.1:8188/system_stats > /dev/null 2>&1; then
        echo "ComfyUI is ready!"
        break
    fi
    sleep 1
done

# Keep running
wait $COMFYUI_PID
