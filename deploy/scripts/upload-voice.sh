#!/bin/bash
#
# Upload a voice sample to the network volume
# Run from your local machine with the provisioner pod running
#
# Usage:
#   ./upload-voice.sh <pod_ip> <voice.wav> <voice.txt>
#   ./upload-voice.sh <pod_ip> <voice.wav> "Transcript of what was said"
#
# Example:
#   ./upload-voice.sh 123.45.67.89 ~/myvoice.wav ~/myvoice.txt
#   ./upload-voice.sh 123.45.67.89 ~/myvoice.wav "Hello this is my voice sample"
#

set -e

POD_IP="${1:-}"
WAV_FILE="${2:-}"
TRANSCRIPT="${3:-}"

if [ -z "$POD_IP" ] || [ -z "$WAV_FILE" ]; then
    echo "Usage: $0 <pod_ip> <voice.wav> <transcript.txt or 'transcript text'>"
    echo ""
    echo "Example:"
    echo "  $0 123.45.67.89 myvoice.wav myvoice.txt"
    echo "  $0 123.45.67.89 myvoice.wav 'Hello this is my voice sample'"
    exit 1
fi

# Get base name without extension
BASENAME=$(basename "$WAV_FILE" .wav)
REMOTE_DIR="/runpod-volume/voices"

echo "[+] Uploading $WAV_FILE to $POD_IP:$REMOTE_DIR/$BASENAME.wav"
scp "$WAV_FILE" "root@$POD_IP:$REMOTE_DIR/$BASENAME.wav"

# Handle transcript - either file or inline text
if [ -f "$TRANSCRIPT" ]; then
    echo "[+] Uploading transcript file"
    scp "$TRANSCRIPT" "root@$POD_IP:$REMOTE_DIR/$BASENAME.txt"
else
    echo "[+] Creating transcript file with: $TRANSCRIPT"
    ssh "root@$POD_IP" "echo '$TRANSCRIPT' > $REMOTE_DIR/$BASENAME.txt"
fi

echo "[+] Done! Voice sample uploaded as: $BASENAME"
echo ""
echo "Verify with:"
echo "  ssh root@$POD_IP 'ls -la $REMOTE_DIR/'"
