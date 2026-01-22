import { PromptStrategy } from "./base.js";
import {
  ModelFamily,
  PromptRequest,
  GeneratedPrompt,
  StylePreset,
} from "../types.js";

/**
 * Prompt strategy for Z-Image Turbo models
 *
 * Key characteristics:
 * - Natural language prompts (100-300 words OPTIMAL)
 * - NO negative prompts (completely ignored by model)
 * - NO weight syntax (describe importance naturally)
 * - Structure: Subject → Appearance → Environment → Lighting → Style → Technical
 * - Lighting descriptions have HIGH impact
 * - Excellent text rendering capability
 * - Content control via positive constraints only
 *
 * This transformer takes natural user input and EXPANDS it into
 * the detailed prose format Z-Image Turbo expects.
 */
export class ZTurboStrategy extends PromptStrategy {
  readonly family: ModelFamily = "z_image_turbo";
  readonly name = "Z-Image Turbo";

  generate(request: PromptRequest): GeneratedPrompt {
    // Build comprehensive natural language prompt
    const expandedPrompt = this.expandToZImageFormat(request);

    const dimensions = this.getDimensions(request.aspectRatio);

    return {
      positive: expandedPrompt,
      negative: "", // Z-Image Turbo IGNORES negative prompts
      modelFamily: this.family,
      recommendedSettings: {
        steps: 8,         // Turbo distillation optimized
        cfgScale: 1,      // Fixed, ignored anyway
        sampler: "euler",
        scheduler: "simple",
        ...dimensions,
      },
      explanation: this.buildExplanation(request),
      variations: this.generateVariations(request, expandedPrompt),
    };
  }

  protected applyEmphasis(keyword: string, _strength: number = 1.1): string {
    // Z-Image Turbo doesn't support weight syntax
    // Instead, we use descriptive emphasis and word order
    return keyword;
  }

  /**
   * Expand user input into Z-Image Turbo optimized format
   *
   * Takes potentially short/tag-based input and expands into
   * 100-300 word natural language prose
   */
  private expandToZImageFormat(request: PromptRequest): string {
    const sections: string[] = [];

    // 1. SUBJECT - Expand main description
    const subject = this.expandSubject(request.description);
    sections.push(subject);

    // 2. STYLE - Artistic approach (natural language)
    const style = this.buildStyleSection(request);
    if (style) {
      sections.push(style);
    }

    // 3. LIGHTING - Z-Image responds STRONGLY to lighting
    const lighting = this.buildLightingSection(request);
    if (lighting) {
      sections.push(lighting);
    }

    // 4. TECHNICAL - Quality markers
    const technical = this.buildTechnicalSection(request);
    if (technical) {
      sections.push(technical);
    }

    // 5. CONSTRAINTS - Positive-only content control
    const constraints = this.buildConstraintSection(request);
    if (constraints) {
      sections.push(constraints);
    }

    return sections.join(" ");
  }

  /**
   * Expand potentially short/tag-based description into prose
   */
  private expandSubject(description: string): string {
    // Check if input is tag-based (commas, underscores, typical tags)
    const isTagBased = this.detectTagFormat(description);

    if (isTagBased) {
      return this.convertTagsToNaturalLanguage(description);
    }

    // Already natural language - enhance and ensure detail
    return this.enhanceNaturalLanguage(description);
  }

  /**
   * Detect if input is in tag/booru format
   */
  private detectTagFormat(text: string): boolean {
    const tagIndicators = [
      /\d+(?:boy|girl|girls|boys)/i,           // 1girl, 2boys
      /\b(?:solo|looking_at_viewer|blush)\b/i, // Common tags
      /_/,                                       // Underscores
      /,\s*(?:\w+_\w+)/,                        // Comma-separated with underscores
      /\b(?:masterpiece|best quality)\b/i,     // Quality tags
      /\bscore_\d+/i,                           // Pony score tags
    ];

    return tagIndicators.some((pattern) => pattern.test(text));
  }

  /**
   * Convert tag-based input to natural language prose
   */
  private convertTagsToNaturalLanguage(tagInput: string): string {
    // Split by commas
    const tags = tagInput.split(",").map((t) => t.trim().toLowerCase());

    const result: string[] = [];

    // Character count and basic info
    const charTags = this.extractCharacterTags(tags);
    if (charTags.count) {
      result.push(charTags.description);
    }

    // Actions and poses
    const actionDesc = this.extractActionTags(tags);
    if (actionDesc) {
      result.push(actionDesc);
    }

    // Setting/environment
    const settingDesc = this.extractSettingTags(tags);
    if (settingDesc) {
      result.push(settingDesc);
    }

    // Appearance details
    const appearanceDesc = this.extractAppearanceTags(tags);
    if (appearanceDesc) {
      result.push(appearanceDesc);
    }

    // Any remaining descriptive content
    const remaining = tags
      .filter(
        (t) =>
          !this.isQualityTag(t) &&
          !this.isCharacterCountTag(t) &&
          t.length > 2
      )
      .slice(0, 5)
      .map((t) => t.replace(/_/g, " "))
      .join(", ");

    if (remaining && result.length < 3) {
      result.push(remaining);
    }

    return result.join(". ") + ".";
  }

