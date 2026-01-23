/**
 * Backend Factory
 *
 * Provides access to ComfyUI backends.
 *
 * DEFAULT: Local ComfyUI (for most operations)
 * OPT-IN: RunPod (for heavy video operations)
 *
 * Usage:
 *   // Get default (local) backend
 *   const local = getBackend();
 *   await local.imagine({ ... });
 *
 *   // Explicitly get RunPod for heavy operations
 *   const runpod = getRunPodBackend();
 *   await runpod.lipsync({ ... });
 *
 *   // Or use the smart getter that picks based on operation
 *   const backend = getBackendFor("lipsync"); // Returns RunPod if configured
 *
 * Environment:
 *   COMFYUI_URL          - Local ComfyUI URL (default: http://localhost:8188)
 *   COMFYUI_INPUT_DIR    - Local input directory
 *   COMFYUI_OUTPUT_DIR   - Local output directory
 *   RUNPOD_ENDPOINT_ID   - RunPod endpoint (optional)
 *   RUNPOD_API_KEY       - RunPod API key (optional)
 */

export * from "./types.js";
export { LocalBackend } from "./local.js";
export { RunPodBackend } from "./runpod.js";

import { ComfyBackend } from "./types.js";
import { LocalBackend } from "./local.js";
import { RunPodBackend } from "./runpod.js";

// Cached instances
let localBackend: LocalBackend | null = null;
let runpodBackend: RunPodBackend | null = null;

// Operations that should prefer RunPod (GPU-heavy)
const GPU_HEAVY_OPERATIONS = ["lipsync", "img2video", "video", "talk", "animate"];

/**
 * Get the LOCAL backend (default)
 *
 * Use this for most operations: imagine, portrait, controlnet, tts, etc.
 */
export function getBackend(): ComfyBackend {
  return getLocalBackend();
}

/**
 * Get the local ComfyUI backend
 */
export function getLocalBackend(): LocalBackend {
  if (!localBackend) {
    localBackend = new LocalBackend({
      comfyuiUrl: process.env.COMFYUI_URL || "http://localhost:8188",
      inputDir: process.env.COMFYUI_INPUT_DIR || "",
      outputDir: process.env.COMFYUI_OUTPUT_DIR || "",
      timeout: parseInt(process.env.COMFYUI_TIMEOUT || "300000", 10),
    });
  }
  return localBackend;
}

/**
 * Get the RunPod backend (for GPU-heavy operations)
 *
 * Use this for: lipsync, img2video, animation, etc.
 * Throws if RunPod is not configured.
 */
export function getRunPodBackend(): RunPodBackend {
  if (!runpodBackend) {
    const endpointId = process.env.RUNPOD_ENDPOINT_ID;
    const apiKey = process.env.RUNPOD_API_KEY;

    if (!endpointId || !apiKey) {
      throw new Error(
        "RunPod not configured. Set RUNPOD_ENDPOINT_ID and RUNPOD_API_KEY environment variables."
      );
    }

    runpodBackend = new RunPodBackend({
      endpointId,
      apiKey,
      timeout: parseInt(process.env.RUNPOD_TIMEOUT || "300000", 10),
    });
  }
  return runpodBackend;
}

/**
 * Smart backend selector based on operation type
 *
 * Returns RunPod for GPU-heavy operations (if configured), local otherwise.
 *
 * @param operation - The operation type (e.g., "lipsync", "imagine", "portrait")
 */
export function getBackendFor(operation: string): ComfyBackend {
  const isGpuHeavy = GPU_HEAVY_OPERATIONS.some(
    (op) => operation.toLowerCase().includes(op)
  );

  if (isGpuHeavy && isRunPodConfigured()) {
    return getRunPodBackend();
  }

  return getLocalBackend();
}

/**
 * Check if RunPod is configured
 */
export function isRunPodConfigured(): boolean {
  return !!(process.env.RUNPOD_ENDPOINT_ID && process.env.RUNPOD_API_KEY);
}

/**
 * Check if local ComfyUI is available
 */
export async function isLocalAvailable(): Promise<boolean> {
  try {
    const health = await getLocalBackend().healthCheck();
    return health.healthy;
  } catch {
    return false;
  }
}

/**
 * Clear cached backends (useful for testing)
 */
export function clearBackendCache(): void {
  localBackend = null;
  runpodBackend = null;
}

/**
 * Get status of all backends
 */
export async function getBackendStatus(): Promise<{
  local: { configured: boolean; healthy: boolean; error?: string };
  runpod: { configured: boolean; healthy: boolean; error?: string };
}> {
  const status = {
    local: { configured: true, healthy: false, error: undefined as string | undefined },
    runpod: { configured: isRunPodConfigured(), healthy: false, error: undefined as string | undefined },
  };

  // Check local
  try {
    const localHealth = await getLocalBackend().healthCheck();
    status.local.healthy = localHealth.healthy;
    status.local.error = localHealth.error;
  } catch (error) {
    status.local.error = error instanceof Error ? error.message : "Unknown error";
  }

  // Check RunPod if configured
  if (status.runpod.configured) {
    try {
      const runpodHealth = await getRunPodBackend().healthCheck();
      status.runpod.healthy = runpodHealth.healthy;
      status.runpod.error = runpodHealth.error;
    } catch (error) {
      status.runpod.error = error instanceof Error ? error.message : "Unknown error";
    }
  }

  return status;
}
