#!/usr/bin/env bash
#
# Provision RunPod Network Volume with AI Models
#
# This script:
#   1. Creates a temporary GPU pod with the network volume attached
#   2. Downloads all required models to the volume
#   3. Terminates the pod (volume persists)
#
# Usage:
#   ./provision-volume.sh <volume_id> <datacenter>
#   ./provision-volume.sh vol_abc123 US-TX-3
#
# Environment:
#   RUNPOD_API_KEY - Required
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

# Check requirements
command -v curl >/dev/null 2>&1 || error "curl is required"
command -v jq >/dev/null 2>&1 || error "jq is required"

# Get API key
RUNPOD_API_KEY="${RUNPOD_API_KEY:-}"
if [[ -z "$RUNPOD_API_KEY" ]]; then
    # Try to get from terraform.tfvars
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    TFVARS_FILE="$SCRIPT_DIR/../terraform/terraform.tfvars"
    if [[ -f "$TFVARS_FILE" ]]; then
        RUNPOD_API_KEY=$(grep runpod_api_key "$TFVARS_FILE" | cut -d'"' -f2)
    fi
fi
[[ -z "$RUNPOD_API_KEY" ]] && error "RUNPOD_API_KEY not set"

# Args
VOLUME_ID="${1:-}"
DATACENTER="${2:-US-TX-3}"

[[ -z "$VOLUME_ID" ]] && error "Usage: $0 <volume_id> [datacenter]"

API_URL="https://api.runpod.io/graphql"

# GraphQL helper
graphql() {
    local query="$1"
    curl -s -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $RUNPOD_API_KEY" \
        -d "{\"query\": \"$query\"}"
}

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║       ComfyUI Network Volume Provisioner                       ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║  Volume ID:   $VOLUME_ID"
echo "║  Datacenter:  $DATACENTER"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# =============================================================================
# Step 1: Create temporary provisioning pod
# =============================================================================

info "Creating temporary provisioning pod..."

# Using a basic pytorch image with git-lfs
POD_QUERY="mutation {
  podFindAndDeployOnDemand(
    input: {
      cloudType: SECURE
      gpuCount: 1
      volumeInGb: 0
      containerDiskInGb: 20
      minVcpuCount: 2
      minMemoryInGb: 8
      gpuTypeId: \"NVIDIA GeForce RTX 4090\"
      name: \"volume-provisioner\"
      imageName: \"runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04\"
      networkVolumeId: \"$VOLUME_ID\"
      dockerArgs: \"\"
      ports: \"22/tcp\"
      volumeMountPath: \"/runpod-volume\"
      dataCenterId: \"$DATACENTER\"
    }
  ) {
    id
    machineId
    machine {
      podHostId
    }
  }
}"

# Escape newlines for JSON
POD_QUERY_ESCAPED=$(echo "$POD_QUERY" | tr '\n' ' ' | sed 's/"/\\"/g')

