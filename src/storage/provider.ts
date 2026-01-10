/**
 * Storage Provider Abstraction
 *
 * Provides a unified interface for storing generated assets to:
 * - Local filesystem (development)
 * - Supabase Storage (production)
 * - GCP Cloud Storage (alternative)
 *
 * Security Model:
 * - Only RunPod (write) and Jump Box (read/write) have direct bucket access
 * - All other clients get signed URLs via Jump Box API
 */

export interface StorageObject {
  /** Filename without path */
  name: string;
  /** Full path in storage */
  path: string;
  /** File size in bytes */
  size: number;
  /** MIME type */
  contentType: string;
  /** Creation timestamp */
  created: Date;
  /** Optional metadata */
  metadata?: Record<string, string>;
}

export interface UploadResult {
  /** Path in storage (relative to bucket root) */
  path: string;
  /** Public URL if available, null for local storage */
  url: string | null;
  /** Signed URL for private buckets (time-limited access) */
  signedUrl?: string;
  /** Size in bytes */
  size: number;
}

/** Options for viewing/downloading results */
export interface ViewOptions {
  /** Auto-open in browser after generation (default: false on headless, true on desktop) */
  autoOpen?: boolean;
  /** Download to local path (default: true on desktop, false on headless) */
  download?: boolean;
  /** Local download path (default: ./output/) */
  downloadPath?: string;
}

/** Detect if running in headless environment */
export function isHeadless(): boolean {
  return (
    !process.env.DISPLAY && // No X11 display
    !process.env.TERM_PROGRAM && // No terminal program (VS Code, iTerm, etc.)
    (process.env.SSH_CONNECTION !== undefined || // SSH session
      process.env.FLY_APP_NAME !== undefined || // Fly.io
      process.env.KUBERNETES_SERVICE_HOST !== undefined) // K8s
  );
}

/** Get default view options based on environment */
export function getDefaultViewOptions(): ViewOptions {
  const headless = isHeadless();
  return {
    autoOpen: !headless,
    download: !headless,
    downloadPath: process.env.OUTPUT_PATH || "./output",
  };
}

export interface HealthCheckResult {
  ok: boolean;
  error?: string;
  /** Provider-specific details */
  details?: Record<string, unknown>;
}

/**
 * Storage provider interface
 *
 * All implementations must handle:
 * - Large files (videos up to several GB)
 * - Binary content (images, audio, video)
 * - Concurrent uploads
 */
export interface StorageProvider {
  /** Provider name for logging/debugging */
  readonly name: string;

  /**
   * Upload a local file to remote storage
   * @param localPath - Absolute path to local file
   * @param remotePath - Destination path in storage (e.g., "videos/output.mp4")
   * @returns Upload result with path and URL
   */
  upload(localPath: string, remotePath: string): Promise<UploadResult>;

  /**
   * Download a remote file to local path
   * @param remotePath - Path in storage
   * @param localPath - Destination local path
   */
  download(remotePath: string, localPath: string): Promise<void>;

  /**
   * List objects with a given prefix
   * @param prefix - Path prefix (e.g., "videos/" or "")
   * @returns Array of storage objects
   */
  list(prefix: string): Promise<StorageObject[]>;

  /**
   * Generate a signed URL for temporary access
   * @param remotePath - Path in storage
   * @param expiresInSeconds - URL validity duration (default: 3600 = 1 hour)
   * @returns Signed URL string
   */
  getSignedUrl(remotePath: string, expiresInSeconds?: number): Promise<string>;

  /**
   * Check if the storage provider is configured and accessible
   * @returns Health check result
   */
  healthCheck(): Promise<HealthCheckResult>;

  /**
   * Delete a file from storage
   * @param remotePath - Path to delete
   */
  delete(remotePath: string): Promise<void>;

  /**
   * Check if a file exists
   * @param remotePath - Path to check
   */
  exists(remotePath: string): Promise<boolean>;
}

/**
 * Storage provider type identifier
 */
export type StorageProviderType = "local" | "supabase" | "gcp";

/**
 * Configuration for storage providers
 */
export interface StorageConfig {
  provider: StorageProviderType;

  // Local storage config
  localBasePath?: string;

  // Supabase config
  supabaseUrl?: string;
  supabaseServiceKey?: string;
  supabaseBucket?: string;

  // GCP config
  gcpProjectId?: string;
  gcpBucket?: string;
  gcpKeyFile?: string;

  // Common config
  outputPrefix?: string; // e.g., "generated/"
}

/**
 * Get storage config from environment variables
 */
export function getStorageConfigFromEnv(): StorageConfig {
  const provider = (process.env.STORAGE_PROVIDER || "local") as StorageProviderType;

  return {
    provider,

    // Local
    localBasePath: process.env.STORAGE_LOCAL_PATH || "/tmp/comfyui-storage",

    // Supabase
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,
    supabaseBucket: process.env.SUPABASE_BUCKET || "generated-assets",

    // GCP
    gcpProjectId: process.env.GCP_PROJECT,
    gcpBucket: process.env.GCP_BUCKET,
    gcpKeyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,

    // Common
    outputPrefix: process.env.STORAGE_OUTPUT_PREFIX || "generated/",
  };
}
