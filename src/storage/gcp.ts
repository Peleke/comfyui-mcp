/**
 * Google Cloud Storage Provider
 *
 * Alternative production storage using GCP Cloud Storage.
 * Uses service account credentials for authentication.
 *
 * Security:
 * - Uses service account key file
 * - Bucket should not be publicly accessible
 * - Signed URLs provide temporary access
 */

import { Storage, Bucket, File } from "@google-cloud/storage";
import * as fs from "fs/promises";
import * as path from "path";
import {
  StorageProvider,
  StorageObject,
  UploadResult,
  HealthCheckResult,
} from "./provider.js";

export interface GCPStorageConfig {
  /** GCP project ID */
  projectId: string;
  /** GCS bucket name */
  bucket: string;
  /** Path to service account key file (optional if using default credentials) */
  keyFile?: string;
}

export class GCPStorageProvider implements StorageProvider {
  readonly name = "gcp";
  private storage: Storage;
  private bucket: Bucket;
  private bucketName: string;

  constructor(config: GCPStorageConfig) {
    if (!config.projectId) {
      throw new Error("GCP project ID is required");
    }
    if (!config.bucket) {
      throw new Error("GCP bucket name is required");
    }

    const storageOptions: ConstructorParameters<typeof Storage>[0] = {
      projectId: config.projectId,
    };

    if (config.keyFile) {
      storageOptions.keyFilename = config.keyFile;
    }

    this.storage = new Storage(storageOptions);
    this.bucket = this.storage.bucket(config.bucket);
    this.bucketName = config.bucket;
  }

  async upload(localPath: string, remotePath: string): Promise<UploadResult> {
    const contentType = this.guessContentType(localPath);

    // Upload file
    await this.bucket.upload(localPath, {
      destination: remotePath,
      contentType,
      metadata: {
        contentType,
      },
    });

    // Get file metadata for size
    const file = this.bucket.file(remotePath);
    const [metadata] = await file.getMetadata();

    // Generate public URL (requires bucket to be public) or use signed URL
    const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${remotePath}`;

    return {
      path: remotePath,
      url: publicUrl,
      size: parseInt(metadata.size as string, 10) || 0,
    };
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    // Ensure destination directory exists
    await fs.mkdir(path.dirname(localPath), { recursive: true });

    // Download file
    await this.bucket.file(remotePath).download({
      destination: localPath,
    });
  }

  async list(prefix: string): Promise<StorageObject[]> {
    const [files] = await this.bucket.getFiles({
      prefix,
      maxResults: 1000,
    });

    return files.map((file: File) => ({
      name: path.basename(file.name),
      path: file.name,
      size: parseInt(file.metadata.size as string, 10) || 0,
      contentType: (file.metadata.contentType as string) || "application/octet-stream",
      created: new Date(file.metadata.timeCreated as string),
      metadata: file.metadata.metadata as Record<string, string> | undefined,
    }));
  }

  async getSignedUrl(remotePath: string, expiresInSeconds = 3600): Promise<string> {
    const [signedUrl] = await this.bucket.file(remotePath).getSignedUrl({
      action: "read",
      expires: Date.now() + expiresInSeconds * 1000,
    });

    return signedUrl;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      // Try to check if bucket exists and is accessible
      const [exists] = await this.bucket.exists();

      if (!exists) {
        return {
          ok: false,
          error: `Bucket ${this.bucketName} does not exist`,
        };
      }

      // Try to list files (limited to 1)
      await this.bucket.getFiles({ maxResults: 1 });

      return {
        ok: true,
        details: {
          bucket: this.bucketName,
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
    await this.bucket.file(remotePath).delete();
  }

  async exists(remotePath: string): Promise<boolean> {
    const [exists] = await this.bucket.file(remotePath).exists();
    return exists;
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