RESULT=$(curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $RUNPOD_API_KEY" \
    -d "{\"query\": \"$POD_QUERY_ESCAPED\"}")

POD_ID=$(echo "$RESULT" | jq -r '.data.podFindAndDeployOnDemand.id // empty')

if [[ -z "$POD_ID" || "$POD_ID" == "null" ]]; then
    echo "$RESULT" | jq .
    error "Failed to create pod"
fi

log "Pod created: $POD_ID"

# =============================================================================
# Step 2: Wait for pod to be ready
# =============================================================================

info "Waiting for pod to be ready (this may take 1-2 minutes)..."

get_pod_status() {
    local query="query { pod(input: {podId: \\\"$POD_ID\\\"}) { id desiredStatus runtime { uptimeInSeconds ports { ip isIpPublic privatePort publicPort type } } } }"
    curl -s -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $RUNPOD_API_KEY" \
        -d "{\"query\": \"$query\"}"
}

MAX_WAIT=300  # 5 minutes
WAITED=0
SSH_HOST=""
SSH_PORT=""

while [[ $WAITED -lt $MAX_WAIT ]]; do
    STATUS_RESULT=$(get_pod_status)
    UPTIME=$(echo "$STATUS_RESULT" | jq -r '.data.pod.runtime.uptimeInSeconds // 0')

    if [[ "$UPTIME" -gt 0 ]]; then
        # Get SSH connection info
        SSH_HOST=$(echo "$STATUS_RESULT" | jq -r '.data.pod.runtime.ports[] | select(.privatePort == 22) | .ip')
        SSH_PORT=$(echo "$STATUS_RESULT" | jq -r '.data.pod.runtime.ports[] | select(.privatePort == 22) | .publicPort')

        if [[ -n "$SSH_HOST" && "$SSH_HOST" != "null" ]]; then
            log "Pod is ready! Uptime: ${UPTIME}s"
            log "SSH: ssh root@$SSH_HOST -p $SSH_PORT"
            break
        fi
    fi

    echo -ne "\r  Waiting... ${WAITED}s / ${MAX_WAIT}s"
    sleep 5
    WAITED=$((WAITED + 5))
done

echo ""

if [[ -z "$SSH_HOST" || "$SSH_HOST" == "null" ]]; then
    error "Pod did not become ready in time"
fi

# Wait for SSH to be fully ready with retry
info "Waiting for SSH to be fully ready..."
SSH_READY=0
for i in {1..12}; do
    sleep 5
    if ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 \
        -p "$SSH_PORT" "root@$SSH_HOST" "echo 'SSH ready'" 2>/dev/null; then
        SSH_READY=1
        break
    fi
    echo -ne "\r  Waiting for SSH... attempt $i/12"
done
echo ""

if [[ $SSH_READY -eq 0 ]]; then
    error "SSH not ready after 60 seconds"
fi
log "SSH connection established"

# =============================================================================
# Step 3: Run provisioning commands
# =============================================================================

info "Starting model downloads on pod..."

# Create the provisioning script to run on the pod
PROVISION_SCRIPT='#!/bin/bash
set -e

echo "=== ComfyUI Model Provisioner ==="
echo "Volume mounted at: /runpod-volume"
df -h /runpod-volume

cd /runpod-volume

# Create directory structure
echo "Creating directories..."
mkdir -p checkpoints/video sonic animatediff_models controlnet voices avatars
mkdir -p text_encoders ace_step audio_models/bark

# Install git-lfs
apt-get update && apt-get install -y git-lfs
git lfs install

# =============================================================================
# Phase 1: Core Models (Talking Heads)
# =============================================================================

echo ""
echo "=== Phase 1: Downloading Core Models ==="

# SONIC models (~6.6GB)
if [[ ! -f sonic/unet.pth ]]; then
    echo "Downloading SONIC models..."
    cd sonic

    # Download from HuggingFace
    wget -q --show-progress -O unet.pth "https://huggingface.co/AIFSH/SONIC/resolve/main/unet.pth"
    wget -q --show-progress -O audio2token.pth "https://huggingface.co/AIFSH/SONIC/resolve/main/audio2token.pth"
    wget -q --show-progress -O audio2bucket.pth "https://huggingface.co/AIFSH/SONIC/resolve/main/audio2bucket.pth"
    wget -q --show-progress -O face_yolov8m.pt "https://huggingface.co/AIFSH/SONIC/resolve/main/face_yolov8m.pt"

    # Whisper-tiny
    mkdir -p whisper-tiny
    wget -q --show-progress -O whisper-tiny/model.safetensors "https://huggingface.co/openai/whisper-tiny/resolve/main/model.safetensors"
    wget -q --show-progress -O whisper-tiny/config.json "https://huggingface.co/openai/whisper-tiny/resolve/main/config.json"
    wget -q --show-progress -O whisper-tiny/tokenizer.json "https://huggingface.co/openai/whisper-tiny/resolve/main/tokenizer.json"
    wget -q --show-progress -O whisper-tiny/preprocessor_config.json "https://huggingface.co/openai/whisper-tiny/resolve/main/preprocessor_config.json"

    # RIFE for frame interpolation
    mkdir -p RIFE
    wget -q --show-progress -O RIFE/flownet.pkl "https://huggingface.co/AIFSH/SONIC/resolve/main/RIFE/flownet.pkl" || echo "RIFE flownet not found, may need manual download"

    cd ..
    echo "SONIC models downloaded!"
else
    echo "SONIC models already present, skipping..."
fi

# SVD model (~9GB)
if [[ ! -f checkpoints/video/svd_xt_1_1.safetensors ]]; then
    echo "Downloading SVD XT 1.1..."
    wget -q --show-progress -O checkpoints/video/svd_xt_1_1.safetensors \
        "https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt-1-1/resolve/main/svd_xt_1_1.safetensors"
    echo "SVD downloaded!"
else
    echo "SVD already present, skipping..."
fi

# Portrait checkpoint (~7GB)
if [[ ! -f checkpoints/perfectdeliberate_v50.safetensors ]]; then
    echo "Downloading PerfectDeliberate v5.0..."
    # Note: This may need a different source or manual download from CivitAI
    wget -q --show-progress -O checkpoints/perfectdeliberate_v50.safetensors \
        "https://huggingface.co/XpucT/Deliberate/resolve/main/Deliberate_v5.safetensors" || \
    echo "WARNING: Could not download perfectdeliberate, may need manual CivitAI download"
else
    echo "Portrait checkpoint already present, skipping..."
fi

# =============================================================================
# Phase 2: I2V Models (AnimateDiff)
# =============================================================================

echo ""
echo "=== Phase 2: Downloading I2V Models ==="

# AnimateLCM I2V (priority!)
if [[ ! -f animatediff_models/AnimateLCM_sd15_i2v.safetensors ]]; then
    echo "Downloading AnimateLCM I2V..."
    wget -q --show-progress -O animatediff_models/AnimateLCM_sd15_i2v.safetensors \
        "https://huggingface.co/wangfuyun/AnimateLCM/resolve/main/AnimateLCM_sd15_i2v.safetensors"
fi

# AnimateLCM T2V
if [[ ! -f animatediff_models/AnimateLCM_sd15_t2v.safetensors ]]; then
    echo "Downloading AnimateLCM T2V..."
    wget -q --show-progress -O animatediff_models/AnimateLCM_sd15_t2v.safetensors \
        "https://huggingface.co/wangfuyun/AnimateLCM/resolve/main/AnimateLCM_sd15_t2v.safetensors"
fi

# Motion module v3
if [[ ! -f animatediff_models/v3_sd15_mm.ckpt ]]; then
    echo "Downloading AnimateDiff v3 motion module..."
    wget -q --show-progress -O animatediff_models/v3_sd15_mm.ckpt \
        "https://huggingface.co/guoyww/animatediff/resolve/main/v3_sd15_mm.ckpt"
fi

# SparseCtrl for frame consistency
if [[ ! -f controlnet/v3_sd15_sparsectrl_rgb.ckpt ]]; then
    echo "Downloading SparseCtrl RGB..."
    wget -q --show-progress -O controlnet/v3_sd15_sparsectrl_rgb.ckpt \
        "https://huggingface.co/guoyww/animatediff/resolve/main/v3_sd15_sparsectrl_rgb.ckpt"
fi

if [[ ! -f controlnet/v3_sd15_sparsectrl_scribble.ckpt ]]; then
    echo "Downloading SparseCtrl Scribble..."
    wget -q --show-progress -O controlnet/v3_sd15_sparsectrl_scribble.ckpt \
        "https://huggingface.co/guoyww/animatediff/resolve/main/v3_sd15_sparsectrl_scribble.ckpt"
fi

# =============================================================================
# Phase 3: Tier 2 - LTX-Video
# =============================================================================

echo ""
echo "=== Phase 3: Downloading Tier 2 Models (LTX-Video) ==="

# LTX-Video model (~4GB)
if [[ ! -f checkpoints/ltx-video-2b-v0.9.5.safetensors ]]; then
    echo "Downloading LTX-Video 2B..."
    wget -q --show-progress -O checkpoints/ltx-video-2b-v0.9.5.safetensors \
        "https://huggingface.co/Lightricks/LTX-Video/resolve/main/ltx-video-2b-v0.9.5.safetensors" || \
    echo "WARNING: LTX-Video download failed, may need manual download"
else
    echo "LTX-Video already present, skipping..."
fi

# T5-XXL text encoder (~10GB) - shared with Wan
if [[ ! -f text_encoders/t5xxl_fp16.safetensors ]]; then
    echo "Downloading T5-XXL text encoder..."
    wget -q --show-progress -O text_encoders/t5xxl_fp16.safetensors \
        "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors" || \
    echo "WARNING: T5-XXL download failed, may need manual download"
else
    echo "T5-XXL already present, skipping..."
fi

# =============================================================================
# Phase 4: Audio Generation Models
# =============================================================================

echo ""
echo "=== Phase 4: Downloading Audio Models ==="

# ACE-Step for music generation (~6GB)
if [[ ! -f ace_step/ace-step-v1-3b.safetensors ]]; then
    echo "Downloading ACE-Step v1 3B..."
    wget -q --show-progress -O ace_step/ace-step-v1-3b.safetensors \
        "https://huggingface.co/ace-step/ACE-Step/resolve/main/ace-step-v1-3b.safetensors" 2>/dev/null || \
    echo "WARNING: ACE-Step download failed, may need manual download from HuggingFace"
else
    echo "ACE-Step already present, skipping..."
fi

# Bark models for voice SFX (~1.5GB total)
if [[ ! -f audio_models/bark/text_2.pt ]]; then
    echo "Downloading Bark models..."
    cd audio_models/bark
    # Bark downloads models on first use, but we can pre-download them
    wget -q --show-progress -O text_2.pt \
        "https://huggingface.co/suno/bark/resolve/main/text_2.pt" 2>/dev/null || true
    wget -q --show-progress -O coarse_2.pt \
        "https://huggingface.co/suno/bark/resolve/main/coarse_2.pt" 2>/dev/null || true
    wget -q --show-progress -O fine_2.pt \
        "https://huggingface.co/suno/bark/resolve/main/fine_2.pt" 2>/dev/null || true
    cd ../..
    echo "Bark models downloaded (or will download on first use)"
else
    echo "Bark models already present, skipping..."
fi

# =============================================================================
# Phase 5: Tier 3 - Wan 2.2 (Optional - Large Model)
# =============================================================================

echo ""
echo "=== Phase 5: Tier 3 Models (Optional) ==="

# Wan 2.2 5B model (~10GB) - Skip by default, uncomment if needed
# if [[ ! -f checkpoints/wan2.2_5B.safetensors ]]; then
#     echo "Downloading Wan 2.2 5B..."
#     wget -q --show-progress -O checkpoints/wan2.2_5B.safetensors \
#         "https://huggingface.co/Wan-AI/Wan2.2/resolve/main/wan2.2_5B.safetensors"
# fi

echo "Tier 3 models (Wan 2.2) skipped by default - uncomment in script if needed"

echo ""
echo "=== Download Complete ==="
echo ""
du -sh /runpod-volume/*
echo ""
df -h /runpod-volume
'

# Copy and run script on pod
info "Running provisioning script on pod (this will take 10-20 minutes for ~30GB of downloads)..."

# Use SSH to run the script
# Note: RunPod pods use root and don't require a password
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -p "$SSH_PORT" "root@$SSH_HOST" \
    "bash -s" <<< "$PROVISION_SCRIPT"

PROVISION_EXIT=$?

if [[ $PROVISION_EXIT -ne 0 ]]; then
    warn "Provisioning may have had some errors (exit code: $PROVISION_EXIT)"
fi

# =============================================================================
# Step 4: Terminate the pod
# =============================================================================

info "Terminating provisioning pod..."

TERMINATE_QUERY="mutation { podTerminate(input: {podId: \\\"$POD_ID\\\"}) }"
TERMINATE_RESULT=$(curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $RUNPOD_API_KEY" \
    -d "{\"query\": \"$TERMINATE_QUERY\"}")

log "Pod terminated"

# =============================================================================
# Done!
# =============================================================================

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                    Provisioning Complete!                       ║"
echo "╠════════════════════════════════════════════════════════════════╣"
echo "║  Volume $VOLUME_ID is now populated with models."
echo "║"
echo "║  Next steps:"
echo "║    cd ../terraform"
echo "║    tofu apply    # Creates serverless endpoint with volume"
echo "║"
echo "╚════════════════════════════════════════════════════════════════╝"
