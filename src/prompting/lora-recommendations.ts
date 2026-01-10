import { StylePreset, LoraRecommendation, ModelFamily } from "./types.js";

/**
 * Common LoRA patterns and their triggers for different styles
 */
interface LoraPattern {
  namePatterns: string[];
  triggerWords: string[];
  styles: StylePreset[];
  description: string;
  defaultStrength: { model: number; clip: number };
}

const LORA_PATTERNS: LoraPattern[] = [
  // Detail/Quality enhancers
  {
    namePatterns: ["detail", "add_detail", "more_detail"],
    triggerWords: [],
    styles: ["realistic_photo", "portrait", "cinematic"],
    description: "Enhances fine details in the image",
    defaultStrength: { model: 0.5, clip: 0.5 },
  },
  // Anime styles
  {
    namePatterns: ["anime", "flat2d", "flat_color"],
    triggerWords: [],
    styles: ["anime", "comic"],
    description: "Enhances anime/2D art style",
    defaultStrength: { model: 0.7, clip: 0.7 },
  },
  // Lighting
  {
    namePatterns: ["lighting", "cinematic_light", "dramatic"],
    triggerWords: [],
    styles: ["cinematic", "portrait", "realistic_photo"],
    description: "Improves lighting quality",
    defaultStrength: { model: 0.6, clip: 0.6 },
  },
  // Film/Analog
  {
    namePatterns: ["film", "analog", "kodak", "fuji", "grain"],
    triggerWords: ["film grain", "analog photo"],
    styles: ["cinematic", "realistic_photo"],
    description: "Adds film/analog photo aesthetic",
    defaultStrength: { model: 0.5, clip: 0.5 },
  },
  // Concept art
  {
    namePatterns: ["concept", "artstation"],
    triggerWords: [],
    styles: ["concept_art", "fantasy", "sci_fi"],
    description: "Professional concept art style",
    defaultStrength: { model: 0.7, clip: 0.7 },
  },
  // Watercolor
  {
    namePatterns: ["watercolor", "aquarelle"],
    triggerWords: ["watercolor"],
    styles: ["watercolor"],
    description: "Watercolor painting effect",
    defaultStrength: { model: 0.8, clip: 0.8 },
  },
  // Pixel art
  {
    namePatterns: ["pixel", "16bit", "8bit"],
    triggerWords: ["pixel art"],
    styles: ["pixel_art"],
    description: "Pixel art style",
    defaultStrength: { model: 0.9, clip: 0.9 },
  },
  // Oil painting
  {
    namePatterns: ["oil", "impasto", "painting"],
    triggerWords: ["oil painting"],
    styles: ["oil_painting"],
    description: "Traditional oil painting style",
    defaultStrength: { model: 0.7, clip: 0.7 },
  },
];

/**
 * Get LoRA recommendations based on style and available LoRAs
 */
export function getLoraRecommendations(
  style: StylePreset | undefined,
  availableLoras: string[],
  modelFamily: ModelFamily
): { recommendations: LoraRecommendation[]; triggerWords: string[] } {
  if (!style || availableLoras.length === 0) {
    return { recommendations: [], triggerWords: [] };
  }

  const recommendations: LoraRecommendation[] = [];
  const triggerWords: string[] = [];

  for (const pattern of LORA_PATTERNS) {
    // Check if this pattern applies to the requested style
    if (!pattern.styles.includes(style)) {
      continue;
    }

    // Find matching LoRAs in the available list
    for (const loraName of availableLoras) {
      const loraLower = loraName.toLowerCase();
      const matches = pattern.namePatterns.some((p) => loraLower.includes(p));

      if (matches) {
        recommendations.push({
          namePattern: loraName,
          reason: pattern.description,
          strengthModel: pattern.defaultStrength.model,
          strengthClip: pattern.defaultStrength.clip,
          priority: recommendations.length === 0 ? "recommended" : "optional",
        });

        // Add trigger words if any
        triggerWords.push(...pattern.triggerWords);
        break; // Only add one LoRA per pattern category
      }
    }
  }

  // Dedupe trigger words
  const uniqueTriggers = [...new Set(triggerWords)];

  return {
    recommendations: recommendations.slice(0, 3), // Max 3 recommendations
    triggerWords: uniqueTriggers,
  };
}

/**
 * Match available LoRAs against a user's style request
 */
export function findMatchingLoras(
  query: string,
  availableLoras: string[]
): string[] {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/);

  return availableLoras.filter((lora) => {
    const loraLower = lora.toLowerCase();
    // Check if any query word matches the lora name
    return queryWords.some(
      (word) => word.length > 2 && loraLower.includes(word)
    );
  });
}
