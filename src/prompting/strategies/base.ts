import {
  ModelFamily,
  PromptRequest,
  GeneratedPrompt,
  StylePreset,
  ContentRating,
} from "../types.js";

/**
 * Base class for prompt generation strategies
 */
export abstract class PromptStrategy {
  abstract readonly family: ModelFamily;
  abstract readonly name: string;

  /**
   * Generate an optimized prompt for this model family
   */
  abstract generate(request: PromptRequest): GeneratedPrompt;

  /**
   * Get style-specific keywords for a preset
   */
  protected getStyleKeywords(style?: StylePreset): string[] {
    if (!style) return [];

    const styleMap: Record<StylePreset, string[]> = {
      anime: ["anime", "anime style", "anime art"],
      realistic_photo: ["photo", "photorealistic", "realistic", "photography"],
      digital_art: ["digital art", "digital painting", "digital illustration"],
      oil_painting: ["oil painting", "traditional art", "painterly"],
      watercolor: ["watercolor", "watercolor painting", "soft colors"],
      sketch: ["sketch", "pencil drawing", "line art"],
      "3d_render": ["3d render", "3d art", "cgi", "octane render"],
      pixel_art: ["pixel art", "pixelated", "retro game style"],
      comic: ["comic book style", "comic art", "manga"],
      cinematic: ["cinematic", "movie still", "film grain", "dramatic lighting"],
      fantasy: ["fantasy art", "fantasy", "magical", "ethereal"],
      sci_fi: ["sci-fi", "futuristic", "cyberpunk", "science fiction"],
      portrait: ["portrait", "face focus", "headshot"],
      landscape: ["landscape", "scenery", "wide shot", "environment"],
      concept_art: ["concept art", "illustration", "detailed background"],
    };

    return styleMap[style] || [];
  }

  /**
   * Get default dimensions for aspect ratio
   */
  protected getDimensions(
    aspectRatio?: "portrait" | "landscape" | "square" | "wide" | "tall"
  ): { width: number; height: number } {
    switch (aspectRatio) {
      case "portrait":
        return { width: 768, height: 1152 };
      case "landscape":
        return { width: 1152, height: 768 };
      case "square":
        return { width: 1024, height: 1024 };
      case "wide":
        return { width: 1344, height: 768 };
      case "tall":
        return { width: 768, height: 1344 };
      default:
        return { width: 1024, height: 1024 };
    }
  }

  /**
   * Apply emphasis to keywords (model-specific)
   */
  protected abstract applyEmphasis(keyword: string, strength?: number): string;

  /**
   * Get rating tag if applicable
   */
  protected getRatingTag(rating?: ContentRating): string | null {
    return null; // Override in subclasses that use rating tags
  }
}
