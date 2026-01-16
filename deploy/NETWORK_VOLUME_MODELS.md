# ComfyUI Network Volume Model Manifest

This document describes all models stored on the RunPod network volume for the ComfyUI serverless deployment.

## Volume Structure

```
/runpod-volume/
├── checkpoints/
│   ├── perfectdeliberate_v50.safetensors   # ~7GB  - Portrait generation
│   ├── ltx-video-2b-v0.9.5.safetensors     # ~4GB  - Fast T2V/I2V/V2V
│   └── video/
│       └── svd_xt_1_1.safetensors          # ~9GB  - SVD for SONIC lip-sync
├── sonic/
│   ├── unet.pth                            # ~5GB  - SONIC main model
│   ├── audio2token.pth                     # ~100MB
│   ├── audio2bucket.pth                    # ~100MB
│   ├── face_yolov8m.pt                     # ~50MB
│   ├── whisper-tiny/                       # ~150MB
│   │   ├── model.safetensors
│   │   ├── config.json
│   │   ├── tokenizer.json
│   │   └── preprocessor_config.json
│   └── RIFE/
│       └── flownet.pkl                     # Frame interpolation
├── animatediff_models/
│   ├── AnimateLCM_sd15_i2v.safetensors     # ~1.8GB - Fast I2V
│   ├── AnimateLCM_sd15_t2v.safetensors     # ~1.8GB - Fast T2V
│   └── v3_sd15_mm.ckpt                     # ~1.8GB - Motion module
├── controlnet/
│   ├── v3_sd15_sparsectrl_rgb.ckpt         # ~400MB - Frame consistency
│   └── v3_sd15_sparsectrl_scribble.ckpt    # ~400MB - Scribble control
├── text_encoders/
│   └── t5xxl_fp16.safetensors              # ~10GB - Shared T5 encoder
├── ace_step/
│   └── ace-step-v1-3b.safetensors          # ~6GB  - Music generation
├── audio_models/
│   └── bark/
│       ├── text_2.pt                       # ~500MB - Bark text model
│       ├── coarse_2.pt                     # ~500MB - Bark coarse model
│       └── fine_2.pt                       # ~500MB - Bark fine model
├── voices/
│   └── (user voice samples for TTS cloning)
└── avatars/
    └── (portrait images for lip-sync)
```

## Model Summary by Tier

### Tier 1: Core (Talking Heads + Quick Animations)
| Model | Size | Purpose |
|-------|------|---------|
| perfectdeliberate_v50 | 7GB | Portrait generation |
| svd_xt_1_1 | 9GB | SONIC lip-sync base |
| sonic/* | 6GB | Lip-sync model suite |
| AnimateLCM-I2V | 1.8GB | Fast panel animations |
| AnimateLCM-T2V | 1.8GB | Fast text-to-video |
| v3_sd15_mm | 1.8GB | Motion module |
| SparseCtrl models | 0.8GB | Frame consistency |
| **Tier 1 Total** | **~28GB** | |

### Tier 2: Quality (LTX-Video)
| Model | Size | Purpose |
|-------|------|---------|
| ltx-video-2b | 4GB | Fast T2V/I2V/V2V |
| t5xxl_fp16 | 10GB | Text encoder (shared) |
| **Tier 2 Total** | **~14GB** | |

### Tier 3: Audio Generation
| Model | Size | Purpose |
|-------|------|---------|
| ace-step-v1-3b | 6GB | Chapter music scores |
| bark models | 1.5GB | Voice SFX |
| **Tier 3 Total** | **~7.5GB** | |

### Tier 4: Polish (Optional - Future)
| Model | Size | Purpose |
|-------|------|---------|
| wan2.2_5B | 10GB | High-quality I2V/V2V |
| **Tier 4 Total** | **~10GB** | |

## Total Storage Requirements

| Configuration | Models Included | Size |
|---------------|-----------------|------|
| Minimum (Talking Heads) | Tier 1 | ~28GB |
| Standard (+ LTX Video) | Tier 1 + 2 | ~42GB |
| Full (+ Audio Gen) | Tier 1 + 2 + 3 | ~50GB |
| Everything (+ Wan) | All Tiers | ~60GB |

**Recommended Volume Size: 100GB** (allows for outputs, cache, and future models)

## Download Sources

| Model | Source |
|-------|--------|
| perfectdeliberate | HuggingFace: XpucT/Deliberate |
| svd_xt_1_1 | HuggingFace: stabilityai/stable-video-diffusion-img2vid-xt-1-1 |
| SONIC models | HuggingFace: AIFSH/SONIC |
| AnimateLCM | HuggingFace: wangfuyun/AnimateLCM |
| AnimateDiff | HuggingFace: guoyww/animatediff |
| LTX-Video | HuggingFace: Lightricks/LTX-Video |
| T5-XXL | HuggingFace: comfyanonymous/flux_text_encoders |
| ACE-Step | HuggingFace: ace-step/ACE-Step |
| Bark | HuggingFace: suno/bark |

## Provisioning

Models are downloaded using `deploy/scripts/provision-volume.sh`:

```bash
# Full provisioning (creates temp GPU pod, downloads all, terminates)
./deploy/scripts/provision-volume.sh <volume_id> <datacenter>

# Or use the all-in-one deployment script
./deploy/scripts/deploy-all.sh
```

## Notes

- Network volume mounts at `/runpod-volume` in serverless workers
- Handler creates symlinks from ComfyUI model paths to network volume
- Voice samples and avatars should be uploaded manually or via API
- Wan 2.2 is commented out by default due to size - uncomment in provision script if needed
