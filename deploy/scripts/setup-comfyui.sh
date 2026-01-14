#!/bin/bash
# RunPod Full Setup: ComfyUI + Ollama
# Handles all the bullshit: apt locks, backgrounding, everything

WORKSPACE=/workspace
COMFYUI_DIR=$WORKSPACE/ComfyUI
OLLAMA_MODELS="${OLLAMA_MODELS:-qwen2.5:14b}"

echo "=== RunPod Full Setup ==="

# ============================================================================
# STEP 0: Kill any apt locks (RunPod loves leaving these)
# ============================================================================
echo "[0/5] Clearing apt locks..."
pkill -9 apt-get 2>/dev/null || true
pkill -9 dpkg 2>/dev/null || true
rm -f /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/cache/apt/archives/lock 2>/dev/null || true
dpkg --configure -a 2>/dev/null || true

# ============================================================================
# STEP 1: Install system dependencies
# ============================================================================
echo "[1/5] Installing system dependencies..."
apt-get update && apt-get install -y git python3 python3-pip curl

# ============================================================================
# STEP 2: Install Ollama
# ============================================================================
echo "[2/5] Installing Ollama..."
if ! command -v ollama &> /dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
fi

# Start Ollama in background
echo "Starting Ollama server..."
OLLAMA_HOST=0.0.0.0 nohup ollama serve > /var/log/ollama.log 2>&1 &
sleep 3

# Pull models in background
echo "Pulling Ollama models in background: $OLLAMA_MODELS"
for model in $OLLAMA_MODELS; do
    nohup ollama pull $model >> /var/log/ollama-pull.log 2>&1 &
done

# ============================================================================
# STEP 3: Clone/Update ComfyUI
# ============================================================================
echo "[3/5] Setting up ComfyUI..."

if [ -d "$COMFYUI_DIR" ]; then
    echo "ComfyUI found, updating..."
    cd $COMFYUI_DIR
    git pull || echo "Git pull failed, continuing..."
else
    echo "Cloning ComfyUI..."
    cd $WORKSPACE
    git clone https://github.com/comfyanonymous/ComfyUI.git
    cd $COMFYUI_DIR
fi

# ============================================================================
# STEP 4: Install Python dependencies
# ============================================================================
echo "[4/5] Installing Python dependencies..."
cd $COMFYUI_DIR
pip3 install --break-system-packages -r requirements.txt
pip3 install --break-system-packages websocket-client aiohttp

# Create directories
mkdir -p models/checkpoints models/loras models/upscale_models models/vae models/clip
mkdir -p input/avatars input/voices output

# ============================================================================
# STEP 5: Create restart script
# ============================================================================
echo "[5/5] Creating restart script..."

cat > $WORKSPACE/restart.sh << 'RESTART_EOF'
#!/bin/bash
# Quick restart after pod restarts

# Kill apt locks
pkill -9 apt-get 2>/dev/null; pkill -9 dpkg 2>/dev/null
rm -f /var/lib/dpkg/lock* /var/cache/apt/archives/lock 2>/dev/null

# Start Ollama
OLLAMA_HOST=0.0.0.0 nohup ollama serve > /var/log/ollama.log 2>&1 &
sleep 2

# Start ComfyUI
cd /workspace/ComfyUI
nohup python3 main.py --listen 0.0.0.0 --port 8188 --enable-cors-header > /var/log/comfyui.log 2>&1 &
sleep 3

echo "Services started. Check:"
echo "  ComfyUI: curl http://localhost:8188/system_stats"
echo "  Ollama:  curl http://localhost:11434/api/tags"
RESTART_EOF
chmod +x $WORKSPACE/restart.sh

# ============================================================================
# DONE - Start ComfyUI in background
# ============================================================================
echo ""
echo "=== Starting Services ==="

cd $COMFYUI_DIR
nohup python3 main.py --listen 0.0.0.0 --port 8188 --enable-cors-header > /var/log/comfyui.log 2>&1 &
sleep 5

echo ""
echo "=== Setup Complete ==="
echo ""
echo "ComfyUI: http://localhost:8188"
echo "Ollama:  http://localhost:11434"
echo ""
echo "Check status:"
echo "  curl http://localhost:8188/system_stats"
echo "  curl http://localhost:11434/api/tags"
echo "  tail -f /var/log/comfyui.log"
echo "  tail -f /var/log/ollama-pull.log"
echo ""
echo "After pod restart: /workspace/restart.sh"
