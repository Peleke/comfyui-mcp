/**
 * Architecture plugin system types
 *
 * This module defines the core types for the architecture-aware backend system.
 * Each architecture (SD1.5, SDXL, Flux, etc.) can register itself with the system
 * to provide detection patterns, defaults, and model mappings.
 */

/**
 * Supported architecture identifiers
 */
export type ArchitectureId = "sd15" | "sdxl" | "flux" | "sd3" | "pony" | "illustrious" | "z_image_turbo";

/**
 * ControlNet types supported by the system
 */
export type ControlNetType =
  | "canny"
  | "depth"
  | "openpose"
  | "qrcode"
  | "scribble"
  | "lineart"
  | "semantic_seg";

/**
 * Default generation parameters for an architecture
 */
export interface ArchitectureDefaults {
  /** Default image width in pixels */
  width: number;
  /** Default image height in pixels */
  height: number;
  /** Default number of sampling steps */
  steps: number;
  /** Default CFG scale */
  cfgScale: number;
  /** Default sampler name */
  sampler: string;
  /** Default scheduler name */
  scheduler: string;
}

/**
 * IP-Adapter model configuration for an architecture
 */
export interface IPAdapterConfig {
  /** IP-Adapter model filename */
  model: string;
  /** CLIP Vision model filename */
  clipVision: string;
}

/**
 * Architecture definition
 *
 * Defines everything needed to work with a particular model architecture:
 * - Detection patterns and priority
 * - Capabilities (what features are supported)
 * - Default generation parameters
 * - Model mappings for ControlNet, IP-Adapter, etc.
 */
export interface ModelArchitecture {
  /** Unique identifier for this architecture */
  id: ArchitectureId;

  /** Human-readable display name */
  displayName: string;

  // --- Detection ---

  /** Regex patterns to match checkpoint filenames */
  patterns: RegExp[];

  /**
   * Priority for detection (higher = matched first)
   * Use 100 for most specific patterns, down to 40 for fallbacks
   */
  priority: number;

  // --- Capabilities ---

  /** Whether this architecture supports negative prompts */
  supportsNegativePrompt: boolean;

  /** Whether this architecture supports (emphasis:1.2) weight syntax */
  supportsWeightSyntax: boolean;

  /** Whether ControlNet models exist for this architecture */
  supportsControlNet: boolean;

  /** Whether IP-Adapter models exist for this architecture */
  supportsIPAdapter: boolean;

  // --- Defaults ---

  /** Default generation parameters */
  defaults: ArchitectureDefaults;

  // --- Model Mappings (optional) ---

  /**
   * ControlNet model filenames for each control type
   * Only present if supportsControlNet is true
   */
  controlNetModels?: Partial<Record<ControlNetType, string>>;

  /**
   * IP-Adapter configuration
   * Only present if supportsIPAdapter is true
   */
  ipadapterConfig?: IPAdapterConfig;
}

/**
 * Result of architecture detection
 */
export interface ArchitectureDetection {
  /** The detected architecture */
  architecture: ModelArchitecture;
  /** Confidence score (0-1) based on pattern priority */
  confidence: number;
  /** Human-readable explanation of why this was matched */
  reason: string;
}
