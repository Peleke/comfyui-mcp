import { ModelFamily, ModelDetection } from "./types.js";
import { architectures, type ArchitectureId } from "../architectures/index.js";

/**
 * Map architecture IDs to model families for prompting.
 *
 * Architecture = technical capabilities (ControlNet, resolution, etc.)
 * Model Family = prompting style (how to write prompts)
 *
 * Most architectures map 1:1, but we have additional prompting families
 * like "realistic" that are prompting styles on top of SDXL architecture.
 */
const ARCHITECTURE_TO_FAMILY: Record<ArchitectureId, ModelFamily> = {
  sd15: "sd15",
  sdxl: "sdxl",
  flux: "flux",
  sd3: "sdxl",  // SD3 uses similar prompting to SDXL for now
  pony: "pony",
  illustrious: "illustrious",
};

/**
 * Additional prompting-specific patterns not covered by architecture detection.
 * These override the architecture-based family when matched.
 *
 * "realistic" is a prompting style on SDXL architecture that uses
 * camera/photography terminology.
 */
const PROMPTING_OVERRIDES: Array<{
  family: ModelFamily;
  patterns: RegExp[];
  priority: number;
}> = [
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
];

/**
 * Detect the model family from a model name.
 *
 * This function is used by the prompting system to determine which
 * prompting strategy to use. It combines architecture detection with
 * prompting-specific overrides.
 *
 * For technical architecture detection (ControlNet, IP-Adapter, etc.),
 * use the `architectures` registry directly instead.
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

  // First check prompting-specific overrides (like "realistic")
  for (const { family, patterns, priority } of PROMPTING_OVERRIDES) {
    for (const pattern of patterns) {
      if (pattern.test(normalizedName)) {
        return {
          family,
          confidence: priority / 100,
          reason: `Matched prompting pattern ${pattern} in model name "${modelName}"`,
        };
      }
    }
  }

  // Fall back to architecture-based detection
  const detection = architectures.detect(modelName);
  const family = ARCHITECTURE_TO_FAMILY[detection.architecture.id] ?? "sdxl";

  return {
    family,
    confidence: detection.confidence,
    reason: detection.reason,
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