  /**
   * Extract character count tags (1girl, 2boys, etc.)
   */
  private extractCharacterTags(
    tags: string[]
  ): { count: number; description: string } {
    const charPatterns: Record<string, { gender: string; count: number }> = {
      "1girl": { gender: "woman", count: 1 },
      "1boy": { gender: "man", count: 1 },
      "2girls": { gender: "women", count: 2 },
      "2boys": { gender: "men", count: 2 },
      "1girl 1boy": { gender: "couple", count: 2 },
      solo: { gender: "figure", count: 1 },
    };

    for (const tag of tags) {
      const match = charPatterns[tag.replace(/_/g, " ")];
      if (match) {
        const article = match.count === 1 ? "A" : `${match.count}`;
        const noun =
          match.count === 1
            ? `young adult ${match.gender}`
            : `young adult ${match.gender}`;
        return {
          count: match.count,
          description: `${article} ${noun}`,
        };
      }
    }

    return { count: 0, description: "" };
  }

  /**
   * Extract action/pose tags
   */
  private extractActionTags(tags: string[]): string | null {
    const actionMap: Record<string, string> = {
      looking_at_viewer: "gazing directly at the viewer",
      from_behind: "seen from behind",
      from_below: "viewed from a low angle",
      from_above: "viewed from above",
      sitting: "seated comfortably",
      standing: "standing",
      lying: "lying down",
      walking: "walking",
      running: "in motion, running",
      fighting: "in a dynamic fighting pose",
      sleeping: "peacefully sleeping",
      eating: "eating",
      drinking: "drinking",
      reading: "reading",
    };

    const actions = tags
      .filter((t) => actionMap[t.replace(/ /g, "_")] !== undefined)
      .map((t) => actionMap[t.replace(/ /g, "_")]);

    return actions.length > 0 ? actions.join(", ") : null;
  }

  /**
   * Extract setting/environment tags
   */
  private extractSettingTags(tags: string[]): string | null {
    const settingMap: Record<string, string> = {
      outdoors: "in an outdoor setting",
      indoors: "in an indoor setting",
      bedroom: "in a bedroom",
      bathroom: "in a bathroom",
      kitchen: "in a kitchen",
      office: "in an office",
      school: "at a school",
      classroom: "in a classroom",
      beach: "at the beach",
      forest: "in a forest",
      city: "in a city environment",
      night: "at night",
      day: "during the day",
      sunset: "at sunset",
      sunrise: "at sunrise",
      rain: "in the rain",
      snow: "in the snow",
      space: "in space",
      underwater: "underwater",
      yacht: "on a yacht",
      boat: "on a boat",
      pool: "by or in a pool",
    };

    const settings = tags
      .filter((t) => settingMap[t.replace(/ /g, "_")] !== undefined)
      .map((t) => settingMap[t.replace(/ /g, "_")]);

    return settings.length > 0 ? settings.join(", ") : null;
  }

  /**
   * Extract appearance tags
   */
  private extractAppearanceTags(tags: string[]): string | null {
    const appearanceParts: string[] = [];

    // Hair
    const hairColors = ["blonde", "brunette", "black_hair", "red_hair", "blue_hair", "pink_hair", "white_hair", "silver_hair", "green_hair", "purple_hair"];
    const hairStyles = ["long_hair", "short_hair", "ponytail", "twintails", "braid", "bun", "messy_hair", "straight_hair", "curly_hair", "wavy_hair"];

    for (const tag of tags) {
      const normalizedTag = tag.replace(/ /g, "_");
      if (hairColors.includes(normalizedTag)) {
        appearanceParts.push(`with ${tag.replace(/_/g, " ")}`);
      }
      if (hairStyles.includes(normalizedTag)) {
        appearanceParts.push(`${tag.replace(/_/g, " ")}`);
      }
    }

    // Eyes
    const eyeColors = ["blue_eyes", "green_eyes", "brown_eyes", "red_eyes", "golden_eyes", "purple_eyes", "heterochromia"];
    for (const tag of tags) {
      const normalizedTag = tag.replace(/ /g, "_");
      if (eyeColors.includes(normalizedTag)) {
        appearanceParts.push(`${tag.replace(/_/g, " ")}`);
      }
    }

    // Body features
    const bodyFeatures = ["muscular", "slim", "curvy", "petite", "tall", "short", "athletic", "chubby"];
    for (const tag of tags) {
      if (bodyFeatures.includes(tag)) {
        appearanceParts.push(`${tag} build`);
      }
    }

    return appearanceParts.length > 0 ? appearanceParts.join(", ") : null;
  }

