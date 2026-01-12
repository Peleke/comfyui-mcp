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
import {
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

export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase";
  private storage: StorageClient;
  private bucket: string;

  constructor(config: SupabaseStorageConfig) {
    if (!config.url) {
      throw new Error("Supabase URL is required");
    }
    if (!config.serviceKey) {
      throw new Error("Supabase service key is required");
    }

    // Use StorageClient directly with explicit auth headers
    // This works with both old JWT format and new sb_secret_ format
    const storageUrl = `${config.url}/storage/v1`;
    console.log(`[Supabase] Initializing StorageClient with URL: ${storageUrl}`);
    console.log(`[Supabase] Using bucket: ${config.bucket}`);
    console.log(`[Supabase] Key prefix: ${config.serviceKey.substring(0, 20)}...`);
    this.storage = new StorageClient(storageUrl, {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
    });
    this.bucket = config.bucket;
  }

  async upload(localPath: string, remotePath: string): Promise<UploadResult> {
    // Read file as buffer
    const fileBuffer = await fs.readFile(localPath);
    const contentType = this.guessContentType(localPath);

    console.log(`[Supabase] Uploading to bucket: ${this.bucket}, path: ${remotePath}`);
    console.log(`[Supabase] File size: ${fileBuffer.length} bytes, content-type: ${contentType}`);

    // Try raw fetch first to see actual API response
    const rawUrl = `${(this.storage as any).url}/object/${this.bucket}/${remotePath}`;
    console.log(`[Supabase] Raw upload URL: ${rawUrl}`);

    try {
      const rawResponse = await fetch(rawUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${(this.storage as any).headers.Authorization.split(' ')[1]}`,
          'apikey': (this.storage as any).headers.apikey,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body: fileBuffer,
      });
      const rawText = await rawResponse.text();
      console.log(`[Supabase] Raw response status: ${rawResponse.status}`);
      console.log(`[Supabase] Raw response body: ${rawText.substring(0, 500)}`);

      if (rawResponse.ok) {
        const jsonData = JSON.parse(rawText);
        // Get public URL
        const publicUrl = `${(this.storage as any).url}/object/public/${this.bucket}/${remotePath}`;
        // Get signed URL
        const { data: signedData } = await this.storage
          .from(this.bucket)
          .createSignedUrl(remotePath, 3600);

        return {
          path: jsonData.Key || remotePath,
          url: publicUrl,
          signedUrl: signedData?.signedUrl,
          size: fileBuffer.length,
        };
      }
    } catch (rawErr) {
      console.log(`[Supabase] Raw fetch error:`, rawErr);
    }

    // Fallback to SDK
    const { data, error } = await this.storage
      .from(this.bucket)
      .upload(remotePath, fileBuffer, {
        contentType,
        upsert: true, // Overwrite if exists
      });

    console.log(`[Supabase] Upload response - data:`, data, `error:`, error);

    if (error) {
      // Include full error details for debugging
      // Supabase error object may have: message, error, statusCode, status
      const errMsg = error.message || (error as any).error || 'Unknown error';
      const errCode = (error as any).statusCode || (error as any).status || '';
      const fullError = `${errMsg}${errCode ? ` (status: ${errCode})` : ''}`;
      console.error('Supabase upload error details:', {
        message: error.message,
        error: (error as any).error,
        statusCode: (error as any).statusCode,
        status: (error as any).status,
        cause: (error as any).cause,
        raw: JSON.stringify(error),
      });
      throw new Error(`Supabase upload failed: ${fullError}`);
    }

    // Get public URL (may not work if bucket is private)
    const { data: urlData } = this.storage
      .from(this.bucket)
      .getPublicUrl(remotePath);

    // Generate signed URL for private bucket access (1 hour default)
    const { data: signedData } = await this.storage
      .from(this.bucket)
      .createSignedUrl(remotePath, 3600);

    return {
      path: data.path,
      url: urlData.publicUrl,
      signedUrl: signedData?.signedUrl,
      size: fileBuffer.length,
    };
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    const { data, error } = await this.storage
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
    const { data, error } = await this.storage
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
    const { data, error } = await this.storage
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
    const { error } = await this.storage
      .from(this.bucket)
      .remove([remotePath]);

    if (error) {
      throw new Error(`Supabase delete failed: ${error.message}`);
    }
  }

  async exists(remotePath: string): Promise<boolean> {
    // Try to get metadata - if it fails, file doesn't exist
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
