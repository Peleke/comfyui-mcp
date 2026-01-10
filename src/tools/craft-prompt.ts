import { z } from "zod";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  PromptGenerator,
  PromptRequest,
  GeneratedPrompt,
  ModelFamily,
  StylePreset,
  ContentRating,
} from "../prompting/index.js";

// Schema for the craft_prompt tool input
export const craftPromptSchema = z.object({
  description: z
    .string()
    .describe("Natural language description of what you want to generate"),
  model_name: z
    .string()
    .optional()
    .describe("Model name for auto-detection of prompting strategy"),
  model_family: z
    .enum(["illustrious", "pony", "sdxl", "flux", "sd15", "realistic"])
    .optional()
    .describe("Explicit model family (overrides auto-detection)"),
  style: z
    .enum([
      "anime",
      "realistic_photo",
      "digital_art",
      "oil_painting",
      "watercolor",
      "sketch",
      "3d_render",
      "pixel_art",
      "comic",
      "cinematic",
      "fantasy",
      "sci_fi",
      "portrait",
      "landscape",
      "concept_art",
    ])
    .optional()
    .describe("Style preset to apply"),
  rating: z
    .enum(["safe", "suggestive", "explicit"])
    .optional()
    .default("safe")
    .describe("Content rating"),
  aspect_ratio: z
    .enum(["portrait", "landscape", "square", "wide", "tall"])
    .optional()
    .describe("Desired aspect ratio"),
  camera_focal_length: z
    .string()
    .optional()
    .describe("Camera focal length (e.g., '85mm', '35mm')"),
  camera_aperture: z
    .string()
    .optional()
    .describe("Camera aperture (e.g., 'f/1.4', 'f/8')"),
  camera_lighting: z
    .string()
    .optional()
    .describe("Lighting style (e.g., 'golden hour', 'studio lighting')"),
  camera_angle: z
    .string()
    .optional()
    .describe("Camera angle (e.g., 'low angle', 'bird\\'s eye')"),
  style_keywords: z
    .array(z.string())
    .optional()
    .describe("Additional style keywords to include"),
  emphasize: z
    .array(z.string())
    .optional()
    .describe("Elements to emphasize (will be weighted)"),
  include_lora_recommendations: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to include LoRA recommendations"),
});

export type CraftPromptInput = z.infer<typeof craftPromptSchema>;

/**
 * Craft an optimized prompt based on user description and target model
 */
export async function craftPrompt(
  client: ComfyUIClient,
  input: CraftPromptInput
): Promise<GeneratedPrompt> {
  const generator = new PromptGenerator();

  // Get available LoRAs if requested
  if (input.include_lora_recommendations) {
    try {
      const objectInfo = await client.getObjectInfo();
      const loraLoader = objectInfo["LoraLoader"];
      if (loraLoader?.input?.required?.lora_name?.[0]) {
        generator.setAvailableLoras(loraLoader.input.required.lora_name[0]);
      }
    } catch {
      // If we can't get LoRAs, continue without recommendations
    }
  }

  // Build the prompt request
  const request: PromptRequest = {
    description: input.description,
    modelFamily: input.model_family as ModelFamily | undefined,
    modelName: input.model_name,
    style: input.style as StylePreset | undefined,
    rating: input.rating as ContentRating | undefined,
    aspectRatio: input.aspect_ratio,
    styleKeywords: input.style_keywords,
    emphasize: input.emphasize,
  };

  // Add camera settings if any provided
  if (
    input.camera_focal_length ||
    input.camera_aperture ||
    input.camera_lighting ||
    input.camera_angle
  ) {
    request.camera = {
      focalLength: input.camera_focal_length,
      aperture: input.camera_aperture,
      lighting: input.camera_lighting,
      angle: input.camera_angle,
    };
  }

  // Generate the optimized prompt
  return generator.generate(request);
}

/**
 * Get information about a specific model family's prompting strategy
 */
export function getPromptingGuide(modelFamily: ModelFamily): {
  name: string;
  tips: string[];
  examplePrompt: string;
} {
  const generator = new PromptGenerator();
  return generator.getStrategyInfo(modelFamily);
}

/**
 * List all supported model families
 */
export function listPromptingStrategies(): ModelFamily[] {
  const generator = new PromptGenerator();
  return generator.getSupportedFamilies();
}
