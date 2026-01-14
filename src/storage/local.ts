/**
 * Local Filesystem Storage Provider
 *
 * Default provider for development. Stores files on local disk.
 * Does not support signed URLs (returns file:// URLs instead).
 */

import * as fs from "fs/promises";
import * as path from "path";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import type {
  StorageProvider,
  StorageObject,
  UploadResult,
  HealthCheckResult,
} from "./provider.js";

export interface LocalStorageConfig {
  /** Base directory for storage */
  basePath: string;
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private basePath: string;

  constructor(config: LocalStorageConfig) {
    this.basePath = config.basePath;
  }

  async upload(localPath: string, remotePath: string): Promise<UploadResult> {
    const destPath = path.join(this.basePath, remotePath);
    const destDir = path.dirname(destPath);

    // Ensure destination directory exists
    await fs.mkdir(destDir, { recursive: true });

    // Copy file using streams for large files
    await pipeline(
      createReadStream(localPath),
      createWriteStream(destPath)
    );

    const stats = await fs.stat(destPath);

    return {
      path: remotePath,
      url: null, // Local storage doesn't have public URLs
      size: stats.size,
    };
  }

  async download(remotePath: string, localPath: string): Promise<void> {
    const sourcePath = path.join(this.basePath, remotePath);
    const destDir = path.dirname(localPath);

    // Ensure destination directory exists
    await fs.mkdir(destDir, { recursive: true });

    // Copy file using streams
    await pipeline(
      createReadStream(sourcePath),
      createWriteStream(localPath)
    );
  }

  async list(prefix: string): Promise<StorageObject[]> {
    const searchPath = path.join(this.basePath, prefix);
    const objects: StorageObject[] = [];

    try {
      await this.listRecursive(searchPath, prefix, objects);
    } catch (error) {
      // Directory doesn't exist - return empty list
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    return objects;
  }

  private async listRecursive(
    dir: string,
    prefix: string,
    objects: StorageObject[]
  ): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(prefix, entry.name);

      if (entry.isDirectory()) {
        await this.listRecursive(fullPath, relativePath, objects);
      } else if (entry.isFile()) {
        const stats = await fs.stat(fullPath);
        objects.push({
          name: entry.name,
          path: relativePath,
          size: stats.size,
          contentType: this.guessContentType(entry.name),
          created: stats.birthtime,
        });
      }
    }
  }

  async getSignedUrl(remotePath: string, _expiresInSeconds?: number): Promise<string> {
    // Local storage doesn't support signed URLs
    // Return a file:// URL for local access
    const fullPath = path.join(this.basePath, remotePath);

    // Verify file exists
    await fs.access(fullPath);

    return `file://${fullPath}`;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      // Try to create base directory and write a test file
      await fs.mkdir(this.basePath, { recursive: true });

      const testFile = path.join(this.basePath, ".health-check");
      await fs.writeFile(testFile, "ok");
      await fs.unlink(testFile);

      return {
        ok: true,
        details: {
          basePath: this.basePath,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: `Cannot write to ${this.basePath}: ${error}`,
      };
    }
  }

  async delete(remotePath: string): Promise<void> {
    const fullPath = path.join(this.basePath, remotePath);
    await fs.unlink(fullPath);
  }

  async exists(remotePath: string): Promise<boolean> {
    const fullPath = path.join(this.basePath, remotePath);
    try {
      await fs.access(fullPath);
      return true;
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
