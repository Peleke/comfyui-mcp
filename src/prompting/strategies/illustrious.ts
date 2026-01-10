import { PromptStrategy } from "./base.js";
import {
  ModelFamily,
  PromptRequest,
  GeneratedPrompt,
  ContentRating,
} from "../types.js";

/**
 * Prompt strategy for Illustrious XL and NovelAI-style models
 *
 * Key characteristics:
 * - Tag-based prompting (comma-separated)
 * - Quality boosters at start
 * - Extensive negative prompt required
 * - CFG 4.5-7.5, Euler A, 20+ steps
 */
export class IllustriousStrategy extends PromptStrategy {
  readonly family: ModelFamily = "illustrious";
  readonly name = "Illustrious XL";

  private readonly QUALITY_TAGS = [
    "masterpiece",
    "best quality",
    "absurdres",
    "newest",
  ];

  private readonly NEGATIVE_PROMPT =
    "lowres, (bad), bad anatomy, bad hands, extra digits, multiple views, fewer, extra, missing, text, error, worst quality, jpeg artifacts, low quality, watermark, unfinished, displeasing, oldest, early, chromatic aberration, signature, artistic error, username, scan";

  private readonly NEGATIVE_PROMPT_SHORT =
    "lowres, worst quality, bad quality, bad anatomy, sketch, jpeg artifacts, signature, watermark, old, oldest";

  generate(request: PromptRequest): GeneratedPrompt {
    const parts: string[] = [];

    // 1. Quality tags at the start
    parts.push(...this.QUALITY_TAGS);

    // 2. Rating tag if safe content
    const ratingTag = this.getRatingTag(request.rating);
    if (ratingTag) {
      parts.push(ratingTag);
    }

    // 3. Style keywords
    const styleKw = this.getStyleKeywords(request.style);
    if (styleKw.length > 0) {
      parts.push(...styleKw);
    }

    // 4. Main description - convert to tag format
    const descriptionTags = this.descriptionToTags(request.description);
    parts.push(...descriptionTags);

    // 5. Additional style keywords from user
    if (request.styleKeywords) {
      parts.push(...request.styleKeywords);
    }

    // 6. Camera/angle if specified
    if (request.camera?.angle) {
      parts.push(request.camera.angle);
    }
    if (request.camera?.lighting) {
      parts.push(request.camera.lighting);
    }

    // 7. Emphasize specific elements
    if (request.emphasize) {
      parts.push(...request.emphasize.map((e) => this.applyEmphasis(e, 1.2)));
    }

    const positive = parts.join(", ");
    const dimensions = this.getDimensions(request.aspectRatio);

    return {
      positive,
      negative: this.NEGATIVE_PROMPT,
      modelFamily: this.family,
      recommendedSettings: {
        steps: 24,
        cfgScale: 5.5,
        sampler: "euler_ancestral",
        scheduler: "normal",
        ...dimensions,
      },
      explanation: this.buildExplanation(request),
      variations: this.generateVariations(parts),
    };
  }

  protected applyEmphasis(keyword: string, strength: number = 1.1): string {
    if (strength === 1.0) return keyword;
    // Illustrious uses (keyword:weight) syntax
    return `(${keyword}:${strength.toFixed(1)})`;
  }

  protected getRatingTag(rating?: ContentRating): string | null {
    if (rating === "safe") return "general";
    return null;
  }

  /**
   * Convert natural language to tag format
   */
  private descriptionToTags(description: string): string[] {
    // Split on common delimiters and clean up
    const parts = description
      .split(/[,.]/)
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 0);

    // Further split long phrases
    const tags: string[] = [];
    for (const part of parts) {
      // If it's a short phrase (< 5 words), keep it
      const words = part.split(/\s+/);
      if (words.length <= 4) {
        tags.push(part);
      } else {
        // Extract key noun phrases
        tags.push(part);
      }
    }

    return tags;
  }

  private buildExplanation(request: PromptRequest): string {
    return `Illustrious XL prompt structure:
1. Quality boosters (masterpiece, best quality, absurdres, newest)
2. Content rating tag${request.rating === "safe" ? " (general for SFW)" : ""}
3. Style keywords${request.style ? ` (${request.style})` : ""}
4. Main subject and details as comma-separated tags
5. Extensive negative prompt to avoid common artifacts

Recommended settings: CFG 4.5-7.5, Euler A sampler, 20-28 steps`;
  }

  private generateVariations(baseParts: string[]): string[] {
    // Generate alternative quality tag combinations
    const variations: string[] = [];

    // Variation 1: Extra quality emphasis
    const enhanced = [
      ...baseParts.slice(0, 4),
      "perfect quality",
      "absolutely eye-catching",
      ...baseParts.slice(4),
    ];
    variations.push(enhanced.join(", "));

    // Variation 2: Realistic touches
    const realisticEnhanced = [
      ...baseParts,
      "ambient occlusion",
      "detailed lighting",
    ];
    variations.push(realisticEnhanced.join(", "));

    return variations;
  }
}
