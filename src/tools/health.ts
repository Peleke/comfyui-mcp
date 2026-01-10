import { z } from "zod";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  isCloudStorageConfigured,
  getStorageProvider,
} from "../storage/index.js";

// ============================================================================
// Schema
// ============================================================================

export const checkConnectionSchema = z.object({});

// ============================================================================
// Types
// ============================================================================

export interface HealthCheckResult {
  comfyui: {
    status: "ok" | "error";
    latency_ms?: number;
    error?: string;
    version?: string;
  };
  storage: {
    status: "ok" | "error" | "not_configured";
    provider: string;
    error?: string;
  };
  gpu?: {
    name: string;
    vram_total_mb: number;
    vram_free_mb: number;
    torch_vram_total_mb?: number;
    torch_vram_free_mb?: number;
  };
  system?: {
    os: string;
    python_version?: string;
    comfyui_version?: string;
  };
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Check connection health to ComfyUI and storage providers.
 * Use this before expensive operations to verify system state.
 */
export async function checkConnection(
  _args: z.infer<typeof checkConnectionSchema>,
  client: ComfyUIClient
): Promise<HealthCheckResult> {
  const results: HealthCheckResult = {
    comfyui: { status: "error", error: "not checked" },
    storage: { status: "not_configured", provider: "local" },
  };

  // Check ComfyUI connectivity
  try {
    const start = Date.now();
    const stats = await client.getSystemStats();
    const latency = Date.now() - start;

    results.comfyui = {
      status: "ok",
      latency_ms: latency,
    };

    // Extract GPU info from system stats
    if (stats.devices && stats.devices.length > 0) {
      const gpu = stats.devices[0];
      results.gpu = {
        name: gpu.name || "Unknown GPU",
        vram_total_mb: Math.round((gpu.vram_total || 0) / 1024 / 1024),
        vram_free_mb: Math.round((gpu.vram_free || 0) / 1024 / 1024),
        torch_vram_total_mb: gpu.torch_vram_total
          ? Math.round(gpu.torch_vram_total / 1024 / 1024)
          : undefined,
        torch_vram_free_mb: gpu.torch_vram_free
          ? Math.round(gpu.torch_vram_free / 1024 / 1024)
          : undefined,
      };
    }

    // Extract system info
    if (stats.system) {
      results.system = {
        os: stats.system.os || "Unknown",
        python_version: stats.system.python_version,
        comfyui_version: stats.system.comfyui_version,
      };
    }
  } catch (e) {
    results.comfyui = {
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // Check storage provider
  const providerName = process.env.STORAGE_PROVIDER || "local";
  results.storage.provider = providerName;

  if (isCloudStorageConfigured()) {
    try {
      const provider = getStorageProvider();
      const health = await provider.healthCheck();

      results.storage = {
        status: health.ok ? "ok" : "error",
        provider: providerName,
        error: health.error,
      };
    } catch (e) {
      results.storage = {
        status: "error",
        provider: providerName,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  } else {
    results.storage = {
      status: "ok",
      provider: "local",
    };
  }

  return results;
}

/**
 * Quick connectivity check - just verifies ComfyUI is reachable.
 * Faster than full health check for simple "is it up?" queries.
 */
export async function pingComfyUI(client: ComfyUIClient): Promise<{
  reachable: boolean;
  latency_ms?: number;
  error?: string;
}> {
  try {
    const start = Date.now();
    await client.getSystemStats();
    return {
      reachable: true,
      latency_ms: Date.now() - start,
    };
  } catch (e) {
    return {
      reachable: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
