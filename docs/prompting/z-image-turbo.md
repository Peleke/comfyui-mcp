# Z-Image Turbo Prompting Guide

> **Version**: 1.0.0
> **Last Updated**: 2025-01-21
> **Model**: Z-Image Turbo (6B DiT, Lumina architecture)
> **Text Encoder**: Qwen 3 4B

## Executive Summary

Z-Image Turbo is a **6B parameter single-stream diffusion transformer** designed for fast, instruction-following image generation in approximately 8 steps. It represents a fundamental paradigm shift from traditional Stable Diffusion prompting.

### Critical Differences from SD/SDXL/Pony/Illustrious

| Aspect | Traditional Models | Z-Image Turbo |
|--------|-------------------|---------------|
| **Negative prompts** | Essential for quality | **Completely ignored** |
| **CFG Scale** | 5-8 typical | **1.0 (fixed, any other value ignored)** |
| **Prompt format** | Tags, keywords, weight syntax | **Natural language prose (100-300 words)** |
| **Content control** | Negative prompt exclusions | **Positive constraints only** |
| **Steps** | 20-30 typical | **8 (turbo distillation)** |
| **Text rendering** | Poor to moderate | **Excellent (English + Chinese)** |

---

## 1. Architecture Overview

### 1.1 Model Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Z-Image Turbo Stack                       │
├─────────────────────────────────────────────────────────────┤
│  Diffusion Model: z_image_turbo_bf16.safetensors (6B)       │
│  Text Encoder:    qwen_3_4b.safetensors (Qwen 3 4B)         │
│  VAE:             ae.safetensors                             │
│  CLIP Type:       lumina2                                    │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 ComfyUI Node Configuration

```
UNETLoader
├── unet_name: "z_image_turbo_bf16.safetensors" (or GGUF variant)
└── weight_dtype: "default"

CLIPLoader
├── clip_name: "qwen_3_4b.safetensors"
├── type: "lumina2"  ← CRITICAL: Must be lumina2
└── device: "default"

VAELoader
└── vae_name: "ae.safetensors"

EmptySD3LatentImage  ← Note: SD3 latent, not standard
├── width: 768-1024
├── height: 768-1024
└── batch_size: 1
```

### 1.3 Sampler Settings (Non-Negotiable)

| Parameter | Value | Notes |
|-----------|-------|-------|
| steps | **8** | Turbo distillation optimized for 8 |
| cfg | **1.0** | Model ignores CFG; any value works but 1.0 is canonical |
| sampler_name | `euler` | Also: `euler_ancestral`, `dpmpp_2m` |
| scheduler | `simple` | Also: `beta`, `normal` |
| denoise | **1.0** | For txt2img; reduce for img2img |

---

## 2. Prompt Engineering

### 2.1 The No-Negative-Prompt Paradigm

**The model's inference pipeline sets `guidance_scale = 0.0` internally.** This means:

1. Negative prompts are **never processed**
2. All quality control must be **positive constraints**
3. Traditional exclusion patterns (`bad hands`, `blurry`, etc.) have **zero effect**

### 2.2 Prompt Structure Template

Effective Z-Image Turbo prompts follow this structure:

```
[Shot Type] [Subject Description]

[Detailed Appearance]
- Age indicators (adult, mature, young adult)
- Physical characteristics
- Clothing/attire with explicit detail
- Pose and positioning

[Environment]
- Setting and location
- Background elements
- Depth and spatial context

[Lighting]  ← Model responds strongly to lighting descriptions
- Light source and direction
- Quality (soft, harsh, dramatic)
- Color temperature
- Atmospheric effects

[Mood and Style]
- Emotional tone
- Artistic medium/style
- Genre indicators

[Technical Quality]
- Resolution markers (4K, 8K, detailed)
- Focus descriptors (sharp focus, depth of field)
- Quality indicators (professional, masterpiece)

[Content Constraints]  ← Replaces negative prompts
- What IS shown (fully clothed, appropriate)
- Exclusions phrased positively (clean background = no clutter)
```

### 2.3 Optimal Prompt Length

| Length | Quality | Use Case |
|--------|---------|----------|
| < 50 words | Poor | Too vague, model underperforms |
| 50-80 words | Moderate | Quick drafts only |
| **80-150 words** | **Good** | Standard production use |
| **150-250 words** | **Optimal** | Complex scenes, maximum control |
| > 300 words | Diminishing returns | Redundancy, potential confusion |

### 2.4 Lighting Vocabulary (High Impact)

The model responds **exceptionally well** to lighting descriptions:

**Dramatic/Cinematic:**
- `low-key lighting`, `rim lighting`, `spotlight`
- `high contrast`, `chiaroscuro`, `film noir lighting`
- `volumetric rays`, `god rays`, `atmospheric haze`

**Natural:**
- `golden hour`, `blue hour`, `overcast diffused`
- `dappled sunlight`, `window light`, `natural ambient`