  /**
   * Check if tag is a quality/meta tag (to be handled differently)
   */
  private isQualityTag(tag: string): boolean {
    const qualityTags = [
      "masterpiece",
      "best quality",
      "high quality",
      "absurdres",
      "highres",
      "incredibly absurdres",
      "8k",
      "4k",
      "detailed",
      "highly detailed",
    ];
    return qualityTags.some((qt) => tag.includes(qt));
  }

  /**
   * Check if tag is a character count tag
   */
  private isCharacterCountTag(tag: string): boolean {
    return /^\d+(?:girl|boy|girls|boys)$/.test(tag) || tag === "solo";
  }

  /**
   * Enhance already natural language input
   */
  private enhanceNaturalLanguage(text: string): string {
    // Ensure first letter is capitalized
    let enhanced = text.charAt(0).toUpperCase() + text.slice(1);

    // Ensure it ends with proper punctuation
    if (!/[.!?]$/.test(enhanced)) {
      enhanced += ".";
    }

    return enhanced;
  }

  /**
   * Build style section in natural language
   */
  private buildStyleSection(request: PromptRequest): string | null {
    const styleParts: string[] = [];

    if (request.style) {
      const styleDescriptions: Partial<Record<StylePreset, string>> = {
        anime:
          "Rendered in high-quality anime art style with vibrant colors and expressive details",
        realistic_photo:
          "Professional photography quality with photorealistic rendering",
        digital_art:
          "Digital illustration with clean lines and polished finish",
        oil_painting:
          "Classical oil painting technique with visible brushstrokes and rich textures",
        watercolor:
          "Delicate watercolor painting with soft edges and flowing pigments",
        sketch: "Detailed pencil sketch with careful shading and linework",
        "3d_render":
          "High-quality 3D render with realistic materials and lighting",
        pixel_art: "Retro pixel art style with deliberate chunky pixels",
        comic: "Bold comic book illustration with dynamic linework",
        cinematic:
          "Cinematic composition with dramatic lighting and film-quality presentation",
        fantasy:
          "Fantasy illustration with magical atmosphere and otherworldly elements",
        sci_fi:
          "Science fiction concept art with futuristic technology and design",
        portrait:
          "Professional portrait photography with flattering lighting",
        landscape: "Sweeping landscape photography capturing natural beauty",
        concept_art:
          "Detailed concept art illustration suitable for production use",
      };
      const styleDesc = styleDescriptions[request.style];
      if (styleDesc) {
        styleParts.push(styleDesc);
      }
    }

    if (request.styleKeywords && request.styleKeywords.length > 0) {
      styleParts.push(
        `Style elements: ${request.styleKeywords.join(", ")}`
      );
    }

    return styleParts.length > 0 ? styleParts.join(". ") + "." : null;
  }

  /**
   * Build lighting section - Z-Image responds STRONGLY to lighting
   */
  private buildLightingSection(request: PromptRequest): string | null {
    if (!request.camera?.lighting) {
      // Add default lighting based on style
      if (request.style === "cinematic") {
        return "Dramatic cinematic lighting with high contrast and volumetric rays.";
      }
      if (request.style === "portrait") {
        return "Professional portrait lighting with soft key light and subtle fill.";
      }
      return null;
    }

    const lightingDescriptions: Record<string, string> = {
      "golden hour":
        "Bathed in warm golden hour sunlight, with long shadows and amber tones casting a magical glow across the scene",
      "blue hour":
        "In the soft blue light of dusk, with deep azure tones and gentle shadows creating a serene atmosphere",
      "studio lighting":
        "Professional studio lighting setup with controlled shadows and even illumination",
      "natural light":
        "Illuminated by natural daylight, with soft shadows and true-to-life color rendering",
      "dramatic lighting":
        "Dramatic high-contrast lighting with deep shadows and bright highlights creating visual tension",
      "soft lighting":
        "Soft, diffused lighting that gently wraps around forms, minimizing harsh shadows",
      backlit:
        "Beautifully backlit with a luminous rim of light outlining the subject against the background",
      "rim lighting":
        "Rim lighting creates a glowing outline, separating the subject from the background with ethereal effect",
      "low-key":
        "Low-key lighting with predominantly dark tones and selective highlights for moody atmosphere",
      "high-key":
        "High-key lighting with bright, airy tones and minimal shadows for an optimistic feel",
      neon: "Neon lighting casting vibrant colored glows in pink, blue, and purple",
      candlelight:
        "Warm candlelight flickering with orange and amber tones, creating intimate atmosphere",
      moonlight:
        "Cool moonlight casting silvery-blue tones and long gentle shadows",
    };

    const lightingKey = request.camera.lighting.toLowerCase();
    return (
      lightingDescriptions[lightingKey] ||
      `Lighting: ${request.camera.lighting}.`
    );
  }

