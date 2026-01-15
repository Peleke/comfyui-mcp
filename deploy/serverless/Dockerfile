# ComfyUI Serverless Docker Image for RunPod
# Includes: ComfyUI, SONIC (lip-sync), F5-TTS (voice cloning)
#
# Build: docker build -t yourdockerhub/comfyui-serverless:latest .
# Push:  docker push yourdockerhub/comfyui-serverless:latest

FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# System dependencies
RUN apt-get update && apt-get install -y \
    git \
    wget \
    ffmpeg \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install ComfyUI
WORKDIR /workspace
RUN git clone https://github.com/comfyanonymous/ComfyUI.git
WORKDIR /workspace/ComfyUI
RUN pip install --no-cache-dir -r requirements.txt

# Create directories
RUN mkdir -p models/checkpoints models/loras models/vae models/video \
    custom_nodes input/voices input/avatars output

# Install ComfyUI Manager (for easier node management)
WORKDIR /workspace/ComfyUI/custom_nodes
RUN git clone https://github.com/ltdrdata/ComfyUI-Manager.git

# Install F5-TTS for voice cloning
RUN git clone https://github.com/SWivid/ComfyUI-F5-TTS.git \
    && cd ComfyUI-F5-TTS \
    && pip install --no-cache-dir -r requirements.txt || true

# Install Video Helper Suite (for video output)
RUN git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git \
    && cd ComfyUI-VideoHelperSuite \
    && pip install --no-cache-dir -r requirements.txt || true

# Install SONIC for lip-sync (if available)
# Note: SONIC may require manual setup - check repo for instructions
RUN git clone https://github.com/AIFSH/ComfyUI-SONIC.git 2>/dev/null || echo "SONIC not available, will use alternative"

# Install runpod SDK
RUN pip install --no-cache-dir runpod requests

# Copy handler
WORKDIR /workspace
COPY handler.py /workspace/handler.py
COPY start.sh /workspace/start.sh
RUN chmod +x /workspace/start.sh

# Download models at build time (optional - can also mount network volume)
# Uncomment to bake models into image (increases image size significantly)
# RUN wget -O /workspace/ComfyUI/models/checkpoints/sd_xl_base_1.0.safetensors \
#     "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors"

# Expose ComfyUI port (internal only)
EXPOSE 8188

# Start handler
CMD ["python", "-u", "/workspace/handler.py"]
