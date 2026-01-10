import { PromptStrategy } from "./base.js";
import {
  ModelFamily,
  PromptRequest,
  GeneratedPrompt,
  StylePreset,
} from "../types.js";

/**
 * Prompt strategy for Flux models
 *
 * Key characteristics:
 * - Natural language prompts (NOT tag-based)
 * - Subject + Action + Style + Context structure
 * - NO negative prompts (describe what you want, not what to avoid)
 * - Word order matters - most important first
 * - Can include text in images
 */
export class FluxStrategy extends PromptStrategy {
  readonly family: ModelFamily = "flux";
  readonly name = "Flux";

  generate(request: PromptRequest): GeneratedPrompt {
    const sections: string[] = [];

    // Build prompt following Subject + Action + Style + Context

    // 1. SUBJECT - Main focus with key details
    const subject = this.buildSubjectSection(request.description);
    sections.push(subject);

    // 2. STYLE - Artistic approach
    const style = this.buildStyleSection(request);
    if (style) {
      sections.push(style);
    }

    // 3. CONTEXT - Setting, atmosphere
    const context = this.buildContextSection(request);
    if (context) {
      sections.push(context);
    }

    // 4. TECHNICAL - Camera settings for photo-style
    const technical = this.buildTechnicalSection(request);
    if (technical) {
      sections.push(technical);
    }

    const positive = sections.join(". ");
    const dimensions = this.getDimensions(request.aspectRatio);

    return {
      positive,
      negative: "", // Flux doesn't use negative prompts!
      modelFamily: this.family,
      recommendedSettings: {
        steps: 20,
        cfgScale: 3.5, // Flux uses lower CFG
        sampler: "euler",
        scheduler: "normal",
        ...dimensions,
      },
      explanation: this.buildExplanation(request),
      variations: this.generateVariations(request, sections),
    };
  }

  protected applyEmphasis(keyword: string, _strength: number = 1.1): string {
    // Flux doesn't support weight syntax - use descriptive emphasis instead
    return keyword;
  }

  /**
   * Build the subject section - the main focus
   */
  private buildSubjectSection(description: string): string {
    // For Flux, we keep natural language but ensure clarity
    // Clean up and capitalize appropriately
    let subject = description.trim();

    // Remove any tag-style formatting
    subject = subject.replace(/,\s*/g, ", ");

    // Ensure it starts with a capital letter
    if (subject.length > 0) {
      subject = subject.charAt(0).toUpperCase() + subject.slice(1);
    }

    return subject;
  }

  /**
   * Build the style section
   */
  private buildStyleSection(request: PromptRequest): string | null {
    const styleParts: string[] = [];

    if (request.style) {
      const styleDescriptions: Partial<Record<StylePreset, string>> = {
        anime: "anime art style with vibrant colors",
        realistic_photo: "professional photography",
        digital_art: "digital illustration with clean lines",
        oil_painting: "classical oil painting technique",
        watercolor: "delicate watercolor painting",
        sketch: "detailed pencil sketch",
        "3d_render": "high-quality 3D render, octane",
        pixel_art: "retro pixel art style",
        comic: "comic book illustration style",
        cinematic: "cinematic film still with dramatic lighting",
        fantasy: "fantasy illustration with magical atmosphere",
        sci_fi: "science fiction concept art",
        portrait: "professional portrait photography",
        landscape: "landscape photography",
        concept_art: "detailed concept art illustration",
      };
      const styleDesc = styleDescriptions[request.style];
      if (styleDesc) {
        styleParts.push(styleDesc);
      }
    }

    if (request.styleKeywords && request.styleKeywords.length > 0) {
      styleParts.push(request.styleKeywords.join(", "));
    }

    return styleParts.length > 0 ? styleParts.join(", ") : null;
  }

  /**
   * Build the context section - atmosphere, setting
   */
  private buildContextSection(request: PromptRequest): string | null {
    const contextParts: string[] = [];

    if (request.camera?.lighting) {
      // Convert to natural language
      const lightingDescriptions: Record<string, string> = {
        "golden hour": "bathed in warm golden hour sunlight",
        "blue hour": "in the soft blue light of dusk",
        "studio lighting": "with professional studio lighting",
        "natural light": "illuminated by natural light",
        "dramatic lighting": "with dramatic, high-contrast lighting",
        "soft lighting": "with soft, diffused lighting",
        "backlit": "beautifully backlit",
        "rim lighting": "with rim lighting creating a glow",
      };
      const lightingDesc =
        lightingDescriptions[request.camera.lighting.toLowerCase()] ||
        `with ${request.camera.lighting}`;
      contextParts.push(lightingDesc);
    }

    if (request.emphasize && request.emphasize.length > 0) {
      // For Flux, describe emphasis naturally
      contextParts.push(
        `focusing on ${request.emphasize.join(" and ")}`
      );
    }

    return contextParts.length > 0 ? contextParts.join(", ") : null;
  }

  /**
   * Build technical section for photography-style prompts
   */
  private buildTechnicalSection(request: PromptRequest): string | null {
    if (!request.camera) return null;

    const techParts: string[] = [];

    if (request.camera.focalLength) {
      techParts.push(`shot with ${request.camera.focalLength} lens`);
    }

    if (request.camera.aperture) {
      const aperture = request.camera.aperture;
      const apertureNum = parseFloat(aperture.replace("f/", ""));
      if (apertureNum <= 2.8) {
        techParts.push("with creamy bokeh background blur");
      } else if (apertureNum >= 8) {
        techParts.push("with sharp focus throughout");
      }
    }

    if (request.camera.angle) {
      const angleDescriptions: Record<string, string> = {
        "low angle": "shot from a low angle looking up",
        "high angle": "shot from above looking down",
        "bird's eye": "aerial bird's eye view",
        "eye level": "at eye level",
        "dutch angle": "with a dynamic tilted angle",
        "close-up": "in an intimate close-up",
        "wide shot": "captured in a wide establishing shot",
      };
      const angleDesc =
        angleDescriptions[request.camera.angle.toLowerCase()] ||
        `from ${request.camera.angle}`;
      techParts.push(angleDesc);
    }

    return techParts.length > 0 ? techParts.join(", ") : null;
  }

  private buildExplanation(request: PromptRequest): string {
    return `Flux prompt structure (Subject + Action + Style + Context):

IMPORTANT: Flux does NOT use negative prompts!
Instead of saying what to avoid, describe what you want.
- Instead of "no blur" → use "sharp, clear focus"
- Instead of "no crowds" → use "peaceful solitude"

Word order matters - most important elements come first.

Flux can render TEXT in images - put text in "quotation marks" and describe placement.

Recommended settings: CFG 3-4, 20 steps, Euler sampler`;
  }

  private generateVariations(
    request: PromptRequest,
    baseSections: string[]
  ): string[] {
    const variations: string[] = [];

    // Variation 1: More cinematic
    const cinematic = [...baseSections, "cinematic composition, dramatic atmosphere"];
    variations.push(cinematic.join(". "));

    // Variation 2: More detailed/technical
    const detailed = [
      ...baseSections,
      "intricate details, high resolution, professional quality",
    ];
    variations.push(detailed.join(". "));

    return variations;
  }
}
