/**
 * Flux Architecture Plugin
 *
 * Flux is a next-generation architecture with:
 * - Natural language prompting (no tags needed)
 * - No negative prompts (uses guidance scale instead)
 * - No weight syntax
 * - Different workflow structure (DiT-based)
 *
 * Variants:
 * - flux1-schnell: Fast, 4 steps
 * - flux1-dev: Quality, 20-50 steps
 */

import type { ModelArchitecture } from "../types.js";

export const fluxArchitecture: ModelArchitecture = {
  id: "flux",
  displayName: "Flux",

  // Detection patterns - highest priority
  patterns: [
    /flux/i,
    /schnell/i,   // flux1-schnell
  ],
  priority: 100,

  // Capabilities - Flux is different!
  supportsNegativePrompt: false,  // Uses guidance instead
  supportsWeightSyntax: false,    // Natural language only
  supportsControlNet: false,      // No Flux ControlNets yet (as of 2024)
  supportsIPAdapter: false,       // No Flux IP-Adapters yet

  // Defaults - Flux uses very different settings
  defaults: {
    width: 1024,
    height: 1024,
    steps: 4,           // schnell default, dev would be 20-50
    cfgScale: 1,        // Flux uses guidance differently
    sampler: "euler",
    scheduler: "simple",
  },

  // No ControlNet models for Flux yet
  controlNetModels: undefined,

  // No IP-Adapter for Flux yet
  ipadapterConfig: undefined,
};
