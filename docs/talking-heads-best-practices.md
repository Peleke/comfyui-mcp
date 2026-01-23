# Talking Heads Pipeline: Best Practices Guide

> **Purpose**: Avoid burning cash debugging obvious issues with F5-TTS and SONIC
> **Last Updated**: 2026-01-22

---

## F5-TTS Voice Cloning

### Reference Audio Requirements (CRITICAL)

| Requirement | Specification | Why It Matters |
|-------------|---------------|----------------|
| **Duration** | **5-15 seconds** (hard cutoff at 15s) | F5-TTS truncates anything over 15s |
| **Format** | `.wav` preferred | Most reliable format |
| **Sample Rate** | 44.1kHz or 48kHz | Match your output requirements |
| **Quality** | Clean, no background music/noise | Noise gets cloned too! |
| **Content** | Natural speech, not singing | Model trained on speech |

### Transcription Requirements (CRITICAL)

**You MUST provide accurate transcription of the reference audio!**

```
# Bad: No transcription (forces ASR, uses extra VRAM, may be inaccurate)
ref_text: ""

# Good: Exact transcription of what's spoken in the reference audio
ref_text: "Hello, this is a sample of my voice for cloning purposes."
```

- Create a `.txt` file with the same name as your audio file
- Transcription must **exactly match** what's spoken
- Include punctuation for natural pacing
- If audio cuts mid-word, the text alignment will fail

### Text-to-Generate Best Practices

| Do | Don't |
|----|-------|
| Use natural punctuation | Skip all punctuation |
| Break long text into chunks | Feed entire paragraphs at once |
| Match the speaking style of reference | Use formal text with casual reference |
| Test short phrases first | Jump straight to long content |

### ComfyUI Node Settings

```
F5TTSAudioInputs:
  - sample_rate: 44100 (match your reference audio)
  - remove_silence: true (usually helps)
  - speed: 1.0 (adjust for pacing)
```

### Common F5-TTS Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| **Garbled/wrong words** | Bad transcription | Verify ref_text matches audio EXACTLY |
| **Robotic sound** | Reference too short | Use 10-15 second reference |
| **Wrong voice** | Background noise in reference | Re-record with clean audio |
| **Cuts off early** | Reference > 15 seconds | Trim to under 15s |
| **No output** | Missing vocab file | Ensure .txt vocab matches model name |

---

## SONIC Lip-Sync

### Portrait Image Requirements (CRITICAL)

| Requirement | Specification | Why It Matters |
|-------------|---------------|----------------|
| **Resolution** | ~1024x1024 to 1152x1152 | Too small = blurry, too large = OOM |
| **Aspect** | Square or near-square preferred | Non-square uses more VRAM |
| **Face Position** | Frontal, centered | Side angles sync poorly |
| **Face Size** | Face should fill 40-60% of frame | Too small = poor detection |
| **Format** | PNG | Lossless, no artifacts |
| **Style** | Photo, art, anime all work | Model is flexible |

### Audio Requirements (CRITICAL)

| Requirement | Specification | Why It Matters |
|-------------|---------------|----------------|
| **Sample Rate** | **44.1kHz** | Wrong rate = lip desync! |
| **Format** | MP3 or WAV | Both work |
| **Quality** | Clear speech | Mumbling = bad sync |
| **Duration** | Match your `duration` param | Longer = more VRAM |

### Required Models

All must be present on the volume:

```
models/sonic/
├── audio2bucket.pth
├── audio2token.pth
├── unet.pth
├── yoloface_v5m.pt
└── whisper-tiny/
    └── (whisper model files)

models/RIFE/
└── flownet.pkl

models/checkpoints/
└── svd_xt_1_1.safetensors  # ~9GB - THE BLOCKER
```

### ComfyUI Node Settings

```
SONICTLoader:
  - ip_audio_scale: 1.0
  - use_interframe: true
  - dtype: "fp16"  # Save VRAM

SONIC_PreData:
  - min_resolution: 256  # Lower if OOM
  - expand_ratio: 0.5
  - duration: (seconds of output)

SONICSampler:
  - fps: 25  # MUST be 25, other values cause batch errors
  - inference_steps: 25
  - dynamic_scale: 1.0

VHS_VideoCombine:
  - format: "video/h264-mp4"
  - frame_rate: 25  # Match SONICSampler
  - crf: 19  # Lower = better quality, larger file (18-23 range)
```

### Common SONIC Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| **Batch mismatch error** | fps != 25 | Set fps to exactly 25 |
| **OOM on first run** | Large image_size | Reduce min_resolution to 256 |
| **No face detected** | Face too small/angled | Use frontal, face-filling portrait |
| **Lip desync** | Wrong audio sample rate | Resample audio to 44.1kHz |
| **Choppy video** | High CRF value | Lower CRF to 18-19 |
| **CUDA device error** | Multi-GPU confusion | Force cuda:0 explicitly |
| **Missing model error** | svd_xt_1_1 not found | Download the 9GB model! |

---

## Pipeline Order

```
1. Generate/Select Portrait Image
   └── Ensure: square-ish, frontal face, 1024x1024ish

2. Prepare Reference Voice (for F5-TTS)
   └── Clean WAV, 10-15s, with EXACT transcription

3. Generate Speech Audio (F5-TTS)
   └── Verify: sounds correct before proceeding!

4. Generate Lip-Sync Video (SONIC)
   └── Use the F5-TTS output + portrait
```

### Testing Checklist

Before burning compute:

- [ ] Reference audio is 10-15 seconds, clean, 44.1kHz WAV
- [ ] Transcription file exists and matches audio exactly
- [ ] Portrait is ~1024x1024, frontal face, PNG
- [ ] All SONIC models present including svd_xt_1_1.safetensors
- [ ] Test F5-TTS locally first with a short phrase
- [ ] Verify TTS output sounds correct before SONIC

---

## Quick Diagnostic Commands

```bash
# Check if SVD model exists on RunPod volume
ls -la /workspace/checkpoints/video/svd_xt_1_1.safetensors

# Check audio sample rate
ffprobe -v error -show_entries stream=sample_rate -of default=noprint_wrappers=1:nokey=1 audio.wav

# Resample audio to 44.1kHz if needed
ffmpeg -i input.mp3 -ar 44100 output.wav

# Check image dimensions
identify portrait.png  # or: file portrait.png
```

---

## Sources

- [F5-TTS Official Repo](https://github.com/SWivid/F5-TTS)
- [ComfyUI-F5-TTS](https://github.com/niknah/ComfyUI-F5-TTS)
- [SONIC Official Repo](https://github.com/jixiaozhong/Sonic)
- [ComfyUI_Sonic](https://github.com/smthemex/ComfyUI_Sonic)
- [SONIC Workflow Guide](https://comfyui.org/en/sonic-digital-human-lip-sync-avatars)
