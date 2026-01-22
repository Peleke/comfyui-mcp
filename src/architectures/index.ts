/**
 * Architecture Plugin System
 *
 * This module provides a unified way to work with different model architectures
 * (SD1.5, SDXL, Flux, etc.). Each architecture defines:
 *
 * - Detection patterns (how to identify checkpoints)
 * - Capabilities (negative prompts, ControlNet support, etc.)
 * - Defaults (resolution, steps, CFG, etc.)
 * - Model mappings (ControlNet models, IP-Adapter models, etc.)
 *
 * ## Adding a New Architecture
 *
 * 1. Create a new file in `src/architectures/plugins/` (e.g., `sd3.ts`)
 * 2. Export a `ModelArchitecture` object (e.g., `sd3Architecture`)
 * 3. Import and register it in this file
 *
 * Example:
 * ```typescript
 * // src/architectures/plugins/sd3.ts
 * export const sd3Architecture: ModelArchitecture = {
 *   id: "sd3",
 *   displayName: "Stable Diffusion 3.5",
 *   patterns: [/sd3/i, /stable.*diffusion.*3/i],
 *   priority: 95,
 *   supportsNegativePrompt: true,
 *   supportsWeightSyntax: true,
 *   supportsControlNet: false,  // None available yet
 *   supportsIPAdapter: false,
 *   defaults: { width: 1024, height: 1024, steps: 28, cfgScale: 4.5, sampler: "euler", scheduler: "normal" },
 * };
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import { architectures } from "./architectures";
 *
 * // Detect architecture from checkpoint name
 * const { architecture, confidence, reason } = architectures.detect("novaFurryXL_v1.safetensors");
 * console.log(architecture.id); // "pony"
 *
 * // Get ControlNet model for a checkpoint
 * const cannyModel = architectures.getControlNetModel("novaFurryXL_v1.safetensors", "canny");
 * // → "controlnet-canny-sdxl-1.0.safetensors"
 *
 * // Get defaults for a checkpoint
 * const defaults = architectures.getDefaults("flux1-schnell.safetensors");
 * // → { width: 1024, height: 1024, steps: 4, cfgScale: 1, ... }
 *
 * // Check capabilities
 * architectures.supportsNegativePrompt("flux1-schnell.safetensors"); // false
 * architectures.supportsNegativePrompt("novaFurryXL_v1.safetensors"); // true
 * ```
 */

// Re-export types
export type {
  ArchitectureId,
  ControlNetType,
  ModelArchitecture,
  ArchitectureDetection,
  ArchitectureDefaults,
  IPAdapterConfig,
} from "./types.js";

// Export registry class and singleton
export { ArchitectureRegistry, architectureRegistry } from "./registry.js";

// Import all architecture plugins
import { sd15Architecture } from "./plugins/sd15.js";
import { sdxlArchitecture } from "./plugins/sdxl.js";
import { ponyArchitecture } from "./plugins/pony.js";
import { illustriousArchitecture } from "./plugins/illustrious.js";
import { fluxArchitecture } from "./plugins/flux.js";
import { zTurboArchitecture } from "./plugins/z-turbo.js";

// Import the registry
import { architectureRegistry } from "./registry.js";

// Register all architectures
// Order doesn't matter - they're sorted by priority internally
architectureRegistry.register(sd15Architecture);
architectureRegistry.register(sdxlArchitecture);
architectureRegistry.register(ponyArchitecture);
architectureRegistry.register(illustriousArchitecture);
architectureRegistry.register(fluxArchitecture);
architectureRegistry.register(zTurboArchitecture);

// Export the singleton as the default way to access architectures
export const architectures = architectureRegistry;

// Also export individual architecture definitions for direct access
export {
  sd15Architecture,
  sdxlArchitecture,
  ponyArchitecture,
  illustriousArchitecture,
  fluxArchitecture,
  zTurboArchitecture,
};