  /**
   * Build technical quality section
   */
  private buildTechnicalSection(request: PromptRequest): string | null {
    const techParts: string[] = [];

    // Camera settings if provided
    if (request.camera) {
      if (request.camera.focalLength) {
        const focalNum = parseInt(request.camera.focalLength);
        if (focalNum <= 35) {
          techParts.push(
            "Wide-angle perspective capturing expansive view"
          );
        } else if (focalNum >= 85) {
          techParts.push(
            "Telephoto compression with flattering perspective"
          );
        }
      }

      if (request.camera.aperture) {
        const aperture = request.camera.aperture;
        const apertureNum = parseFloat(aperture.replace("f/", ""));
        if (apertureNum <= 2.8) {
          techParts.push(
            "Shallow depth of field with creamy bokeh background blur"
          );
        } else if (apertureNum >= 8) {
          techParts.push("Deep focus with sharp detail throughout the frame");
        }
      }

      if (request.camera.angle) {
        const angleDescriptions: Record<string, string> = {
          "low angle": "Shot from a low angle looking up, adding grandeur",
          "high angle":
            "Photographed from above, creating a sense of overview",
          "bird's eye": "Aerial bird's eye perspective looking straight down",
          "eye level": "At natural eye level for direct connection",
          "dutch angle": "Dynamic tilted angle adding visual tension",
          "close-up":
            "Intimate close-up framing focusing on details",
          "wide shot":
            "Wide establishing shot showing full context and environment",
        };
        const angleDesc =
          angleDescriptions[request.camera.angle.toLowerCase()];
        if (angleDesc) {
          techParts.push(angleDesc);
        }
      }
    }

    // Always add quality markers for Z-Image
    techParts.push(
      "Sharp focus, high clarity, professional quality rendering"
    );

    return techParts.join(". ") + ".";
  }

  /**
   * Build positive constraints (replaces negative prompts)
   */
  private buildConstraintSection(request: PromptRequest): string | null {
    const constraints: string[] = [];

    // Anatomy constraints (always good to include)
    constraints.push("Correct human anatomy, natural proportions");

    // Rating-based constraints
    if (request.rating === "safe") {
      constraints.push("Appropriate content, fully clothed");
    } else if (request.rating === "explicit") {
      constraints.push("Anatomically accurate, natural poses");
    }

    // Emphasis elements
    if (request.emphasize && request.emphasize.length > 0) {
      constraints.push(
        `Emphasis on ${request.emphasize.join(" and ")}`
      );
    }

    return constraints.join(". ") + ".";
  }

  private buildExplanation(request: PromptRequest): string {
    const wasTagBased = this.detectTagFormat(request.description);

    return `Z-Image Turbo prompt optimization:

${wasTagBased ? "CONVERTED from tag-based to natural language format." : "Enhanced natural language format."}

CRITICAL: Z-Image Turbo DOES NOT USE negative prompts!
- guidance_scale is internally set to 0
- All content control must be through POSITIVE description
- Describe what you WANT, not what to avoid

Optimal prompt length: 100-300 words (yours: ~${request.description.split(" ").length} words input → expanded)

Lighting has HIGH impact on this model - consider specifying lighting style.

Text rendering: Z-Image excels at text! Put text in "quotes" and describe placement.

Recommended settings:
- Steps: 8 (turbo optimized)
- CFG: 1.0 (fixed, ignored anyway)
- Sampler: euler with simple scheduler
- Resolution: divisible by 32 (768x1024 portrait, 1024x768 landscape)`;
  }

  private generateVariations(
    request: PromptRequest,
    basePrompt: string
  ): string[] {
    const variations: string[] = [];

    // Variation 1: More cinematic lighting
    variations.push(
      `${basePrompt} Cinematic lighting with dramatic shadows and volumetric rays creating depth and atmosphere.`
    );

    // Variation 2: Different artistic approach
    variations.push(
      `${basePrompt} Rendered with exceptional attention to fine details, textures visible, photorealistic quality.`
    );

    return variations;
  }

  /**
   * Override getDimensions for Z-Image optimal resolutions
   */
  protected getDimensions(
    aspectRatio?: "portrait" | "landscape" | "square" | "wide" | "tall"
  ): { width: number; height: number } {
    // Z-Image works best with dimensions divisible by 32
    const dimensionMap: Record<string, { width: number; height: number }> = {
      portrait: { width: 768, height: 1024 },
      landscape: { width: 1024, height: 768 },
      square: { width: 1024, height: 1024 },
      wide: { width: 1216, height: 832 },
      tall: { width: 832, height: 1216 },
    };

    return dimensionMap[aspectRatio || "portrait"];
  }
}
