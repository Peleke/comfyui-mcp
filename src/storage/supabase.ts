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

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs/promises";
import * as path from "path";
import {
  StorageProvider,
  StorageObject,
  UploadResult,
  HealthCheckResult,
} from "./provider.js";

export interface SupabaseStorageConfig {
  /** Supabase project URL */
  url: string;
  /** Service role key (NOT anon key) */
  serviceKey: string;
  /** Storage bucket name */
  bucket: string;
}

export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase";
  private client: SupabaseClient;
  private bucket: string;

  constructor(config: SupabaseStorageConfig) {
    if (!config.url) {
      throw new Error("Supabase URL is required");
    }
    if (!config.serviceKey) {
      throw new Error("Supabase service key is required");
    }

    this.client = createClient(config.url, config.serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    this.bucket = config.bucket;
  }

  async upload(localPath: string, remotePath: string): Promise<UploadResult> {
    // Read file as buffer
    const fileBuffer = await fs.readFile(localPath);
    const contentType = this.guessContentType(localPath);

    // Upload to Supabase
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .upload(remotePath, fileBuffer, {
        contentType,
        upsert: true, // Overwrite if exists
      });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    // Get public URL (if bucket is public) or generate signed URL
    const { data: urlData } = this.client.storage
      .from(this.bucket)
      .getPublicUrl(remotePath);

    return {
      path: data.path,
      url: urlData.publicUrl,
      size: fileBuffer.length,
    };
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .download(remotePath);

    if (error) {
      throw new Error(`Supabase download failed: ${error.message}`);
    }

    // Ensure destination directory exists
    await fs.mkdir(path.dirname(localPath), { recursive: true });

    // Write to local file
    const buffer = Buffer.from(await data.arrayBuffer());
    await fs.writeFile(localPath, buffer);
  }

  async list(prefix: string): Promise<StorageObject[]> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .list(prefix, {
        limit: 1000,
        sortBy: { column: "created_at", order: "desc" },
      });

    if (error) {
      throw new Error(`Supabase list failed: ${error.message}`);
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
  }

  async getSignedUrl(remotePath: string, expiresInSeconds = 3600): Promise<string> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(remotePath, expiresInSeconds);

    if (error) {
      throw new Error(`Supabase signed URL failed: ${error.message}`);
    }

    return data.signedUrl;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      // Try to list the bucket (empty prefix)
      const { error } = await this.client.storage
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
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: `Health check failed: ${error}`,
      };
    }
  }

  async delete(remotePath: string): Promise<void> {
    const { error } = await this.client.storage
      .from(this.bucket)
      .remove([remotePath]);

    if (error) {
      throw new Error(`Supabase delete failed: ${error.message}`);
    }
  }

  async exists(remotePath: string): Promise<boolean> {
    // Try to get metadata - if it fails, file doesn't exist
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .list(path.dirname(remotePath), {
        limit: 1,
        search: path.basename(remotePath),
      });

    if (error) {
      return false;
    }

    return data.some((item) => item.name === path.basename(remotePath));
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
