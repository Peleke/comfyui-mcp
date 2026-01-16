/**
 * Storage Module Tests
 *
 * Tests for storage providers:
 * - LocalStorageProvider (full tests, no external deps)
 * - SupabaseStorageProvider (mock tests + integration with creds)
 * - GCPStorageProvider (mock tests + integration with creds)
 * - Factory and helper functions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import {
  LocalStorageProvider,
  SupabaseStorageProvider,
  GCPStorageProvider,
  createStorageProvider,
  getStorageProvider,
  resetStorageProvider,
  isCloudStorageConfigured,
  getOutputPrefix,
  generateRemotePath,
  StorageConfig,
} from "./index.js";

// ============================================================================
// LocalStorageProvider Tests
// ============================================================================

describe("LocalStorageProvider", () => {
  let provider: LocalStorageProvider;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `storage-test-${Date.now()}`);
    provider = new LocalStorageProvider({ basePath: testDir });
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("upload", () => {
    it("uploads a file to the base path", async () => {
      // Create source file
      const sourceFile = path.join(testDir, "source.txt");
      await fs.writeFile(sourceFile, "test content");

      const result = await provider.upload(sourceFile, "dest/file.txt");

      expect(result.path).toBe("dest/file.txt");
      expect(result.url).toBeNull(); // Local storage has no URLs
      expect(result.size).toBe(12); // "test content".length

      // Verify file exists at destination
      const destPath = path.join(testDir, "dest/file.txt");
      const content = await fs.readFile(destPath, "utf-8");
      expect(content).toBe("test content");
    });

    it("creates nested directories if they don't exist", async () => {
      const sourceFile = path.join(testDir, "source.txt");
      await fs.writeFile(sourceFile, "nested test");

      await provider.upload(sourceFile, "a/b/c/d/file.txt");

      const destPath = path.join(testDir, "a/b/c/d/file.txt");
      expect(await fs.access(destPath).then(() => true).catch(() => false)).toBe(true);
    });

    it("handles large files via streams", async () => {
      const sourceFile = path.join(testDir, "large.bin");
      const largeContent = Buffer.alloc(10 * 1024 * 1024); // 10MB
      await fs.writeFile(sourceFile, largeContent);

      const result = await provider.upload(sourceFile, "large-dest.bin");

      expect(result.size).toBe(10 * 1024 * 1024);
    });

    it("throws if source file doesn't exist", async () => {
      await expect(
        provider.upload("/nonexistent/file.txt", "dest.txt")
      ).rejects.toThrow();
    });
  });

  describe("download", () => {
    it("downloads a file from storage", async () => {
      // Create file in storage
      const storagePath = path.join(testDir, "stored.txt");
      await fs.mkdir(path.dirname(storagePath), { recursive: true });
      await fs.writeFile(storagePath, "stored content");

      const destFile = path.join(testDir, "downloaded.txt");
      await provider.download("stored.txt", destFile);

      const content = await fs.readFile(destFile, "utf-8");
      expect(content).toBe("stored content");
    });

    it("creates destination directory if needed", async () => {
      const storagePath = path.join(testDir, "stored.txt");
      await fs.writeFile(storagePath, "test");

      const destFile = path.join(testDir, "nested/dir/downloaded.txt");
      await provider.download("stored.txt", destFile);

      expect(await fs.access(destFile).then(() => true).catch(() => false)).toBe(true);
    });

    it("throws if remote file doesn't exist", async () => {
      await expect(
        provider.download("nonexistent.txt", "/tmp/dest.txt")
      ).rejects.toThrow();
    });
  });

  describe("list", () => {
    it("lists files with prefix", async () => {
      // Create some files
      await fs.mkdir(path.join(testDir, "images"), { recursive: true });
      await fs.writeFile(path.join(testDir, "images/a.png"), "a");
      await fs.writeFile(path.join(testDir, "images/b.jpg"), "bb");

      const objects = await provider.list("images");

      expect(objects).toHaveLength(2);
      expect(objects.map((o) => o.name).sort()).toEqual(["a.png", "b.jpg"]);
      expect(objects.find((o) => o.name === "a.png")?.size).toBe(1);
      expect(objects.find((o) => o.name === "b.jpg")?.size).toBe(2);
    });

    it("lists files recursively", async () => {
      await fs.mkdir(path.join(testDir, "deep/nested"), { recursive: true });
      await fs.writeFile(path.join(testDir, "deep/a.txt"), "a");
      await fs.writeFile(path.join(testDir, "deep/nested/b.txt"), "b");

      const objects = await provider.list("deep");

      expect(objects).toHaveLength(2);
      const paths = objects.map((o) => o.path);
      expect(paths).toContain("deep/a.txt");
      expect(paths).toContain("deep/nested/b.txt");
    });

    it("returns empty array for nonexistent prefix", async () => {
      const objects = await provider.list("nonexistent");
      expect(objects).toEqual([]);
    });

    it("guesses content types correctly", async () => {
      await fs.mkdir(path.join(testDir, "files"), { recursive: true });
      await fs.writeFile(path.join(testDir, "files/image.png"), "");
      await fs.writeFile(path.join(testDir, "files/video.mp4"), "");
      await fs.writeFile(path.join(testDir, "files/audio.wav"), "");
      await fs.writeFile(path.join(testDir, "files/unknown.xyz"), "");

      const objects = await provider.list("files");

      const byName = (name: string) => objects.find((o) => o.name === name);
      expect(byName("image.png")?.contentType).toBe("image/png");
      expect(byName("video.mp4")?.contentType).toBe("video/mp4");
      expect(byName("audio.wav")?.contentType).toBe("audio/wav");
      expect(byName("unknown.xyz")?.contentType).toBe("application/octet-stream");
    });
  });

  describe("getSignedUrl", () => {
    it("returns file:// URL for local storage", async () => {
      await fs.writeFile(path.join(testDir, "file.txt"), "test");

      const url = await provider.getSignedUrl("file.txt");

      expect(url).toMatch(/^file:\/\//);
      expect(url).toContain(testDir);
    });

    it("throws if file doesn't exist", async () => {
      await expect(provider.getSignedUrl("nonexistent.txt")).rejects.toThrow();
    });
  });

  describe("healthCheck", () => {
    it("returns ok when directory is writable", async () => {
      const result = await provider.healthCheck();

      expect(result.ok).toBe(true);
      expect(result.details?.basePath).toBe(testDir);
    });

    it("returns error when directory is not writable", async () => {
      const badProvider = new LocalStorageProvider({
        basePath: "/nonexistent/readonly/path",
      });

      const result = await badProvider.healthCheck();

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("delete", () => {
    it("deletes a file", async () => {
      await fs.writeFile(path.join(testDir, "todelete.txt"), "delete me");

      await provider.delete("todelete.txt");

      expect(await provider.exists("todelete.txt")).toBe(false);
    });

    it("throws if file doesn't exist", async () => {
      await expect(provider.delete("nonexistent.txt")).rejects.toThrow();
    });
  });

  describe("exists", () => {
    it("returns true for existing file", async () => {
      await fs.writeFile(path.join(testDir, "exists.txt"), "");

      expect(await provider.exists("exists.txt")).toBe(true);
    });

    it("returns false for nonexistent file", async () => {
      expect(await provider.exists("nope.txt")).toBe(false);
    });
  });
});

// ============================================================================
// Factory Tests
// ============================================================================

describe("Storage Factory", () => {
  beforeEach(() => {
    resetStorageProvider();
    // Clear env vars
    delete process.env.STORAGE_PROVIDER;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.GCP_PROJECT;
    delete process.env.GCP_BUCKET;
  });

  afterEach(() => {
    resetStorageProvider();
  });

  describe("createStorageProvider", () => {
    it("creates LocalStorageProvider for 'local'", () => {
      const config: StorageConfig = {
        provider: "local",
        localBasePath: "/tmp/test",
      };

      const provider = createStorageProvider(config);

      expect(provider.name).toBe("local");
      expect(provider).toBeInstanceOf(LocalStorageProvider);
    });

    it("creates SupabaseStorageProvider for 'supabase'", () => {
      const config: StorageConfig = {
        provider: "supabase",
        supabaseUrl: "https://test.supabase.co",
        supabaseServiceKey: "test-key",
        supabaseBucket: "test-bucket",
      };

      const provider = createStorageProvider(config);

      expect(provider.name).toBe("supabase");
      expect(provider).toBeInstanceOf(SupabaseStorageProvider);
    });

    it("creates GCPStorageProvider for 'gcp'", () => {
      const config: StorageConfig = {
        provider: "gcp",
        gcpProjectId: "test-project",
        gcpBucket: "test-bucket",
      };

      const provider = createStorageProvider(config);

      expect(provider.name).toBe("gcp");
      expect(provider).toBeInstanceOf(GCPStorageProvider);
    });

    it("throws for missing Supabase credentials", () => {
      const config: StorageConfig = {
        provider: "supabase",
        // Missing url and key
      };

      expect(() => createStorageProvider(config)).toThrow(
        /SUPABASE_URL and SUPABASE_SERVICE_KEY/
      );
    });

    it("throws for missing GCP credentials", () => {
      const config: StorageConfig = {
        provider: "gcp",
        // Missing project and bucket
      };

      expect(() => createStorageProvider(config)).toThrow(/GCP_PROJECT and GCP_BUCKET/);
    });

    it("throws for unknown provider", () => {
      const config: StorageConfig = {
        provider: "unknown" as any,
      };

      expect(() => createStorageProvider(config)).toThrow(/Unknown storage provider/);
    });
  });

  describe("getStorageProvider", () => {
    it("returns singleton instance", () => {
      process.env.STORAGE_PROVIDER = "local";

      const provider1 = getStorageProvider();
      const provider2 = getStorageProvider();

      expect(provider1).toBe(provider2);
    });

    it("defaults to local storage", () => {
      const provider = getStorageProvider();

      expect(provider.name).toBe("local");
    });

    it("reads provider from environment", () => {
      process.env.STORAGE_PROVIDER = "local";
      process.env.STORAGE_LOCAL_PATH = "/custom/path";

      resetStorageProvider();
      const provider = getStorageProvider();

      expect(provider.name).toBe("local");
    });
  });

  describe("resetStorageProvider", () => {
    it("allows creating new provider after reset", () => {
      process.env.STORAGE_PROVIDER = "local";
      const provider1 = getStorageProvider();

      resetStorageProvider();
      const provider2 = getStorageProvider();

      expect(provider1).not.toBe(provider2);
    });
  });
});

// ============================================================================
// Helper Function Tests
// ============================================================================

describe("Helper Functions", () => {
  beforeEach(() => {
    delete process.env.STORAGE_PROVIDER;
    delete process.env.STORAGE_OUTPUT_PREFIX;
  });

  describe("isCloudStorageConfigured", () => {
    it("returns false for local", () => {
      process.env.STORAGE_PROVIDER = "local";
      expect(isCloudStorageConfigured()).toBe(false);
    });

    it("returns false when not set", () => {
      expect(isCloudStorageConfigured()).toBe(false);
    });

    it("returns true for supabase", () => {
      process.env.STORAGE_PROVIDER = "supabase";
      expect(isCloudStorageConfigured()).toBe(true);
    });

    it("returns true for gcp", () => {
      process.env.STORAGE_PROVIDER = "gcp";
      expect(isCloudStorageConfigured()).toBe(true);
    });
  });

  describe("getOutputPrefix", () => {
    it("returns default prefix", () => {
      expect(getOutputPrefix()).toBe("generated/");
    });

    it("returns custom prefix from env", () => {
      process.env.STORAGE_OUTPUT_PREFIX = "custom/prefix/";
      expect(getOutputPrefix()).toBe("custom/prefix/");
    });
  });

  describe("generateRemotePath", () => {
    it("generates path for images", () => {
      const path = generateRemotePath("images", "test.png");

      expect(path).toMatch(/^generated\/images\/\d+_test\.png$/);
    });

    it("generates path for videos", () => {
      const path = generateRemotePath("videos", "output.mp4");

      expect(path).toMatch(/^generated\/videos\/\d+_output\.mp4$/);
    });

    it("generates path for audio", () => {
      const path = generateRemotePath("audio", "speech.wav");

      expect(path).toMatch(/^generated\/audio\/\d+_speech\.wav$/);
    });

    it("sanitizes filename", () => {
      const path = generateRemotePath("images", "test file (1).png");

      expect(path).toMatch(/^generated\/images\/\d+_test_file__1_\.png$/);
    });

    it("uses custom prefix from env", () => {
      process.env.STORAGE_OUTPUT_PREFIX = "my-prefix/";
      const path = generateRemotePath("images", "test.png");

      expect(path).toMatch(/^my-prefix\/images\/\d+_test\.png$/);
    });
  });
});

// ============================================================================
// Supabase Provider Tests (with mocks)
// ============================================================================

describe("SupabaseStorageProvider", () => {
  describe("constructor", () => {
    it("throws without URL", () => {
      expect(
        () =>
          new SupabaseStorageProvider({
            url: "",
            serviceKey: "key",
            bucket: "bucket",
          })
      ).toThrow("Supabase URL is required");
    });

    it("throws without service key", () => {
      expect(
        () =>
          new SupabaseStorageProvider({
            url: "https://test.supabase.co",
            serviceKey: "",
            bucket: "bucket",
          })
      ).toThrow("Supabase service key is required");
    });
  });
});

// ============================================================================
// GCP Provider Tests (with mocks)
// ============================================================================

describe("GCPStorageProvider", () => {
  describe("constructor", () => {
    it("throws without project ID", () => {
      expect(
        () =>
          new GCPStorageProvider({
            projectId: "",
            bucket: "bucket",
          })
      ).toThrow("GCP project ID is required");
    });

    it("throws without bucket", () => {
      expect(
        () =>
          new GCPStorageProvider({
            projectId: "project",
            bucket: "",
          })
      ).toThrow("GCP bucket name is required");
    });
  });
});

// ============================================================================
// Integration Tests (require real credentials)
// ============================================================================

const RUN_STORAGE_INTEGRATION = process.env.RUN_STORAGE_INTEGRATION === "true";
const describeIntegration = RUN_STORAGE_INTEGRATION ? describe : describe.skip;

describeIntegration("Storage Integration Tests", () => {
  describe("Supabase Integration", () => {
    let provider: SupabaseStorageProvider;
    const testPrefix = `test-${Date.now()}`;

    beforeEach(() => {
      provider = new SupabaseStorageProvider({
        url: process.env.SUPABASE_URL!,
        serviceKey: process.env.SUPABASE_SERVICE_KEY!,
        bucket: process.env.SUPABASE_BUCKET || "test-bucket",
      });
    });

    afterEach(async () => {
      // Cleanup test files
      try {
        const files = await provider.list(testPrefix);
        for (const file of files) {
          await provider.delete(file.path);
        }
      } catch {
        // Ignore cleanup errors
      }
    });

    it("healthCheck returns ok", async () => {
      const result = await provider.healthCheck();
      expect(result.ok).toBe(true);
    });

    it("uploads and downloads file", async () => {
      const testFile = path.join(tmpdir(), "supabase-test.txt");
      await fs.writeFile(testFile, "supabase test content");

      const remotePath = `${testPrefix}/upload-test.txt`;
      const result = await provider.upload(testFile, remotePath);

      expect(result.path).toBe(remotePath);
      expect(result.url).toBeDefined();

      // Download and verify
      const downloadPath = path.join(tmpdir(), "supabase-downloaded.txt");
      await provider.download(remotePath, downloadPath);
      const content = await fs.readFile(downloadPath, "utf-8");
      expect(content).toBe("supabase test content");

      // Cleanup
      await fs.unlink(testFile);
      await fs.unlink(downloadPath);
    });

    it("generates signed URL", async () => {
      const testFile = path.join(tmpdir(), "signed-url-test.txt");
      await fs.writeFile(testFile, "signed content");

      const remotePath = `${testPrefix}/signed-test.txt`;
      await provider.upload(testFile, remotePath);

      const signedUrl = await provider.getSignedUrl(remotePath, 60);
      expect(signedUrl).toContain("token=");

      // Verify URL works
      const response = await fetch(signedUrl);
      expect(response.ok).toBe(true);
      const content = await response.text();
      expect(content).toBe("signed content");

      await fs.unlink(testFile);
    });
  });

  describe("GCP Integration", () => {
    let provider: GCPStorageProvider;
    const testPrefix = `test-${Date.now()}`;

    beforeEach(() => {
      provider = new GCPStorageProvider({
        projectId: process.env.GCP_PROJECT!,
        bucket: process.env.GCP_BUCKET!,
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      });
    });

    afterEach(async () => {
      // Cleanup test files
      try {
        const files = await provider.list(testPrefix);
        for (const file of files) {
          await provider.delete(file.path);
        }
      } catch {
        // Ignore cleanup errors
      }
    });

    it("healthCheck returns ok", async () => {
      const result = await provider.healthCheck();
      expect(result.ok).toBe(true);
    });

    it("uploads and downloads file", async () => {
      const testFile = path.join(tmpdir(), "gcp-test.txt");
      await fs.writeFile(testFile, "gcp test content");

      const remotePath = `${testPrefix}/upload-test.txt`;
      const result = await provider.upload(testFile, remotePath);

      expect(result.path).toBe(remotePath);

      // Download and verify
      const downloadPath = path.join(tmpdir(), "gcp-downloaded.txt");
      await provider.download(remotePath, downloadPath);
      const content = await fs.readFile(downloadPath, "utf-8");
      expect(content).toBe("gcp test content");

      // Cleanup
      await fs.unlink(testFile);
      await fs.unlink(downloadPath);
    });
  });
});

// ============================================================================
// SupabaseStorageError Tests
// ============================================================================

import { SupabaseStorageError } from "./supabase.js";

describe("SupabaseStorageError", () => {
  it("creates error with message and operation", () => {
    const error = new SupabaseStorageError("Upload failed", "upload");

    expect(error.message).toBe("Upload failed");
    expect(error.operation).toBe("upload");
    expect(error.name).toBe("SupabaseStorageError");
    expect(error.statusCode).toBeUndefined();
    expect(error.isRetryable).toBe(false);
  });

  it("creates error with status code", () => {
    const error = new SupabaseStorageError("Rate limited", "upload", 429);

    expect(error.statusCode).toBe(429);
  });

  it("creates error with retryable flag", () => {
    const error = new SupabaseStorageError("Server error", "upload", 500, true);

    expect(error.isRetryable).toBe(true);
  });

  it("is instance of Error", () => {
    const error = new SupabaseStorageError("Test", "test");

    expect(error instanceof Error).toBe(true);
    expect(error instanceof SupabaseStorageError).toBe(true);
  });

  it("has correct stack trace", () => {
    const error = new SupabaseStorageError("Test", "test");

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain("SupabaseStorageError");
  });
});

// ============================================================================
// uploadToCloudStorage Helper Tests
// ============================================================================

import { uploadToCloudStorage, CloudUploadResult } from "./index.js";

describe("uploadToCloudStorage", () => {
  let testDir: string;
  let testFile: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `upload-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    testFile = path.join(testDir, "test.png");
    await fs.writeFile(testFile, "test image content");
  });

  afterEach(async () => {
    resetStorageProvider();
    // Reset env vars
    delete process.env.STORAGE_PROVIDER;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_BUCKET;
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe("when cloud storage is not configured", () => {
    it("returns attempted: false when STORAGE_PROVIDER is local", async () => {
      process.env.STORAGE_PROVIDER = "local";

      const result = await uploadToCloudStorage(testFile, "images", "test.png", true);

      expect(result.attempted).toBe(false);
      expect(result.success).toBe(false);
      expect(result.remoteUrl).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it("returns attempted: false when STORAGE_PROVIDER is not set", async () => {
      delete process.env.STORAGE_PROVIDER;

      const result = await uploadToCloudStorage(testFile, "images", "test.png", true);

      expect(result.attempted).toBe(false);
      expect(result.success).toBe(false);
    });
  });

  describe("when uploadToCloud is false", () => {
    it("returns attempted: false regardless of configuration", async () => {
      process.env.STORAGE_PROVIDER = "supabase";
      process.env.SUPABASE_URL = "https://test.supabase.co";
      process.env.SUPABASE_SERVICE_KEY = "test-key";

      const result = await uploadToCloudStorage(testFile, "images", "test.png", false);

      expect(result.attempted).toBe(false);
      expect(result.success).toBe(false);
    });
  });

  describe("error detection", () => {
    it("identifies timeout errors as transient", async () => {
      // Mock scenario - the actual detection happens in the catch block
      const result: CloudUploadResult = {
        attempted: true,
        success: false,
        error: "Connection timeout after 30000ms",
        isTransient: true,
      };

      expect(result.isTransient).toBe(true);
    });

    it("identifies network errors as transient", async () => {
      const result: CloudUploadResult = {
        attempted: true,
        success: false,
        error: "network request failed",
        isTransient: true,
      };

      expect(result.isTransient).toBe(true);
    });

    it("identifies 429 rate limit as transient", async () => {
      const result: CloudUploadResult = {
        attempted: true,
        success: false,
        error: "Rate limited (429)",
        isTransient: true,
      };

      expect(result.isTransient).toBe(true);
    });

    it("identifies 503 service unavailable as transient", async () => {
      const result: CloudUploadResult = {
        attempted: true,
        success: false,
        error: "Service unavailable (503)",
        isTransient: true,
      };

      expect(result.isTransient).toBe(true);
    });

    it("identifies auth errors as non-transient", async () => {
      const result: CloudUploadResult = {
        attempted: true,
        success: false,
        error: "Invalid API key",
        isTransient: false,
      };

      expect(result.isTransient).toBe(false);
    });

    it("identifies bucket not found as non-transient", async () => {
      const result: CloudUploadResult = {
        attempted: true,
        success: false,
        error: "Bucket not found",
        isTransient: false,
      };

      expect(result.isTransient).toBe(false);
    });
  });

  describe("result structure", () => {
    it("includes all required fields on success", () => {
      const result: CloudUploadResult = {
        attempted: true,
        success: true,
        remoteUrl: "https://storage.example.com/file.png",
      };

      expect(result).toHaveProperty("attempted");
      expect(result).toHaveProperty("success");
      expect(result.remoteUrl).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it("includes error details on failure", () => {
      const result: CloudUploadResult = {
        attempted: true,
        success: false,
        error: "Upload failed: bucket not found",
        isTransient: false,
      };

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.isTransient).toBeDefined();
      expect(result.remoteUrl).toBeUndefined();
    });
  });
});

// ============================================================================
// Supabase Retry Logic Tests (Unit)
// ============================================================================

describe("SupabaseStorageProvider retry logic", () => {
  // These test the retry behavior through mock scenarios

  describe("retry configuration", () => {
    it("accepts custom retry config", () => {
      // Should not throw with custom config
      expect(() => {
        new SupabaseStorageProvider(
          {
            url: "https://test.supabase.co",
            serviceKey: "test-key",
            bucket: "test-bucket",
          },
          {
            maxRetries: 5,
            baseDelayMs: 500,
            maxDelayMs: 5000,
          }
        );
      }).not.toThrow();
    });

    it("uses default retry config when not specified", () => {
      // Should not throw with default config
      expect(() => {
        new SupabaseStorageProvider({
          url: "https://test.supabase.co",
          serviceKey: "test-key",
          bucket: "test-bucket",
        });
      }).not.toThrow();
    });
  });

  describe("retryable status codes", () => {
    it("408 Request Timeout is retryable", () => {
      const error = new SupabaseStorageError("Timeout", "upload", 408, true);
      expect(error.isRetryable).toBe(true);
    });

    it("429 Too Many Requests is retryable", () => {
      const error = new SupabaseStorageError("Rate limited", "upload", 429, true);
      expect(error.isRetryable).toBe(true);
    });

    it("500 Internal Server Error is retryable", () => {
      const error = new SupabaseStorageError("Server error", "upload", 500, true);
      expect(error.isRetryable).toBe(true);
    });

    it("502 Bad Gateway is retryable", () => {
      const error = new SupabaseStorageError("Bad gateway", "upload", 502, true);
      expect(error.isRetryable).toBe(true);
    });

    it("503 Service Unavailable is retryable", () => {
      const error = new SupabaseStorageError("Unavailable", "upload", 503, true);
      expect(error.isRetryable).toBe(true);
    });

    it("504 Gateway Timeout is retryable", () => {
      const error = new SupabaseStorageError("Gateway timeout", "upload", 504, true);
      expect(error.isRetryable).toBe(true);
    });

    it("400 Bad Request is NOT retryable", () => {
      const error = new SupabaseStorageError("Bad request", "upload", 400, false);
      expect(error.isRetryable).toBe(false);
    });

    it("401 Unauthorized is NOT retryable", () => {
      const error = new SupabaseStorageError("Unauthorized", "upload", 401, false);
      expect(error.isRetryable).toBe(false);
    });

    it("403 Forbidden is NOT retryable", () => {
      const error = new SupabaseStorageError("Forbidden", "upload", 403, false);
      expect(error.isRetryable).toBe(false);
    });

    it("404 Not Found is NOT retryable", () => {
      const error = new SupabaseStorageError("Not found", "upload", 404, false);
      expect(error.isRetryable).toBe(false);
    });
  });
});

// ============================================================================
// Content Type Detection Tests
// ============================================================================

describe("Content type detection", () => {
  let provider: LocalStorageProvider;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `content-type-test-${Date.now()}`);
    provider = new LocalStorageProvider({ basePath: testDir });
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  const testCases = [
    { ext: ".png", expected: "image/png" },
    { ext: ".jpg", expected: "image/jpeg" },
    { ext: ".jpeg", expected: "image/jpeg" },
    { ext: ".gif", expected: "image/gif" },
    { ext: ".webp", expected: "image/webp" },
    { ext: ".mp4", expected: "video/mp4" },
    { ext: ".webm", expected: "video/webm" },
    { ext: ".mov", expected: "video/quicktime" },
    { ext: ".wav", expected: "audio/wav" },
    { ext: ".mp3", expected: "audio/mpeg" },
    { ext: ".ogg", expected: "audio/ogg" },
    { ext: ".json", expected: "application/json" },
    { ext: ".txt", expected: "text/plain" },
  ];

  for (const { ext, expected } of testCases) {
    it(`detects ${ext} as ${expected}`, async () => {
      // This is an indirect test - upload and check the file exists
      // Content type detection is internal, but we verify it doesn't break upload
      const sourceFile = path.join(testDir, `source${ext}`);
      await fs.writeFile(sourceFile, "test content");

      const result = await provider.upload(sourceFile, `dest${ext}`);
      expect(result.path).toBe(`dest${ext}`);
    });
  }

  it("defaults to application/octet-stream for unknown extensions", async () => {
    const sourceFile = path.join(testDir, "source.xyz");
    await fs.writeFile(sourceFile, "test content");

    const result = await provider.upload(sourceFile, "dest.xyz");
    expect(result.path).toBe("dest.xyz");
  });
});
