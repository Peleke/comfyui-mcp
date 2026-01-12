/**
 * Storage Module
 *
 * Provides unified access to storage providers.
 * Use getStorageProvider() to get the configured provider instance.
 *
 * Environment Variables:
 * - STORAGE_PROVIDER: "local" | "supabase" | "gcp" (default: "local")
 *
 * For Supabase:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_KEY
 * - SUPABASE_BUCKET
 *
 * For GCP:
 * - GCP_PROJECT
 * - GCP_BUCKET
 * - GOOGLE_APPLICATION_CREDENTIALS (optional)
 *
 * For Local:
 * - STORAGE_LOCAL_PATH (default: /tmp/comfyui-storage)
 */

// Re-export types and interfaces (type-only for interfaces)
export type {
  StorageProvider,
  StorageObject,
  UploadResult,
  HealthCheckResult,
  StorageProviderType,
  StorageConfig,
} from "./provider.js";

// Re-export runtime functions
export { getStorageConfigFromEnv } from "./provider.js";

// Re-export implementations (classes)
export { LocalStorageProvider } from "./local.js";
export { SupabaseStorageProvider } from "./supabase.js";
export { GCPStorageProvider } from "./gcp.js";

// Re-export config types (interfaces - type-only export for runtime safety)
export type { LocalStorageConfig } from "./local.js";
export type { SupabaseStorageConfig } from "./supabase.js";
export type { GCPStorageConfig } from "./gcp.js";

import type { StorageProvider, StorageConfig } from "./provider.js";
import { getStorageConfigFromEnv } from "./provider.js";
import { LocalStorageProvider } from "./local.js";
import { SupabaseStorageProvider } from "./supabase.js";
import { GCPStorageProvider } from "./gcp.js";

// Singleton instance
let storageProviderInstance: StorageProvider | null = null;

/**
 * Create a storage provider from configuration
 */
export function createStorageProvider(config: StorageConfig): StorageProvider {
  switch (config.provider) {
    case "local":
      return new LocalStorageProvider({
        basePath: config.localBasePath || "/tmp/comfyui-storage",
      });

    case "supabase":
      if (!config.supabaseUrl || !config.supabaseServiceKey) {
        throw new Error(
          "Supabase storage requires SUPABASE_URL and SUPABASE_SERVICE_KEY"
        );
      }
      return new SupabaseStorageProvider({
        url: config.supabaseUrl,
        serviceKey: config.supabaseServiceKey,
        bucket: config.supabaseBucket || "generated-assets",
      });

    case "gcp":
      if (!config.gcpProjectId || !config.gcpBucket) {
        throw new Error("GCP storage requires GCP_PROJECT and GCP_BUCKET");
      }
      return new GCPStorageProvider({
        projectId: config.gcpProjectId,
        bucket: config.gcpBucket,
        keyFile: config.gcpKeyFile,
      });

    default:
      throw new Error(`Unknown storage provider: ${config.provider}`);
  }
}

/**
 * Get the configured storage provider (singleton)
 *
 * Creates the provider on first call based on environment variables.
 * Subsequent calls return the same instance.
 */
export function getStorageProvider(): StorageProvider {
  if (!storageProviderInstance) {
    const config = getStorageConfigFromEnv();
    storageProviderInstance = createStorageProvider(config);
  }
  return storageProviderInstance;
}

/**
 * Reset the storage provider singleton
 * Useful for testing or reconfiguration
 */
export function resetStorageProvider(): void {
  storageProviderInstance = null;
}

/**
 * Check if cloud storage is configured
 * Returns true if provider is supabase or gcp
 */
export function isCloudStorageConfigured(): boolean {
  const provider = process.env.STORAGE_PROVIDER || "local";
  return provider === "supabase" || provider === "gcp";
}

/**
 * Get the output prefix for organizing files
 */
export function getOutputPrefix(): string {
  return process.env.STORAGE_OUTPUT_PREFIX || "generated/";
}

/**
 * Generate a remote path for an asset
 * @param type - Asset type (images, videos, audio)
 * @param filename - Original filename
 * @returns Remote path with prefix and timestamp
 */
export function generateRemotePath(
  type: "images" | "videos" | "audio",
  filename: string
): string {
  const prefix = getOutputPrefix();
  const timestamp = Date.now();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${prefix}${type}/${timestamp}_${sanitizedFilename}`;
}