**Studio:**
- `three-point lighting`, `softbox`, `ring light`
- `beauty dish`, `rembrandt lighting`, `butterfly lighting`

**Mood:**
- `neon glow`, `bioluminescent`, `candlelight`
- `firelight flicker`, `moonlit`, `starlight`

---

## 3. Content Control Without Negative Prompts

### 3.1 SFW Constraint Patterns

Replace negative exclusions with positive assertions:

| Instead of (Negative) | Use (Positive) |
|----------------------|----------------|
| `no nudity` | `fully clothed, wearing [specific garment]` |
| `no violence` | `peaceful scene, calm atmosphere` |
| `no gore` | `clean, pristine, unblemished` |
| `no text, no watermark` | `clean image, plain background` |
| `no extra limbs` | `correct human anatomy, natural proportions` |
| `no blurry` | `sharp focus, crisp details, high clarity` |

### 3.2 Mature Content Generation

For mature content, Z-Image Turbo uses **direct description** rather than tags:

**Tag-based (DOES NOT WORK):**
```
1boy, 1girl, romantic, embrace
```

**Natural language (WORKS):**
```
A romantic scene between two adult figures in a private setting.
Soft candlelight illuminates the room as they share an embrace.
Both display expressions of affection, eyes meeting with intensity.
Warm shadows create an intimate atmosphere.
Professional photography quality, tasteful composition.
```

### 3.3 Specialized LoRA Enhancement

For specific content styles, combine base prompting with specialized LoRAs:

| LoRA | Use Case | Strength |
|------|----------|----------|
| Style LoRAs (RetroPop, etc.) | Aesthetic control | 0.4-0.6 |
| Character LoRAs | Consistent characters | 0.5-0.7 |

---

## 4. Text Rendering

Z-Image Turbo **excels at text rendering** in both English and Chinese.

### 4.1 Text Prompt Patterns

**Basic text inclusion:**
```
A storefront with a sign that reads "OPEN 24 HOURS"
```

**Styled text:**
```
A neon sign glowing in pink and blue that displays "MIDNIGHT DINER"
in retro 1950s lettering
```

**Multi-language:**
```
A bilingual poster with "Welcome" in English and "欢迎" in Chinese,
both rendered in elegant serif typography
```

### 4.2 Text Rendering Best Practices

1. **Quote the exact text** you want rendered
2. **Describe typography**: font style, size relative to scene, color
3. **Specify placement**: "in the foreground", "on the wall", "held by character"
4. **Keep text short**: 1-4 words renders best; longer text may have errors

---

## 5. Resolution and Aspect Ratio

### 5.1 Supported Resolutions

| Aspect | Dimensions | Use Case |
|--------|------------|----------|
| Portrait | 768 × 1024 | Characters, portraits |
| Landscape | 1024 × 768 | Scenes, environments |
| Square | 1024 × 1024 | Balanced compositions |
| Wide | 1216 × 832 | Cinematic |
| Tall | 832 × 1216 | Full-body portraits |

### 5.2 Resolution Rules

1. **Dimensions must be divisible by 32** - Critical for quality
2. Native training resolution: 1024 × 1024
3. Minimum recommended: 512 × 512 (drafts only)
4. Maximum single-pass: ~1.5 megapixels

---

## 6. LoRA Integration

### 6.1 Supported LoRA Count

Z-Image Turbo supports **up to 3 LoRAs simultaneously** via Power Lora Loader.

### 6.2 LoRA Stacking Strategy

```
Slot 1: Style LoRA (RetroPop, ClayArt, etc.)     @ 0.4-0.6
Slot 2: Subject LoRA (character, concept)         @ 0.5-0.7
Slot 3: Quality/Uncensored LoRA                   @ 0.3-0.5
```

### 6.3 Available Z-Image LoRAs (Installed)

| Name | File | Category | Strength |
|------|------|----------|----------|
| RetroPop | `RetroPop01a_CE_ZIMGT_AIT5k.safetensors` | Style | 0.5 |
| ClayArt | `ClayArt01a_CE_ZIMGT_AIT4k.safetensors` | Style | 0.5 |
| Geometric | `Geometric01_CE_ZIMGT_AIT5k.safetensors` | Style | 0.5 |
| PencilDraw | `PencilDrawEn01_CE_ZIMGT_AIT3k.safetensors` | Style | 0.5 |

---

## 7. Post-Processing Pipeline (Optional)

### 7.1 FaceDetailer

For improved facial details, chain with FaceDetailer:

```
VAEDecode → FaceDetailer → Output
              ├── bbox_detector: face_yolov8m.pt
              ├── denoise: 0.1-0.3
              └── steps: 20
```

### 7.2 Upscaling

Compatible upscalers:
- `DAT_x4.pth` (recommended)
- `RealESRGAN_x4plus.pth`
- `4x-UltraSharp.pth`

---

## 8. Prompt Transformation Reference

