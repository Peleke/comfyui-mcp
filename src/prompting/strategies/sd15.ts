import { PromptStrategy } from "./base.js";
import { ModelFamily, PromptRequest, GeneratedPrompt } from "../types.js";

/**
 * Prompt strategy for SD 1.5 models
 *
 * Key characteristics:
 * - Tag-based, comma-separated
 * - Quality tags important
 * - Extensive negative prompts REQUIRED
 * - More forgiving of prompt structure
 */
export class SD15Strategy extends PromptStrategy {
  readonly family: ModelFamily = "sd15";
  readonly name = "SD 1.5";

  private readonly QUALITY_TAGS = [
    "masterpiece",
    "best quality",
    "high resolution",
    "detailed",
  ];

  private readonly NEGATIVE_PROMPT =
    "(worst quality:1.4), (low quality:1.4), (normal quality:1.4), lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, jpeg artifacts, signature, watermark, username, blurry, artist name, monochrome, sketch, censorship, censor, multiple views";

  generate(request: PromptRequest): GeneratedPrompt {
    const parts: string[] = [];

    // 1. Quality tags
    parts.push(...this.QUALITY_TAGS);

    // 2. Style keywords
    const styleKw = this.getStyleKeywords(request.style);
    if (styleKw.length > 0) {
      parts.push(...styleKw);
    }

    // 3. Main description as tags
    const tags = this.descriptionToTags(request.description);
    parts.push(...tags);

    // 4. Additional user style keywords
    if (request.styleKeywords) {
      parts.push(...request.styleKeywords);
    }

    // 5. Camera/lighting if specified
    if (request.camera?.lighting) {
      parts.push(request.camera.lighting);
    }
    if (request.camera?.angle) {
      parts.push(request.camera.angle);
    }

    // 6. Emphasized elements
    if (request.emphasize) {
      parts.push(...request.emphasize.map((e) => this.applyEmphasis(e, 1.3)));
    }

    const positive = parts.join(", ");

    // SD 1.5 uses 512x512 base but can stretch
    const dimensions = this.getSD15Dimensions(request.aspectRatio);

    return {
      positive,
      negative: this.NEGATIVE_PROMPT,
      modelFamily: this.family,
      recommendedSettings: {
        steps: 28,
        cfgScale: 7.5,
        sampler: "euler_ancestral",
        scheduler: "normal",
        ...dimensions,
      },
      explanation: this.buildExplanation(),
      variations: this.generateVariations(parts),
    };
  }

  protected applyEmphasis(keyword: string, strength: number = 1.1): string {
    if (strength === 1.0) return keyword;
    return `(${keyword}:${strength.toFixed(1)})`;
  }

  /**
   * Get SD 1.5 appropriate dimensions (512 base)
   */
  private getSD15Dimensions(
    aspectRatio?: "portrait" | "landscape" | "square" | "wide" | "tall"
  ): { width: number; height: number } {
    switch (aspectRatio) {
      case "portrait":
        return { width: 512, height: 768 };
      case "landscape":
        return { width: 768, height: 512 };
      case "square":
        return { width: 512, height: 512 };
      case "wide":
        return { width: 768, height: 432 };
      case "tall":
        return { width: 432, height: 768 };
      default:
        return { width: 512, height: 512 };
    }
  }

  /**
   * Convert natural language to tag format
   */
  private descriptionToTags(description: string): string[] {
    return description
      .split(/[,.]/)
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 0);
  }

  private buildExplanation(): string {
    return `SD 1.5 prompt structure (Tag-based):

Key points:
- Comma-separated tags work best
- Quality tags at the start are important
- EXTENSIVE negative prompt is REQUIRED
- Lower resolution (512px base) but can extend
- Very flexible with LoRAs and embeddings

Negative prompt is critical - SD 1.5 needs more guidance
to avoid common artifacts than newer models.

Recommended: Euler A, CFG 7-8, 28 steps`;
  }

  private generateVariations(baseParts: string[]): string[] {
    const variations: string[] = [];

    // Variation 1: More emphasis on quality
    const quality = ["ultra detailed", "ultra high res", ...baseParts];
    variations.push(quality.join(", "));

    return variations;
  }
}
