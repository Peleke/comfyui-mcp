import {
  ModelFamily,
  PromptRequest,
  GeneratedPrompt,
  WorkflowPipeline,
} from "./types.js";
import { detectModelFamily, getStrategyName } from "./model-detection.js";
import { getLoraRecommendations } from "./lora-recommendations.js";
import { PromptStrategy } from "./strategies/base.js";
import { IllustriousStrategy } from "./strategies/illustrious.js";
import { PonyStrategy } from "./strategies/pony.js";
import { FluxStrategy } from "./strategies/flux.js";
import { SDXLStrategy } from "./strategies/sdxl.js";
import { RealisticStrategy } from "./strategies/realistic.js";
import { SD15Strategy } from "./strategies/sd15.js";

/**
 * Main prompt generator that orchestrates strategy selection and prompt creation
 */
export class PromptGenerator {
  private strategies: Map<ModelFamily, PromptStrategy>;
  private availableLoras: string[] = [];

  constructor() {
    // Initialize all strategies
    this.strategies = new Map();
    this.strategies.set("illustrious", new IllustriousStrategy());
    this.strategies.set("pony", new PonyStrategy());
    this.strategies.set("flux", new FluxStrategy());
    this.strategies.set("sdxl", new SDXLStrategy());
    this.strategies.set("realistic", new RealisticStrategy());
    this.strategies.set("sd15", new SD15Strategy());
  }

  /**
   * Set available LoRAs for recommendations
   */
  setAvailableLoras(loras: string[]): void {
    this.availableLoras = loras;
  }

  /**
   * Generate an optimized prompt based on the request
   */
  generate(request: PromptRequest): GeneratedPrompt {
    // 1. Detect or use specified model family
    let modelFamily = request.modelFamily;
    let detectionNote = "";

    if (!modelFamily && request.modelName) {
      const detection = detectModelFamily(request.modelName);
      modelFamily = detection.family;
      detectionNote = `\n\nModel detected: ${getStrategyName(detection.family)} (${Math.round(detection.confidence * 100)}% confidence)\nReason: ${detection.reason}`;
    }

    // Default to SDXL if nothing specified
    if (!modelFamily) {
      modelFamily = "sdxl";
      detectionNote = "\n\nNo model specified, using SDXL strategy (most common)";
    }

    // 2. Get the appropriate strategy
    const strategy = this.strategies.get(modelFamily);
    if (!strategy) {
      throw new Error(`No strategy found for model family: ${modelFamily}`);
    }

    // 3. Generate the prompt
    const result = strategy.generate(request);

    // 4. Add LoRA recommendations if we have available LoRAs
    if (this.availableLoras.length > 0) {
      const loraRecs = getLoraRecommendations(
        request.style,
        this.availableLoras,
        modelFamily
      );
      result.recommendedLoras = loraRecs.recommendations;
      result.loraTriggerWords = loraRecs.triggerWords;

      // Add trigger words to the prompt if we have LoRA recommendations
      if (loraRecs.triggerWords.length > 0) {
        const triggerSection = loraRecs.triggerWords.join(", ");
        // Add to positive prompt (at the end for tag-based, integrated for natural language)
        if (modelFamily === "flux" || modelFamily === "sdxl") {
          result.positive = `${result.positive}. ${triggerSection}`;
        } else {
          result.positive = `${result.positive}, ${triggerSection}`;
        }
      }
    }

    // 5. Add pipeline suggestion for high-quality outputs
    result.suggestedPipeline = this.suggestPipeline(request, modelFamily);

    // 6. Append detection note to explanation
    result.explanation += detectionNote;

    return result;
  }

