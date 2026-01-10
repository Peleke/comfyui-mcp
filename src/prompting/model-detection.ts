import { ModelFamily, ModelDetection } from "./types.js";

/**
 * Patterns for detecting model families from model names
 */
const MODEL_PATTERNS: Array<{
  family: ModelFamily;
  patterns: RegExp[];
  priority: number;
}> = [
  {
    family: "flux",
    patterns: [/flux/i, /schnell/i],
    priority: 100,
  },
  {
    family: "pony",
    patterns: [
      /pony/i,
      /pdxl/i,
      /score_/i,
      /furry/i,
      /yiff/i,
    ],
    priority: 90,
  },
  {
    family: "illustrious",
    patterns: [
      /illustrious/i,
      /noob/i,
      /wai.*xl/i,
      /anime.*xl/i,
      /novelai/i,
    ],
    priority: 85,
  },
  {
    family: "realistic",
    patterns: [
      /realistic/i,
      /photo/i,
      /cyberrealistic/i,
      /deliberate/i,
      /dreamshaper/i,
      /epikrealism/i,
      /juggernaut/i,
    ],
    priority: 80,
  },
  {
    family: "sdxl",
    patterns: [
      /sdxl/i,
      /sd.*xl/i,
      /xl.*base/i,
      /xl.*refiner/i,
    ],
    priority: 50,
  },
  {
    family: "sd15",
    patterns: [
      /v1-5/i,
      /sd.*1\.5/i,
      /sd15/i,
      /1\.5.*pruned/i,
    ],
    priority: 40,
  },
];

/**
 * Detect the model family from a model name
 */
export function detectModelFamily(modelName: string): ModelDetection {
  if (!modelName) {
    return {
      family: "sdxl",
      confidence: 0.3,
      reason: "No model name provided, defaulting to SDXL",
    };
  }

  const normalizedName = modelName.toLowerCase();

  // Sort by priority (highest first)
  const sortedPatterns = [...MODEL_PATTERNS].sort(
    (a, b) => b.priority - a.priority
  );

  for (const { family, patterns, priority } of sortedPatterns) {
    for (const pattern of patterns) {
      if (pattern.test(normalizedName)) {
        return {
          family,
          confidence: priority / 100,
          reason: `Matched pattern ${pattern} in model name "${modelName}"`,
        };
      }
    }
  }

  // Default fallback based on common naming conventions
  if (normalizedName.includes("xl") || normalizedName.includes("1024")) {
    return {
      family: "sdxl",
      confidence: 0.5,
      reason: "Detected XL-sized model, assuming SDXL family",
    };
  }

  return {
    family: "sdxl",
    confidence: 0.3,
    reason: "Unknown model, defaulting to SDXL (most common)",
  };
}

/**
 * Get the family-specific prompting strategy name
 */
export function getStrategyName(family: ModelFamily): string {
  const names: Record<ModelFamily, string> = {
    illustrious: "Illustrious XL (Tag-based with quality boosters)",
    pony: "Pony Diffusion (Score tags + source tags)",
    sdxl: "SDXL (Natural language, descriptive)",
    flux: "Flux (Natural language, no negatives)",
    sd15: "SD 1.5 (Tag-based, comma-separated)",
    realistic: "Realistic/Photo (Camera terms, technical)",
  };
  return names[family];
}