### 8.1 Tag-to-Natural-Language Mapping

| Danbooru/Pony Tag | Z-Image Natural Language |
|-------------------|-------------------------|
| `1girl` | `a young adult woman` |
| `1boy` | `a young adult man` |
| `solo` | `alone in the frame` |
| `looking_at_viewer` | `gazing directly at the camera` |
| `smile` | `with a warm, genuine smile` |
| `blush` | `with a subtle pink flush on cheeks` |
| `long_hair` | `with flowing hair that reaches past shoulders` |
| `blue_eyes` | `with striking blue eyes` |
| `school_uniform` | `wearing a traditional school uniform with pleated skirt and blazer` |
| `outdoors` | `in an outdoor setting` |
| `sky` | `beneath an expansive sky` |
| `detailed_background` | `with a richly detailed environment behind` |

### 8.2 Quality Tag Transformation

| Quality Tag | Z-Image Equivalent |
|-------------|-------------------|
| `masterpiece, best quality` | `professional quality, exceptional detail, masterfully composed` |
| `highly detailed` | `intricate details visible throughout, sharp focus on fine elements` |
| `absurdres` | `ultra-high resolution, extreme clarity` |
| `8k wallpaper` | `8K resolution quality, suitable for large format display` |

---

## 9. Troubleshooting

### 9.1 Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| Blurry output | Resolution not divisible by 32 | Adjust to valid dimensions |
| Ignored prompt elements | Prompt too short | Expand to 100-200 words |
| Wrong style | No style LoRA | Add appropriate style LoRA |
| Anatomy issues | Insufficient description | Add "correct human anatomy, natural proportions" |
| Text rendering errors | Text too long | Keep rendered text to 1-4 words |

### 9.2 Diagnostic Checklist

- [ ] Using `lumina2` CLIP type?
- [ ] Steps set to 8?
- [ ] CFG at 1.0?
- [ ] Resolution divisible by 32?
- [ ] Prompt length 80-250 words?
- [ ] No negative prompt reliance?

---

## 10. Example Prompts

### 10.1 SFW Portrait

```
A professional headshot photograph of an adult woman in her early thirties.
She has warm brown skin, natural curly black hair styled in a professional
updo, and intelligent dark brown eyes. She wears a tailored navy blue blazer
over a cream silk blouse, with small gold stud earrings. Her expression is
confident yet approachable, with a subtle professional smile.

The background is a soft gradient of neutral gray tones, creating clean
separation from the subject. Three-point studio lighting with a large softbox
as key light creates gentle shadows that define her facial structure.
A subtle rim light separates her from the background.

Sharp focus on eyes, shallow depth of field, professional corporate photography,
8K quality, clean and polished aesthetic.
```

### 10.2 Fantasy Scene

```
A powerful sorceress stands atop a crystalline tower, arcane energy swirling
around her outstretched hands. She has flowing silver hair that defies gravity,
lifted by magical currents, and piercing violet eyes that glow with inner power.
Her elaborate robes are deep purple with golden runic embroidery, billowing
dramatically in the mystical wind.

Behind her, a massive storm gathers with lightning crackling through dark clouds.
The tower overlooks an ancient city of floating islands connected by bridges
of pure light. Multiple moons hang in the twilight sky, casting ethereal shadows.

Fantasy concept art style, dramatic lighting with magical glow effects,
epic scale composition, intricate details on clothing and architecture,
sharp focus throughout, 8K quality, professional illustration.
```

### 10.3 Text Rendering

```
A vibrant retro diner scene at night. In the foreground, a large neon sign
glows in hot pink and electric blue, displaying the text "STARLITE DINER"
in classic 1950s script lettering. The sign buzzes with authentic neon glow,
creating colorful reflections on the wet pavement below.

Behind the sign, the chrome and glass facade of the diner is visible, with
warm yellow light spilling from large windows. A vintage Chevrolet Bel Air
in turquoise and white is parked outside. The sky is deep twilight blue
with the first stars appearing.

Photorealistic, cinematic composition, shallow depth of field with sign in
sharp focus, nostalgic Americana aesthetic, professional night photography.
```

---

## Appendix A: Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│              Z-IMAGE TURBO QUICK REFERENCE                   │
├─────────────────────────────────────────────────────────────┤
│  Steps: 8          CFG: 1.0         Sampler: euler          │
│  Scheduler: simple                  CLIP: lumina2           │
│                                                              │
│  Prompt: 100-300 words natural language                     │
│  Negative: NOT SUPPORTED (ignored completely)               │
│                                                              │
│  Resolution: Must be divisible by 32                        │
│  Recommended: 768×1024 (portrait) or 1024×768 (landscape)   │
│                                                              │
│  LoRAs: Up to 3, strength 0.4-0.7 typical                   │
│  Text: Excellent - quote exact text, keep short             │
└─────────────────────────────────────────────────────────────┘
```

---

## Appendix B: Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-01-21 | Initial structured guide |
