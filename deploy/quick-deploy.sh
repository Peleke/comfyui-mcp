#!/bin/bash
#
# Quick Deploy - One command to set up everything on RunPod
#
# Usage (on RunPod):
#   curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/main/deploy/quick-deploy.sh | bash
#
# Or with specific models:
#   curl -fsSL ... | bash -s -- --dreamshaper --illustrious
#

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  ComfyUI Quick Deploy for RunPod                          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

COMFYUI_DIR="/workspace/ComfyUI"
MODELS_DIR="$COMFYUI_DIR/models"

# Parse arguments
INSTALL_DREAMSHAPER=false
INSTALL_ILLUSTRIOUS=false
INSTALL_FLUX=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --dreamshaper) INSTALL_DREAMSHAPER=true; shift ;;
        --illustrious) INSTALL_ILLUSTRIOUS=true; shift ;;
        --flux) INSTALL_FLUX=true; shift ;;
        --all) INSTALL_DREAMSHAPER=true; INSTALL_ILLUSTRIOUS=true; shift ;;
        *) shift ;;
    esac
done

# Step 1: Clone/Update ComfyUI
echo "Step 1: Setting up ComfyUI..."
if [ -d "$COMFYUI_DIR" ]; then
    echo "  Updating existing installation..."
    cd "$COMFYUI_DIR"
    git pull || true
else
    echo "  Cloning ComfyUI..."
    cd /workspace
    git clone https://github.com/comfyanonymous/ComfyUI.git
    cd "$COMFYUI_DIR"
fi

# Step 2: Install dependencies
echo ""
echo "Step 2: Installing dependencies..."
pip install -q -r requirements.txt
pip install -q websocket-client

# Step 3: Create directories
echo ""
echo "Step 3: Creating directories..."
mkdir -p "$MODELS_DIR/checkpoints"
mkdir -p "$MODELS_DIR/loras"
mkdir -p "$MODELS_DIR/upscale_models"
mkdir -p "$MODELS_DIR/vae"
mkdir -p "$COMFYUI_DIR/input"
mkdir -p "$COMFYUI_DIR/output"

# Step 4: Download upscale model (always needed)
echo ""
echo "Step 4: Downloading upscale model..."
if [ ! -f "$MODELS_DIR/upscale_models/RealESRGAN_x4plus.pth" ]; then
    wget -q --show-progress -O "$MODELS_DIR/upscale_models/RealESRGAN_x4plus.pth" \
        "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"
else
    echo "  Already exists, skipping"
fi

# Step 5: Download requested models
echo ""
echo "Step 5: Downloading models..."

if [ "$INSTALL_DREAMSHAPER" = true ]; then
    echo "  Downloading DreamShaper 8..."
    if [ ! -f "$MODELS_DIR/checkpoints/dreamshaper_8.safetensors" ]; then
        wget -q --show-progress -O "$MODELS_DIR/checkpoints/dreamshaper_8.safetensors" \
            "https://civitai.com/api/download/models/128713"
    else
        echo "    Already exists, skipping"
    fi
fi

if [ "$INSTALL_ILLUSTRIOUS" = true ]; then
    echo "  Downloading Illustrious XL..."
    echo "    Note: You may need to download manually from Civitai (login required)"
    echo "    Place file at: $MODELS_DIR/checkpoints/illustrious_xl.safetensors"
fi

if [ "$INSTALL_FLUX" = true ]; then
    echo "  Note: Flux models require manual download from HuggingFace"
    echo "    Place files at: $MODELS_DIR/checkpoints/"
fi

# Step 6: Create start script
echo ""
echo "Step 6: Creating startup script..."
cat > /workspace/start.sh << 'EOF'
#!/bin/bash
cd /workspace/ComfyUI
python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header
EOF
chmod +x /workspace/start.sh

# Step 7: Show summary
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  Setup Complete!                                           ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Available models:"
ls -la "$MODELS_DIR/checkpoints/" 2>/dev/null || echo "  (none yet)"
echo ""
echo "To start ComfyUI:"
echo "  /workspace/start.sh"
echo ""
echo "Or in background:"
echo "  nohup /workspace/start.sh > /workspace/comfyui.log 2>&1 &"
echo ""
echo "Your RunPod URL will be:"
echo "  https://<POD_ID>-8188.proxy.runpod.net"
echo ""
echo "Find your POD_ID in the RunPod dashboard."
echo ""

# Auto-start ComfyUI
read -p "Start ComfyUI now? (Y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    echo "Starting ComfyUI in background..."
    nohup /workspace/start.sh > /workspace/comfyui.log 2>&1 &
    sleep 3
    echo "ComfyUI starting... Check logs with: tail -f /workspace/comfyui.log"
fi
