/**
 * Supabase Storage Provider
 *
 * Production storage using Supabase Storage.
 * Requires service role key for write operations.
 *
 * Security:
 * - Uses service role key (NOT anon key)
 * - Bucket should have RLS policies restricting public access
 * - Signed URLs provide temporary access
 */

import { StorageClient } from "@supabase/storage-js";
import * as fs from "fs/promises";
import * as path from "path";
import type {
  StorageProvider,
  StorageObject,
  UploadResult,
  HealthCheckResult,
} from "./provider.js";

export interface SupabaseStorageConfig {
  /** Supabase project URL */
  url: string;
  /** Service role key (NOT anon key) - can be new sb_secret_ format or JWT */
  serviceKey: string;
  /** Storage bucket name */
  bucket: string;
}

/** Default retry configuration */
const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Error class for Supabase storage operations
 */
export class SupabaseStorageError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly statusCode?: number,
    public readonly isRetryable: boolean = false
  ) {
    super(message);
    this.name = "SupabaseStorageError";
  }
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter
 */
function getBackoffDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * Determine if an error is retryable
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof SupabaseStorageError) {
    return error.isRetryable;
  }

  // Network errors are retryable
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }

  // Check for retryable HTTP status codes
  const statusCode = (error as any)?.statusCode || (error as any)?.status;
  if (statusCode) {
    // 408 Request Timeout, 429 Too Many Requests, 500+ Server Errors
    return statusCode === 408 || statusCode === 429 || statusCode >= 500;
  }

  return false;
}

export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase";
  private storage: StorageClient;
  private bucket: string;
  private retryConfig: typeof DEFAULT_RETRY_CONFIG;

  constructor(
    config: SupabaseStorageConfig,
    retryConfig: Partial<typeof DEFAULT_RETRY_CONFIG> = {}
  ) {
    if (!config.url) {
      throw new Error("Supabase URL is required");
    }
    if (!config.serviceKey) {
      throw new Error("Supabase service key is required");
    }

    const storageUrl = `${config.url}/storage/v1`;
    this.storage = new StorageClient(storageUrl, {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
    });
    this.bucket = config.bucket;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  /**
   * Execute an operation with retry logic
   */
  private async withRetry<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry if error is not retryable or this is the last attempt
        if (!isRetryableError(error) || attempt === this.retryConfig.maxRetries) {
          throw error;
        }

        // Calculate backoff delay and wait
        const delay = getBackoffDelay(
          attempt,
          this.retryConfig.baseDelayMs,
          this.retryConfig.maxDelayMs
        );

        await sleep(delay);
      }
    }

    // Should never reach here, but TypeScript needs this
    throw lastError || new Error(`${operation} failed after retries`);
  }

  async upload(localPath: string, remotePath: string): Promise<UploadResult> {
    return this.withRetry("upload", async () => {
      const fileBuffer = await fs.readFile(localPath);
      const contentType = this.guessContentType(localPath);

      const { data, error } = await this.storage
        .from(this.bucket)
        .upload(remotePath, fileBuffer, {
          contentType,
          upsert: true,
        });

      if (error) {
        const statusCode = (error as any).statusCode || (error as any).status;
        const isRetryable =
          statusCode === 408 || statusCode === 429 || (statusCode && statusCode >= 500);

        throw new SupabaseStorageError(
          `Upload failed: ${error.message}`,
          "upload",
          statusCode,
          isRetryable
        );
      }

      // Get public URL (works for public buckets)
      const { data: urlData } = this.storage
        .from(this.bucket)
        .getPublicUrl(remotePath);

      // Generate signed URL for private bucket access
      const { data: signedData, error: signedError } = await this.storage
        .from(this.bucket)
        .createSignedUrl(remotePath, 3600);

      if (signedError) {
        throw new SupabaseStorageError(
          `Failed to create signed URL: ${signedError.message}`,
          "createSignedUrl"
        );
      }

      return {
        path: data.path,
        url: urlData.publicUrl,
        signedUrl: signedData?.signedUrl,
        size: fileBuffer.length,
      };
    });
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    return this.withRetry("download", async () => {
      const { data, error } = await this.storage
        .from(this.bucket)
        .download(remotePath);

      if (error) {
        const statusCode = (error as any).statusCode || (error as any).status;
        throw new SupabaseStorageError(
          `Download failed: ${error.message}`,
          "download",
          statusCode,
          statusCode >= 500
        );
      }

      await fs.mkdir(path.dirname(localPath), { recursive: true });
      const buffer = Buffer.from(await data.arrayBuffer());
      await fs.writeFile(localPath, buffer);
    });
  }

  async list(prefix: string): Promise<StorageObject[]> {
    return this.withRetry("list", async () => {
      const { data, error } = await this.storage
        .from(this.bucket)
        .list(prefix, {
          limit: 1000,
          sortBy: { column: "created_at", order: "desc" },
        });

      if (error) {
        throw new SupabaseStorageError(
          `List failed: ${error.message}`,
          "list"
        );
      }

      return (data || [])
        .filter((item) => item.name !== ".emptyFolderPlaceholder")
        .map((item) => ({
          name: item.name,
          path: prefix ? `${prefix}/${item.name}` : item.name,
          size: item.metadata?.size || 0,
          contentType: item.metadata?.mimetype || "application/octet-stream",
          created: new Date(item.created_at),
          metadata: item.metadata as Record<string, string> | undefined,
        }));
    });
  }

  async getSignedUrl(remotePath: string, expiresInSeconds = 3600): Promise<string> {
    return this.withRetry("getSignedUrl", async () => {
      const { data, error } = await this.storage
        .from(this.bucket)
        .createSignedUrl(remotePath, expiresInSeconds);

      if (error) {
        throw new SupabaseStorageError(
          `Signed URL failed: ${error.message}`,
          "getSignedUrl"
        );
      }

      return data.signedUrl;
    });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const { error } = await this.storage
        .from(this.bucket)
        .list("", { limit: 1 });

      if (error) {
        return {
          ok: false,
          error: `Bucket access failed: ${error.message}`,
        };
      }

      return {
        ok: true,
        details: {
          bucket: this.bucket,
          provider: "supabase",
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        error: `Health check failed: ${message}`,
      };
    }
  }

  async delete(remotePath: string): Promise<void> {
    return this.withRetry("delete", async () => {
      const { error } = await this.storage
        .from(this.bucket)
        .remove([remotePath]);

      if (error) {
        throw new SupabaseStorageError(
          `Delete failed: ${error.message}`,
          "delete"
        );
      }
    });
  }

  async exists(remotePath: string): Promise<boolean> {
    try {
      const { data, error } = await this.storage
        .from(this.bucket)
        .list(path.dirname(remotePath), {
          limit: 1,
          search: path.basename(remotePath),
        });

      if (error) {
        return false;
      }

      return data.some((item) => item.name === path.basename(remotePath));
    } catch {
      return false;
    }
  }

  /**
   * Guess content type from file extension
   */
  private guessContentType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const types: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mov": "video/quicktime",
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".ogg": "audio/ogg",
      ".json": "application/json",
      ".txt": "text/plain",
    };
    return types[ext] || "application/octet-stream";
  }
}
