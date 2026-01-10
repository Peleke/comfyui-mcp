import { PromptStrategy } from "./base.js";
import {
  ModelFamily,
  PromptRequest,
  GeneratedPrompt,
  ContentRating,
  StylePreset,
} from "../types.js";

/**
 * Prompt strategy for Pony Diffusion models
 *
 * Key characteristics:
 * - Score tags (score_9, score_8_up, etc.)
 * - Source tags (source_anime, source_furry, etc.)
 * - Rating tags (rating_safe, rating_explicit)
 * - CLIP skip -2 recommended
 */
export class PonyStrategy extends PromptStrategy {
  readonly family: ModelFamily = "pony";
  readonly name = "Pony Diffusion";

  private readonly SCORE_TAGS = [
    "score_9",
    "score_8_up",
    "score_7_up",
    "score_6_up",
    "score_5_up",
    "score_4_up",
  ];

  private readonly SCORE_TAGS_MINIMAL = [
    "score_9",
    "score_8_up",
    "score_7_up",
  ];

  private readonly NEGATIVE_PROMPT =
    "score_5_up, score_4_up, blurry, low quality, worst quality, jpeg artifacts, watermark, signature, ugly, deformed";

  generate(request: PromptRequest): GeneratedPrompt {
    const parts: string[] = [];

    // 1. Score tags (always at the beginning)
    parts.push(...this.SCORE_TAGS);

    // 2. Source tag based on style
    const sourceTag = this.getSourceTag(request.style);
    if (sourceTag) {
      parts.push(sourceTag);
    }

    // 3. Rating tag
    const ratingTag = this.getRatingTag(request.rating);
    if (ratingTag) {
      parts.push(ratingTag);
    }

    // 4. Style keywords
    const styleKw = this.getStyleKeywords(request.style);
    if (styleKw.length > 0) {
      parts.push(...styleKw);
    }

    // 5. Main description - convert to tag format
    const descriptionTags = this.descriptionToTags(request.description);
    parts.push(...descriptionTags);

    // 6. Additional style keywords from user
    if (request.styleKeywords) {
      parts.push(...request.styleKeywords);
    }

    // 7. Emphasize specific elements
    if (request.emphasize) {
      parts.push(...request.emphasize.map((e) => this.applyEmphasis(e, 1.2)));
    }

    const positive = parts.join(", ");
    const dimensions = this.getDimensions(request.aspectRatio);

    // Build negative prompt
    let negative = this.NEGATIVE_PROMPT;
    // Add anti-style tags if going for anime to counter western bias
    if (request.style === "anime") {
      negative += ", source_cartoon, source_furry, source_pony";
    }

    return {
      positive,
      negative,
      modelFamily: this.family,
      recommendedSettings: {
        steps: 25,
        cfgScale: 7,
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
    // Pony uses (keyword:weight) syntax
    return `(${keyword}:${strength.toFixed(1)})`;
  }

  protected getRatingTag(rating?: ContentRating): string {
    switch (rating) {
      case "safe":
        return "rating_safe";
      case "suggestive":
        return "rating_questionable";
      case "explicit":
        return "rating_explicit";
      default:
        return "rating_safe";
    }
  }

  /**
   * Get the appropriate source tag based on style
   */
  private getSourceTag(style?: StylePreset): string | null {
    if (!style) return "source_anime"; // Default

    const sourceMap: Partial<Record<StylePreset, string | undefined>> = {
      anime: "source_anime",
      comic: "source_cartoon",
      realistic_photo: undefined, // No source tag for realistic
      "3d_render": "source_cartoon",
    };

    return sourceMap[style] ?? "source_anime";
  }

  /**
   * Convert natural language to tag format
   */
  private descriptionToTags(description: string): string[] {
    const parts = description
      .split(/[,.]/)
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 0);

    return parts;
  }

  private buildExplanation(request: PromptRequest): string {
    return `Pony Diffusion prompt structure:
1. Score tags (score_9 through score_4_up) - REQUIRED at the start
2. Source tag (source_anime, source_furry, etc.)
3. Rating tag (rating_safe, rating_questionable, rating_explicit)
4. Subject and style details as comma-separated tags

Note: Pony has a slight western art bias. Add "source_cartoon, source_furry, source_pony"
to negative prompt if you want more anime-style results.

Recommended: CLIP skip -2, CFG 6-8, Euler A sampler`;
  }

  private generateVariations(baseParts: string[]): string[] {
    const variations: string[] = [];

    // Variation 1: Minimal score tags (less bias)
    const minimal = [
      ...this.SCORE_TAGS_MINIMAL,
      ...baseParts.slice(this.SCORE_TAGS.length),
    ];
    variations.push(minimal.join(", "));

    return variations;
  }
}
