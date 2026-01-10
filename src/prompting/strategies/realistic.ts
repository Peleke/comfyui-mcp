import { PromptStrategy } from "./base.js";
import {
  ModelFamily,
  PromptRequest,
  GeneratedPrompt,
} from "../types.js";

/**
 * Prompt strategy for realistic/photographic models
 * (CyberRealistic, DreamShaper, Deliberate, etc.)
 *
 * Key characteristics:
 * - Photographic terminology
 * - Camera settings are important
 * - Lighting descriptions
 * - Skin/texture details
 */
export class RealisticStrategy extends PromptStrategy {
  readonly family: ModelFamily = "realistic";
  readonly name = "Realistic/Photo";

  private readonly PHOTO_QUALITY = [
    "RAW photo",
    "professional photography",
    "8K UHD",
    "high resolution",
    "detailed skin texture",
  ];

  private readonly NEGATIVE_PROMPT =
    "cartoon, anime, illustration, painting, drawing, art, sketch, (deformed iris:1.2), (deformed pupils:1.2), poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, disconnected limbs, mutation, ugly, disgusting, amputation, (worst quality:1.4), (low quality:1.4), watermark, signature";

  generate(request: PromptRequest): GeneratedPrompt {
    const sections: string[] = [];

    // 1. Photo quality markers
    sections.push(...this.PHOTO_QUALITY.slice(0, 3));

    // 2. Main subject
    const subject = this.buildSubject(request.description);
    sections.push(subject);

    // 3. Camera settings (CRITICAL for realistic)
    const camera = this.buildCameraSection(request);
    if (camera) {
      sections.push(camera);
    }

    // 4. Lighting (also critical)
    const lighting = this.buildLighting(request);
    if (lighting) {
      sections.push(lighting);
    }

    // 5. Style modifiers
    if (request.styleKeywords && request.styleKeywords.length > 0) {
      sections.push(...request.styleKeywords);
    }

    // 6. Texture and detail keywords
    sections.push("detailed textures", "natural skin");

    // 7. Emphasized elements
    if (request.emphasize && request.emphasize.length > 0) {
      const emphasized = request.emphasize.map((e) =>
        this.applyEmphasis(e, 1.15)
      );
      sections.push(...emphasized);
    }

    const positive = sections.join(", ");
    const dimensions = this.getDimensions(request.aspectRatio);

    return {
      positive,
      negative: this.NEGATIVE_PROMPT,
      modelFamily: this.family,
      recommendedSettings: {
        steps: 30,
        cfgScale: 7,
        sampler: "dpmpp_2m_sde",
        scheduler: "karras",
        ...dimensions,
      },
      explanation: this.buildExplanation(request),
      variations: this.generateVariations(sections),
    };
  }

  protected applyEmphasis(keyword: string, strength: number = 1.1): string {
    if (strength === 1.0) return keyword;
    return `(${keyword}:${strength.toFixed(2)})`;
  }

  /**
   * Build subject description for photo realism
   */
  private buildSubject(description: string): string {
    let subject = description.trim();

    // Add realism markers if not present
    if (
      !subject.toLowerCase().includes("photo") &&
      !subject.toLowerCase().includes("realistic")
    ) {
      subject = `${subject}, realistic`;
    }

    return subject;
  }

  /**
   * Build camera settings section
   */
  private buildCameraSection(request: PromptRequest): string | null {
    const parts: string[] = [];

    if (request.camera?.focalLength) {
      parts.push(`shot on ${request.camera.focalLength}`);
    } else {
      // Default good portrait lens
      parts.push("shot on 85mm f/1.4");
    }

    if (request.camera?.aperture) {
      const aperture = request.camera.aperture;
      parts.push(aperture);
      const apertureNum = parseFloat(aperture.replace("f/", ""));
      if (apertureNum <= 2.0) {
        parts.push("shallow depth of field", "bokeh");
      }
    }

    if (request.camera?.angle) {
      parts.push(request.camera.angle);
    }

    return parts.length > 0 ? parts.join(", ") : null;
  }

  /**
   * Build lighting description
   */
  private buildLighting(request: PromptRequest): string | null {
    if (request.camera?.lighting) {
      return request.camera.lighting;
    }

    // Default to flattering lighting
    return "soft natural lighting, golden hour";
  }

  private buildExplanation(request: PromptRequest): string {
    return `Realistic/Photo prompt structure:

Key elements for photorealism:
1. RAW photo, professional photography markers
2. Camera specs (lens, aperture) - VERY important
3. Lighting description - makes or breaks realism
4. Texture keywords (detailed skin, fabric texture)
5. Negative prompt is extensive to avoid anime/cartoon contamination

Camera tips:
- 85mm for portraits (flattering compression)
- 35mm for environmental/street
- f/1.4-2.8 for bokeh, f/8+ for landscapes
- "Golden hour" or "studio lighting" for best skin

Recommended: DPM++ 2M SDE Karras, CFG 6-8, 30 steps`;
  }

  private generateVariations(baseSections: string[]): string[] {
    const variations: string[] = [];

    // Variation 1: Studio lighting
    const studio = [
      ...baseSections.filter((s) => !s.includes("golden hour")),
      "professional studio lighting",
      "softbox lighting",
    ];
    variations.push(studio.join(", "));

    // Variation 2: Cinematic
    const cinematic = [
      ...baseSections,
      "cinematic color grading",
      "film grain",
      "movie still",
    ];
    variations.push(cinematic.join(", "));

    return variations;
  }
}
