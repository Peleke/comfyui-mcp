/**
 * Architecture Registry
 *
 * Central registry for all model architectures. Provides:
 * - Architecture registration
 * - Detection from checkpoint names
 * - Capability queries
 * - Model lookups (ControlNet, IP-Adapter, etc.)
 */

import type {
  ArchitectureId,
  ModelArchitecture,
  ArchitectureDetection,
  ControlNetType,
  IPAdapterConfig,
  ArchitectureDefaults,
} from "./types.js";

/**
 * The Architecture Registry manages all registered model architectures
 * and provides unified access to detection and model lookups.
 */
export class ArchitectureRegistry {
  private architectures: Map<ArchitectureId, ModelArchitecture> = new Map();
  private sortedArchitectures: ModelArchitecture[] = [];

  /**
   * Register a new architecture
   * @param arch The architecture definition to register
   */
  register(arch: ModelArchitecture): void {
    this.architectures.set(arch.id, arch);
    this.rebuildSortedList();
  }

  /**
   * Rebuild the sorted list of architectures by priority
   */
  private rebuildSortedList(): void {
    this.sortedArchitectures = Array.from(this.architectures.values()).sort(
      (a, b) => b.priority - a.priority
    );
  }

  /**
   * Detect the architecture from a checkpoint filename
   * @param checkpointName The checkpoint filename to analyze
   * @returns Detection result with architecture, confidence, and reason
   */
  detect(checkpointName: string): ArchitectureDetection {
    if (!checkpointName) {
      const fallback = this.getDefault();
      return {
        architecture: fallback,
        confidence: 0.3,
        reason: "No checkpoint name provided, defaulting to SDXL",
      };
    }

    const normalized = checkpointName.toLowerCase();

    // Try each architecture in priority order
    for (const arch of this.sortedArchitectures) {
      for (const pattern of arch.patterns) {
        if (pattern.test(normalized)) {
          return {
            architecture: arch,
            confidence: arch.priority / 100,
            reason: `Matched pattern ${pattern} in checkpoint name "${checkpointName}"`,
          };
        }
      }
    }

    // Special fallback for XL-sized models
    if (normalized.includes("xl") || normalized.includes("1024")) {
      const sdxl = this.get("sdxl");
      if (sdxl) {
        return {
          architecture: sdxl,
          confidence: 0.5,
          reason: "Detected XL-sized model, assuming SDXL architecture",
        };
      }
    }

    // Final fallback
    const fallback = this.getDefault();
    return {
      architecture: fallback,
      confidence: 0.3,
      reason: "Unknown model, defaulting to SDXL (most common)",
    };
  }

  /**
   * Get an architecture by ID
   * @param id The architecture ID
   * @returns The architecture or undefined if not found
   */
  get(id: ArchitectureId): ModelArchitecture | undefined {
    return this.architectures.get(id);
  }

  /**
   * Get the default architecture (SDXL)
   * @returns The default architecture
   */
  getDefault(): ModelArchitecture {
    const sdxl = this.architectures.get("sdxl");
    if (sdxl) return sdxl;

    // If SDXL isn't registered yet, return first available
    if (this.sortedArchitectures.length > 0) {
      return this.sortedArchitectures[0];
    }

    // Emergency fallback - should never happen in practice
    throw new Error(
      "No architectures registered. Call registerArchitectures() first."
    );
  }

  /**
   * List all registered architectures
   * @returns Array of all registered architectures
   */
  list(): ModelArchitecture[] {
    return [...this.sortedArchitectures];
  }

  /**
   * Check if an architecture is registered
   * @param id The architecture ID to check
   * @returns True if registered
   */
  has(id: ArchitectureId): boolean {
    return this.architectures.has(id);
  }

  // --- Feature Queries ---

  /**
   * Get the ControlNet model for a given checkpoint and control type
   * @param checkpointName The checkpoint filename
   * @param controlType The type of ControlNet
   * @returns The ControlNet model filename, or null if not supported
   */
  getControlNetModel(
    checkpointName: string,
    controlType: ControlNetType
  ): string | null {
    const { architecture } = this.detect(checkpointName);

    if (!architecture.supportsControlNet || !architecture.controlNetModels) {
      return null;
    }

    return architecture.controlNetModels[controlType] ?? null;
  }

  /**
   * Get the IP-Adapter configuration for a given checkpoint
   * @param checkpointName The checkpoint filename
   * @returns The IP-Adapter config, or null if not supported
   */
  getIPAdapterConfig(checkpointName: string): IPAdapterConfig | null {
    const { architecture } = this.detect(checkpointName);

    if (!architecture.supportsIPAdapter || !architecture.ipadapterConfig) {
      return null;
    }

    return architecture.ipadapterConfig;
  }

  /**
   * Get the default generation parameters for a given checkpoint
   * @param checkpointName The checkpoint filename
   * @returns The default parameters for this architecture
   */
  getDefaults(checkpointName: string): ArchitectureDefaults {
    const { architecture } = this.detect(checkpointName);
    return architecture.defaults;
  }

  /**
   * Check if a checkpoint supports negative prompts
   * @param checkpointName The checkpoint filename
   * @returns True if negative prompts are supported
   */
  supportsNegativePrompt(checkpointName: string): boolean {
    const { architecture } = this.detect(checkpointName);
    return architecture.supportsNegativePrompt;
  }

  /**
   * Check if a checkpoint supports weight syntax like (word:1.2)
   * @param checkpointName The checkpoint filename
   * @returns True if weight syntax is supported
   */
  supportsWeightSyntax(checkpointName: string): boolean {
    const { architecture } = this.detect(checkpointName);
    return architecture.supportsWeightSyntax;
  }
}

/**
 * Global singleton registry instance
 */
export const architectureRegistry = new ArchitectureRegistry();
