import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as storageModule from "./index.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from("test-data")),
  stat: vi.fn().mockResolvedValue({ size: 1024 }),
  copyFile: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
}));

// Create a mock storage provider
const createMockStorageProvider = () => ({
  name: "mock",
  upload: vi.fn().mockResolvedValue({ path: "images/test.png", url: "https://example.com/images/test.png" }),
  download: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue([]),
  getSignedUrl: vi.fn().mockResolvedValue("https://example.com/signed-url"),
  healthCheck: vi.fn().mockResolvedValue({ ok: true }),
  delete: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(true),
});

describe("Storage Integration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment
    delete process.env.STORAGE_PROVIDER;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_BUCKET;
    delete process.env.GCP_PROJECT;
    delete process.env.GCP_BUCKET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("isCloudStorageConfigured", () => {
    it("returns false when no storage provider is set", () => {
      expect(storageModule.isCloudStorageConfigured()).toBe(false);
    });

    it("returns false for local storage provider", () => {
      process.env.STORAGE_PROVIDER = "local";
      expect(storageModule.isCloudStorageConfigured()).toBe(false);
    });

    it("returns true for supabase storage provider", () => {
      process.env.STORAGE_PROVIDER = "supabase";
      expect(storageModule.isCloudStorageConfigured()).toBe(true);
    });

    it("returns true for gcp storage provider", () => {
      process.env.STORAGE_PROVIDER = "gcp";
      expect(storageModule.isCloudStorageConfigured()).toBe(true);
    });
  });

  describe("generateRemotePath", () => {
    it("generates path with timestamp and default prefix", () => {
      const path = storageModule.generateRemotePath("images", "test.png");
      // Default prefix is "generated/"
      expect(path).toMatch(/^generated\/images\/\d+_test\.png$/);
    });

    it("handles different folder types", () => {
      const imagePath = storageModule.generateRemotePath("images", "portrait.png");
      const videoPath = storageModule.generateRemotePath("videos", "video.mp4");
      const audioPath = storageModule.generateRemotePath("audio", "speech.wav");

      expect(imagePath).toContain("generated/images/");
      expect(videoPath).toContain("generated/videos/");
      expect(audioPath).toContain("generated/audio/");
    });

    it("preserves original filename", () => {
      const path = storageModule.generateRemotePath("images", "my-portrait-file.png");
      expect(path).toContain("my-portrait-file.png");
    });

    it("respects STORAGE_OUTPUT_PREFIX env var", () => {
      process.env.STORAGE_OUTPUT_PREFIX = "custom/prefix/";
      const path = storageModule.generateRemotePath("images", "test.png");
      expect(path).toMatch(/^custom\/prefix\/images\/\d+_test\.png$/);
      delete process.env.STORAGE_OUTPUT_PREFIX;
    });
  });

  describe("Tool Storage Integration Patterns", () => {
    // These tests verify the pattern used in tool implementations

    describe("createPortrait storage pattern", () => {
      it("should upload when cloud storage is configured", async () => {
        process.env.STORAGE_PROVIDER = "supabase";
        process.env.SUPABASE_URL = "https://test.supabase.co";
        process.env.SUPABASE_SERVICE_KEY = "test-key";
        process.env.SUPABASE_BUCKET = "test-bucket";

        const mockProvider = createMockStorageProvider();

        // Simulate the pattern used in createPortrait
        const upload_to_cloud = true;
        const output_path = "/tmp/portrait.png";
        let remote_url: string | undefined;

        if (upload_to_cloud && storageModule.isCloudStorageConfigured()) {
          const remotePath = storageModule.generateRemotePath("images", "portrait.png");
          // In real code, this would call getStorageProvider().upload()
          const result = await mockProvider.upload(output_path, remotePath);
          remote_url = result.url || undefined;
        }

        expect(remote_url).toBe("https://example.com/images/test.png");
        expect(mockProvider.upload).toHaveBeenCalledWith(
          "/tmp/portrait.png",
          expect.stringMatching(/^generated\/images\/\d+_portrait\.png$/)
        );
      });

      it("should skip upload when cloud storage is not configured", async () => {
        // No STORAGE_PROVIDER set
        const mockProvider = createMockStorageProvider();

        const upload_to_cloud = true;
        const output_path = "/tmp/portrait.png";
        let remote_url: string | undefined;

        if (upload_to_cloud && storageModule.isCloudStorageConfigured()) {
          const remotePath = storageModule.generateRemotePath("images", "portrait.png");
          const result = await mockProvider.upload(output_path, remotePath);
          remote_url = result.url || undefined;
        }

        expect(remote_url).toBeUndefined();
        expect(mockProvider.upload).not.toHaveBeenCalled();
      });

      it("should skip upload when upload_to_cloud is false", async () => {
        process.env.STORAGE_PROVIDER = "supabase";
        const mockProvider = createMockStorageProvider();

        const upload_to_cloud = false;
        const output_path = "/tmp/portrait.png";
        let remote_url: string | undefined;

        if (upload_to_cloud && storageModule.isCloudStorageConfigured()) {
          const remotePath = storageModule.generateRemotePath("images", "portrait.png");
          const result = await mockProvider.upload(output_path, remotePath);
          remote_url = result.url || undefined;
        }

        expect(remote_url).toBeUndefined();
        expect(mockProvider.upload).not.toHaveBeenCalled();
      });
    });

    describe("lipSyncGenerate storage pattern", () => {
      it("should upload video to videos/ folder", async () => {
        process.env.STORAGE_PROVIDER = "gcp";
        const mockProvider = createMockStorageProvider();

        const upload_to_cloud = true;
        const output_path = "/tmp/lipsync.mp4";
        let remote_url: string | undefined;

        if (upload_to_cloud && storageModule.isCloudStorageConfigured()) {
          const remotePath = storageModule.generateRemotePath("videos", "lipsync.mp4");
          const result = await mockProvider.upload(output_path, remotePath);
          remote_url = result.url || undefined;
        }

        expect(remote_url).toBeDefined();
        expect(mockProvider.upload).toHaveBeenCalledWith(
          "/tmp/lipsync.mp4",
          expect.stringMatching(/^generated\/videos\/\d+_lipsync\.mp4$/)
        );
      });
    });

    describe("ttsGenerate storage pattern", () => {
      it("should upload audio to audio/ folder", async () => {
        process.env.STORAGE_PROVIDER = "supabase";
        const mockProvider = createMockStorageProvider();

        const upload_to_cloud = true;
        const output_path = "/tmp/speech.wav";
        let remote_url: string | undefined;

        if (upload_to_cloud && storageModule.isCloudStorageConfigured()) {
          const remotePath = storageModule.generateRemotePath("audio", "speech.wav");
          const result = await mockProvider.upload(output_path, remotePath);
          remote_url = result.url || undefined;
        }

        expect(remote_url).toBeDefined();
        expect(mockProvider.upload).toHaveBeenCalledWith(
          "/tmp/speech.wav",
          expect.stringMatching(/^generated\/audio\/\d+_speech\.wav$/)
        );
      });
    });

    describe("Error handling pattern", () => {
      it("should gracefully handle upload failures", async () => {
        process.env.STORAGE_PROVIDER = "supabase";
        const mockProvider = createMockStorageProvider();
        mockProvider.upload.mockRejectedValue(new Error("Network error"));

        const upload_to_cloud = true;
        const output_path = "/tmp/portrait.png";
        let remote_url: string | undefined;

        // Simulate the error handling pattern used in tools
        if (upload_to_cloud && storageModule.isCloudStorageConfigured()) {
          try {
            const remotePath = storageModule.generateRemotePath("images", "portrait.png");
            const result = await mockProvider.upload(output_path, remotePath);
            remote_url = result.url || undefined;
          } catch (error) {
            // Log but don't fail the operation
            console.error("Cloud upload failed:", error);
          }
        }

        // Operation should complete without throwing
        expect(remote_url).toBeUndefined();
      });

      it("should handle null url in upload result", async () => {
        process.env.STORAGE_PROVIDER = "supabase";
        const mockProvider = createMockStorageProvider();
        mockProvider.upload.mockResolvedValue({ path: "images/test.png", url: null });

        const upload_to_cloud = true;
        let remote_url: string | undefined;

        if (upload_to_cloud && storageModule.isCloudStorageConfigured()) {
          const result = await mockProvider.upload("/tmp/test.png", "images/test.png");
          remote_url = result.url || undefined;
        }

        expect(remote_url).toBeUndefined();
      });
    });
  });

  describe("Factory Function Behavior", () => {
    it("getStorageProvider returns local provider by default", () => {
      const provider = storageModule.getStorageProvider();
      expect(provider.name).toBe("local");
    });

    it("getStorageProvider respects STORAGE_PROVIDER env var", () => {
      process.env.STORAGE_PROVIDER = "local";
      const provider = storageModule.getStorageProvider();
      expect(provider.name).toBe("local");
    });
  });
});