  /**
   * Suggest a workflow pipeline based on the request
   */
  private suggestPipeline(
    request: PromptRequest,
    modelFamily: ModelFamily
  ): WorkflowPipeline | undefined {
    // Determine if we should suggest hi-res fix + upscale pipeline
    const wantsHighQuality =
      request.style === "realistic_photo" ||
      request.style === "portrait" ||
      request.style === "cinematic";

    const wantsLargeOutput =
      request.aspectRatio === "wide" || request.aspectRatio === "tall";

    if (wantsHighQuality) {
      return {
        name: "Hi-Res Quality Pipeline",
        description:
          "Generate at base resolution, then upscale with img2img hi-res fix for maximum detail",
        steps: [
          {
            type: "txt2img",
            name: "Initial Generation",
            settings: {
              // Generate at lower res first
              width: 768,
              height: 1024,
            },
          },
          {
            type: "img2img",
            name: "Hi-Res Fix",
            settings: {
              denoise: 0.4, // Low denoise to preserve composition
              steps: 20,
              width: 1536,
              height: 2048,
            },
          },
          {
            type: "upscale",
            name: "Final Upscale",
            settings: {
              upscaleModel: "RealESRGAN_x4plus.pth",
            },
          },
        ],
      };
    }

    if (wantsLargeOutput) {
      return {
        name: "Large Format Pipeline",
        description: "Generate at optimal resolution then upscale",
        steps: [
          {
            type: "txt2img",
            name: "Initial Generation",
          },
          {
            type: "upscale",
            name: "Upscale",
            settings: {
              upscaleModel: "RealESRGAN_x4plus.pth",
            },
          },
        ],
      };
    }

    // Default: single step
    return undefined;
  }

  /**
   * Get information about a model family's prompting strategy
   */
  getStrategyInfo(modelFamily: ModelFamily): {
    name: string;
    tips: string[];
    examplePrompt: string;
  } {
    const infos: Record<
      ModelFamily,
      { name: string; tips: string[]; examplePrompt: string }
    > = {
      illustrious: {
        name: "Illustrious XL",
        tips: [
          "Use tag-based prompts (comma-separated)",
          "Quality tags at the start: masterpiece, best quality, absurdres, newest",
          "Extensive negative prompt required",
          "CFG 4.5-7.5, Euler A, 20+ steps",
        ],
        examplePrompt:
          "masterpiece, best quality, absurdres, newest, 1girl, silver hair, blue eyes, detailed face, school uniform, classroom, soft lighting",
      },
      pony: {
        name: "Pony Diffusion",
        tips: [
          "Score tags REQUIRED: score_9, score_8_up, score_7_up...",
          "Source tags: source_anime, source_furry, source_cartoon",
          "Rating tags: rating_safe, rating_questionable, rating_explicit",
          "CLIP skip -2 recommended",
        ],
        examplePrompt:
          "score_9, score_8_up, score_7_up, score_6_up, source_anime, rating_safe, 1girl, detailed face, forest background, soft lighting",
      },
      flux: {
        name: "Flux",
        tips: [
          "Natural language, descriptive prompts",
          "NO negative prompts (describe what you want)",
          "Subject + Action + Style + Context structure",
          "Can render TEXT in images",
          "CFG 3-4, low guidance works best",
        ],
        examplePrompt:
          "A young woman with silver hair and blue eyes, wearing a school uniform, standing in a sunlit classroom. Professional photography, soft natural lighting, shallow depth of field",
      },
      sdxl: {
        name: "SDXL",
        tips: [
          "Descriptive natural language works best",
          "Subject → Action → Location → Aesthetic",
          "Minimal negative prompts needed",
          "Weights sensitive (stay under 1.4)",
          "DPM++ 2M Karras recommended",
        ],
        examplePrompt:
          "A portrait of a young woman with silver hair and blue eyes, wearing a school uniform, soft natural lighting, detailed, professional photography, 8K",
      },
      realistic: {
        name: "Realistic/Photo",
        tips: [
          "Camera terminology is important (lens, aperture)",
          "Lighting descriptions critical",
          "Texture keywords help (detailed skin, fabric)",
          "RAW photo, professional photography markers",
        ],
        examplePrompt:
          "RAW photo, professional photography, portrait of a young woman, silver hair, blue eyes, shot on 85mm f/1.4, shallow depth of field, golden hour lighting, detailed skin texture",
      },
      sd15: {
        name: "SD 1.5",
        tips: [
          "Tag-based, comma-separated",
          "Quality tags important",
          "EXTENSIVE negative prompt required",
          "512x512 base resolution",
        ],
        examplePrompt:
          "masterpiece, best quality, high resolution, detailed, 1girl, silver hair, blue eyes, school uniform, classroom, soft lighting",
      },
    };

    return infos[modelFamily];
  }

  /**
   * List all supported model families
   */
  getSupportedFamilies(): ModelFamily[] {
    return Array.from(this.strategies.keys());
  }
}

// Export singleton instance
export const promptGenerator = new PromptGenerator();
