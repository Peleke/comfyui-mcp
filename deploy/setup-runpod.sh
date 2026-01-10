#!/bin/bash
#
# ComfyUI Setup Script for RunPod
#
# Run this on a fresh RunPod pod to set up ComfyUI with common models.
# Usage: curl -fsSL <url>/setup-runpod.sh | bash
#

set -e

echo "=========================================="
echo "ComfyUI Setup for RunPod"
echo "=========================================="

COMFYUI_DIR="/workspace/ComfyUI"
MODELS_DIR="$COMFYUI_DIR/models"

# Check if ComfyUI already exists
if [ -d "$COMFYUI_DIR" ]; then
    echo "ComfyUI directory exists. Checking installation..."
    cd "$COMFYUI_DIR"
    git pull || true
else
    echo "Cloning ComfyUI..."
    cd /workspace
    git clone https://github.com/comfyanonymous/ComfyUI.git
    cd "$COMFYUI_DIR"
fi

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Install additional dependencies for MCP compatibility
pip install websocket-client

# Create model directories if they don't exist
mkdir -p "$MODELS_DIR/checkpoints"
mkdir -p "$MODELS_DIR/loras"
mkdir -p "$MODELS_DIR/upscale_models"
mkdir -p "$MODELS_DIR/vae"
mkdir -p "$COMFYUI_DIR/input"
mkdir -p "$COMFYUI_DIR/output"

# Download essential upscale model if not present
if [ ! -f "$MODELS_DIR/upscale_models/RealESRGAN_x4plus.pth" ]; then
    echo "Downloading RealESRGAN upscale model..."
    wget -q -O "$MODELS_DIR/upscale_models/RealESRGAN_x4plus.pth" \
        "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"
fi

# Create startup script
cat > /workspace/start-comfyui.sh << 'EOF'
#!/bin/bash
cd /workspace/ComfyUI
python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header
EOF
chmod +x /workspace/start-comfyui.sh

# Create systemd service for auto-start (if systemd available)
if command -v systemctl &> /dev/null; then
    cat > /etc/systemd/system/comfyui.service << EOF
[Unit]
Description=ComfyUI
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/workspace/ComfyUI
ExecStart=/usr/bin/python main.py --listen 0.0.0.0 --port 8188 --enable-cors-header
Restart=always

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable comfyui
    echo "ComfyUI service installed. Start with: systemctl start comfyui"
fi

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Download models to: $MODELS_DIR/checkpoints/"
echo "   Example:"
echo "   wget -O $MODELS_DIR/checkpoints/dreamshaper_8.safetensors \\"
echo "     'https://civitai.com/api/download/models/128713'"
echo ""
echo "2. Start ComfyUI:"
echo "   /workspace/start-comfyui.sh"
echo ""
echo "3. Access via RunPod proxy URL (port 8188)"
echo ""
echo "4. Configure your local MCP server with the URL"
echo ""