describe("Storage Provider Schema Validation", () => {
  describe("createPortraitSchema upload_to_cloud", () => {
    it("should have upload_to_cloud in schema", async () => {
      const { createPortraitSchema } = await import("../tools/avatar.js");

      const result = createPortraitSchema.safeParse({
        description: "A portrait",
        output_path: "/tmp/test.png",
        upload_to_cloud: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.upload_to_cloud).toBe(true);
      }
    });

    it("should default upload_to_cloud to true", async () => {
      const { createPortraitSchema } = await import("../tools/avatar.js");

      const result = createPortraitSchema.parse({
        description: "A portrait",
        output_path: "/tmp/test.png",
      });

      expect(result.upload_to_cloud).toBe(true);
    });
  });

  describe("lipSyncGenerateSchema upload_to_cloud", () => {
    it("should have upload_to_cloud in schema", async () => {
      const { lipSyncGenerateSchema } = await import("../tools/lipsync.js");

      const result = lipSyncGenerateSchema.safeParse({
        portrait_image: "test.png",
        audio: "test.wav",
        output_path: "/tmp/test.mp4",
        upload_to_cloud: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.upload_to_cloud).toBe(false);
      }
    });

    it("should default upload_to_cloud to true", async () => {
      const { lipSyncGenerateSchema } = await import("../tools/lipsync.js");

      const result = lipSyncGenerateSchema.parse({
        portrait_image: "test.png",
        audio: "test.wav",
        output_path: "/tmp/test.mp4",
      });

      expect(result.upload_to_cloud).toBe(true);
    });
  });

  describe("talkSchema upload_to_cloud", () => {
    it("should have upload_to_cloud in schema", async () => {
      const { talkSchema } = await import("../tools/lipsync.js");

      const result = talkSchema.safeParse({
        text: "Hello world",
        voice_reference: "voice.wav",
        portrait_image: "portrait.png",
        output_path: "/tmp/test.mp4",
        upload_to_cloud: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.upload_to_cloud).toBe(true);
      }
    });
  });

  describe("ttsGenerateSchema upload_to_cloud", () => {
    it("should have upload_to_cloud in schema", async () => {
      const { ttsGenerateSchema } = await import("../tools/tts.js");

      const result = ttsGenerateSchema.safeParse({
        text: "Hello world",
        voice_reference: "voice.wav",
        output_path: "/tmp/test.wav",
        upload_to_cloud: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.upload_to_cloud).toBe(false);
      }
    });

    it("should default upload_to_cloud to true", async () => {
      const { ttsGenerateSchema } = await import("../tools/tts.js");

      const result = ttsGenerateSchema.parse({
        text: "Hello world",
        voice_reference: "voice.wav",
        output_path: "/tmp/test.wav",
      });

      expect(result.upload_to_cloud).toBe(true);
    });
  });
});
