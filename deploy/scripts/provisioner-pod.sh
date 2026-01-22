#!/bin/bash
#
# Spin up/down a lightweight provisioner pod for network volume access
# Use this to upload voices, avatars, or debug the volume
#
# Usage:
#   ./provisioner-pod.sh up       # Start pod, prints IP when ready
#   ./provisioner-pod.sh down     # Stop and remove pod
#   ./provisioner-pod.sh status   # Check if running
#   ./provisioner-pod.sh ssh      # SSH into running pod
#
# After 'up', upload files with:
#   scp yourfile.wav root@<POD_IP>:/runpod-volume/voices/
#
# Network Volume ID: g64svtzxd5 (100GB, US-East)
#

set -e

VOLUME_ID="g64svtzxd5"
POD_NAME="comfyui-provisioner"
GPU_TYPE="NVIDIA GeForce RTX 3070"  # Cheap, widely available
# Alternative: "NVIDIA GeForce RTX 4090" for faster downloads

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[X]${NC} $1"; }

get_pod_id() {
    runpodctl get pod 2>/dev/null | grep "$POD_NAME" | awk '{print $1}' | head -1
}

get_pod_ip() {
    local pod_id=$(get_pod_id)
    if [ -n "$pod_id" ]; then
        runpodctl get pod 2>/dev/null | grep "$pod_id" | awk '{print $7}'
    fi
}

case "${1:-status}" in
    up)
        # Check if already running
        existing=$(get_pod_id)
        if [ -n "$existing" ]; then
            warn "Pod already running: $existing"
            ip=$(get_pod_ip)
            log "IP: $ip"
            log ""
            log "Upload files with:"
            log "  scp <file> root@$ip:/runpod-volume/voices/"
            log "  scp <file> root@$ip:/runpod-volume/avatars/"
            exit 0
        fi

        log "Starting provisioner pod..."
        log "Volume: $VOLUME_ID"
        log "GPU: $GPU_TYPE"

        # Create pod with network volume
        runpodctl create pod \
            --name "$POD_NAME" \
            --gpuType "$GPU_TYPE" \
            --imageName "runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04" \
            --networkVolumeId "$VOLUME_ID" \
            --volumePath "/runpod-volume" \
            --startSSH \
            --ports "22/tcp"

        log "Pod created. Waiting for IP..."

        # Wait for pod to get IP (max 2 min)
        for i in {1..24}; do
            sleep 5
            ip=$(get_pod_ip)
            if [ -n "$ip" ] && [ "$ip" != "-" ]; then
                log ""
                log "=== Pod Ready ==="
                log "Pod ID: $(get_pod_id)"
                log "IP: $ip"
                log ""
                log "Upload files:"
                log "  scp deploy/voices/moi.* root@$ip:/runpod-volume/voices/"
                log ""
                log "SSH in:"
                log "  ssh root@$ip"
                log ""
                log "When done:"
                log "  ./provisioner-pod.sh down"
                exit 0
            fi
            echo -n "."
        done

        err "Timeout waiting for pod IP. Check: runpodctl get pod"
        exit 1
        ;;

    down)
        pod_id=$(get_pod_id)
        if [ -z "$pod_id" ]; then
            warn "No provisioner pod running"
            exit 0
        fi

        log "Stopping pod: $pod_id"
        runpodctl stop pod "$pod_id"

        log "Removing pod..."
        runpodctl remove pod "$pod_id"

        log "Done! Pod removed."
        ;;

    status)
        pod_id=$(get_pod_id)
        if [ -z "$pod_id" ]; then
            log "No provisioner pod running"
            log ""
            log "Start one with: ./provisioner-pod.sh up"
        else
            ip=$(get_pod_ip)
            log "Pod running: $pod_id"
            log "IP: $ip"
            log ""
            log "Upload: scp <file> root@$ip:/runpod-volume/"
            log "SSH:    ssh root@$ip"
            log "Stop:   ./provisioner-pod.sh down"
        fi
        ;;

    ssh)
        ip=$(get_pod_ip)
        if [ -z "$ip" ] || [ "$ip" = "-" ]; then
            err "No pod running or no IP yet"
            exit 1
        fi
        log "Connecting to $ip..."
        ssh root@$ip
        ;;

    *)
        echo "Usage: $0 {up|down|status|ssh}"
        echo ""
        echo "Commands:"
        echo "  up      Start provisioner pod"
        echo "  down    Stop and remove pod"
        echo "  status  Check pod status"
        echo "  ssh     SSH into running pod"
        exit 1
        ;;
esac
