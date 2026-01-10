import { PromptStrategy } from "./base.js";
import {
  ModelFamily,
  PromptRequest,
  GeneratedPrompt,
  StylePreset,
} from "../types.js";

/**
 * Prompt strategy for standard SDXL models
 *
 * Key characteristics:
 * - Natural language, descriptive prompts (like a photographer)
 * - Subject → Action → Location → Aesthetic structure
 * - Minimal negative prompts needed
 * - Sensitive to keyword weights
 */
export class SDXLStrategy extends PromptStrategy {
  readonly family: ModelFamily = "sdxl";
  readonly name = "SDXL";

  private readonly QUALITY_ENHANCERS = [
    "high quality",
    "detailed",
    "professional",
  ];

  private readonly NEGATIVE_PROMPT =
    "cartoon, illustration, anime, painting, CGI, 3D render, unrealistic proportions, extra fingers, low quality, blurry, watermark";

  private readonly NEGATIVE_PROMPT_MINIMAL =
    "low quality, blurry, distorted";

  generate(request: PromptRequest): GeneratedPrompt {
    const sections: string[] = [];

    // SDXL prefers descriptive, natural language
    // Structure: Subject → Action → Location → Aesthetic & Style

    // 1. Main subject with qualifiers
    const subject = this.buildSubject(request.description, request);
    sections.push(subject);

    // 2. Style and aesthetic
    const style = this.buildStyle(request);
    if (style) {
      sections.push(style);
    }

    // 3. Quality enhancers (use sparingly)
    if (request.style === "realistic_photo" || request.style === "cinematic") {
      sections.push("8K, ultra detailed");
    }

    // 4. Technical/camera details for photo styles
    const technical = this.buildTechnical(request);
    if (technical) {
      sections.push(technical);
    }

    // 5. Emphasized elements with weights
    if (request.emphasize && request.emphasize.length > 0) {
      const emphasized = request.emphasize.map((e) =>
        this.applyEmphasis(e, 1.2)
      );
      sections.push(...emphasized);
    }

    const positive = sections.join(", ");
    const dimensions = this.getDimensions(request.aspectRatio);

    // SDXL needs minimal negatives
    let negative = this.NEGATIVE_PROMPT_MINIMAL;
    if (request.style === "realistic_photo") {
      negative = this.NEGATIVE_PROMPT;
    }

    return {
      positive,
      negative,
      modelFamily: this.family,
      recommendedSettings: {
        steps: 30,
        cfgScale: 7,
        sampler: "dpmpp_2m",
        scheduler: "karras",
        ...dimensions,
      },
      explanation: this.buildExplanation(request),
      variations: this.generateVariations(sections),
    };
  }

  protected applyEmphasis(keyword: string, strength: number = 1.1): string {
    if (strength === 1.0) return keyword;
    // SDXL is sensitive to weights - don't go too high
    const clampedStrength = Math.min(strength, 1.4);
    return `(${keyword}:${clampedStrength.toFixed(1)})`;
  }

  /**
   * Build the subject section
   */
  private buildSubject(description: string, request: PromptRequest): string {
    let subject = description.trim();

    // Add style context to subject if applicable
    if (request.style === "portrait") {
      if (!subject.toLowerCase().includes("portrait")) {
        subject = `portrait of ${subject}`;
      }
    } else if (request.style === "landscape") {
      if (!subject.toLowerCase().includes("landscape")) {
        subject = `${subject}, landscape photography`;
      }
    }

    return subject;
  }

  /**
   * Build style section
   */
  private buildStyle(request: PromptRequest): string | null {
    const styleParts: string[] = [];

    if (request.style) {
      const styleTerms: Partial<Record<StylePreset, string[]>> = {
        anime: ["anime style", "anime art"],
        realistic_photo: ["photorealistic", "photography", "photo"],
        digital_art: ["digital art", "digital painting"],
        oil_painting: ["oil painting", "classical art style"],
        watercolor: ["watercolor painting", "soft washes"],
        sketch: ["pencil sketch", "graphite drawing"],
        "3d_render": ["3D render", "octane render", "CGI"],
        cinematic: ["cinematic", "movie still", "dramatic lighting"],
        fantasy: ["fantasy art", "magical", "epic"],
        sci_fi: ["sci-fi", "futuristic", "cyberpunk aesthetic"],
        concept_art: ["concept art", "detailed illustration"],
      };
      const terms = styleTerms[request.style];
      if (terms) {
        styleParts.push(...terms);
      }
    }

    if (request.styleKeywords && request.styleKeywords.length > 0) {
      styleParts.push(...request.styleKeywords);
    }

    return styleParts.length > 0 ? styleParts.join(", ") : null;
  }

  /**
   * Build technical/photography section
   */
  private buildTechnical(request: PromptRequest): string | null {
    if (!request.camera) return null;

    const parts: string[] = [];

    if (request.camera.focalLength) {
      parts.push(`${request.camera.focalLength} lens`);
    }

    if (request.camera.aperture) {
      parts.push(request.camera.aperture);
    }

    if (request.camera.lighting) {
      parts.push(request.camera.lighting);
    }

    if (request.camera.angle) {
      parts.push(request.camera.angle);
    }

    return parts.length > 0 ? parts.join(", ") : null;
  }

  private buildExplanation(request: PromptRequest): string {
    return `SDXL prompt structure (Subject → Action → Location → Aesthetic):

Key points:
- Write descriptively, like a photographer describing a shot
- More detailed prompts generally yield better results
- Weights are sensitive - stay under 1.4 for emphasis
- Minimal negative prompts needed (unlike SD 1.5)
- "Photographic" and "Cinematic" styles work well for realism

For faces: use "Photographic" or "Cinematic" style
For landscapes: 16:9 aspect ratio recommended

Recommended: DPM++ 2M Karras, CFG 7, 30 steps`;
  }

  private generateVariations(baseSections: string[]): string[] {
    const variations: string[] = [];

    // Variation 1: More cinematic
    const cinematic = [...baseSections, "cinematic lighting", "film grain"];
    variations.push(cinematic.join(", "));

    // Variation 2: More detailed
    const detailed = [...baseSections, "intricate details", "sharp focus", "8K"];
    variations.push(detailed.join(", "));

    return variations;
  }
}
