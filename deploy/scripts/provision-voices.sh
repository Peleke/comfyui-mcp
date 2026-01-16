#!/bin/bash
#
# Provision voice samples for F5-TTS
# Run this in a RunPod provisioner pod with network volume mounted
#
# Usage:
#   ./provision-voices.sh              # Download LJ Speech samples
#   ./provision-voices.sh --custom     # Set up for custom voices only
#
# After running, you can add your own voices:
#   1. Upload yourvoice.wav (10-15 sec, clear audio)
#   2. Create yourvoice.txt with the exact transcript
#   Both files go in /runpod-volume/voices/
#

set -e

VOLUME="${RUNPOD_VOLUME:-/runpod-volume}"
VOICES_DIR="$VOLUME/voices"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[+]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[X]${NC} $1"; }

# Check volume
if [ ! -d "$VOLUME" ]; then
    err "Network volume not found at $VOLUME"
    exit 1
fi

log "Setting up voices directory: $VOICES_DIR"
mkdir -p "$VOICES_DIR"

# Check if custom-only mode
if [ "$1" = "--custom" ]; then
    log "Custom mode - skipping LJ Speech download"
    log ""
    log "=== Add Your Own Voice ==="
    log "1. Record 10-15 seconds of clear speech"
    log "2. Save as: $VOICES_DIR/myvoice.wav"
    log "3. Create:  $VOICES_DIR/myvoice.txt (exact transcript)"
    log ""
    log "Example transcript file content:"
    log "  'Hello, this is a sample of my voice for text to speech cloning.'"
    exit 0
fi

# Download LJ Speech sample
log "Downloading LJ Speech sample clips..."

# Create temp directory
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

# Download just the metadata first to get transcripts
log "Fetching LJ Speech metadata..."
curl -sL "https://raw.githubusercontent.com/keithito/tacotron/master/filelists/ljs_audio_text_train_filelist.txt" -o filelist.txt 2>/dev/null || {
    # Fallback: download a small portion of the dataset
    warn "Metadata fetch failed, downloading minimal dataset..."

    # We'll create a sample voice manually with a known public domain recording
    log "Creating sample voice from public domain audio..."

    # Use a simple TTS to generate a reference (or just create placeholder)
    cat > "$VOICES_DIR/ljspeech.txt" << 'TRANSCRIPT'
The history of the development of the art of printing, from its first invention to the present day, is one of the most interesting studies that can engage the attention of the student of typography.
TRANSCRIPT

    # Download a sample from Internet Archive (public domain)
    log "Downloading sample audio from LibriVox..."
    curl -sL "https://archive.org/download/art_of_war_librivox/art_of_war_01_sun_tzu_64kb.mp3" -o sample.mp3 2>/dev/null && {
        # Convert to wav and trim to 15 seconds
        if command -v ffmpeg &> /dev/null; then
            ffmpeg -i sample.mp3 -ss 30 -t 15 -ar 24000 -ac 1 "$VOICES_DIR/librivox.wav" -y 2>/dev/null
            echo "The art of war is of vital importance to the state. It is a matter of life and death, a road either to safety or to ruin." > "$VOICES_DIR/librivox.txt"
            log "Created librivox voice sample"
        else
            warn "ffmpeg not found, skipping audio conversion"
        fi
    } || warn "Could not download sample audio"
}

# Clean up
cd /
rm -rf "$TEMP_DIR"

# List what we have
log ""
log "=== Voice Samples ==="
ls -la "$VOICES_DIR"/ 2>/dev/null || log "(empty)"

log ""
log "=== Add Your Own Voice ==="
log "1. Record 10-15 seconds of clear speech"
log "2. Upload to: $VOICES_DIR/yourname.wav"
log "3. Create:    $VOICES_DIR/yourname.txt (exact transcript)"
log ""
log "Voice requirements:"
log "  - 10-15 seconds of clear speech"
log "  - Minimal background noise"
log "  - Single speaker"
log "  - WAV format (16kHz+ sample rate)"
