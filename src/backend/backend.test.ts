import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getBackend,
  getLocalBackend,
  getRunPodBackend,
  getBackendFor,
  isRunPodConfigured,
  clearBackendCache,
  getBackendStatus,
} from "./index.js";
import { LocalBackend } from "./local.js";
import { RunPodBackend } from "./runpod.js";

// Mock the ComfyUIClient
vi.mock("../comfyui-client.js", () => {
  return {
    ComfyUIClient: class MockComfyUIClient {
      getSystemStats = vi.fn().mockResolvedValue({
        devices: [{ name: "Test GPU" }],
        system: { comfyui_version: "test" },
      });
      queuePrompt = vi.fn().mockResolvedValue({ prompt_id: "test-id" });
      waitForCompletion = vi.fn().mockResolvedValue({
        outputs: {
          "9": {
            images: [{ filename: "test.png", subfolder: "", type: "output" }],
          },
        },
      });
      getImage = vi.fn().mockResolvedValue(Buffer.from("fake-image"));
      getVideo = vi.fn().mockResolvedValue(Buffer.from("fake-video"));
      getAudio = vi.fn().mockResolvedValue(Buffer.from("fake-audio"));
    },
  };
});

// Mock the RunPodServerlessClient
vi.mock("../runpod-serverless-client.js", () => {
  return {
    RunPodServerlessClient: class MockRunPodServerlessClient {
      health = vi.fn().mockResolvedValue({ status: "healthy" });
      runSync = vi.fn().mockResolvedValue({
        status: "success",
        files: [{ type: "image", filename: "test.png" }],
      });
      tts = vi.fn().mockResolvedValue({
        status: "success",
        files: [{ type: "audio", filename: "test.wav" }],
      });
      lipsync = vi.fn().mockResolvedValue({
        status: "success",
        files: [{ type: "video", filename: "test.mp4" }],
      });
    },
  };
});

// Mock fs/promises
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe("Backend Factory", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    clearBackendCache();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getBackend", () => {
    it("returns LocalBackend by default", () => {
      const backend = getBackend();
      expect(backend.name).toBe("local");
    });

    it("returns the same cached instance on repeated calls", () => {
      const first = getBackend();
      const second = getBackend();
      expect(first).toBe(second);
    });
  });

  describe("getLocalBackend", () => {
    it("creates LocalBackend with default URL", () => {
      const backend = getLocalBackend();
      expect(backend).toBeInstanceOf(LocalBackend);
      expect(backend.name).toBe("local");
    });

    it("uses COMFYUI_URL from environment", () => {
      process.env.COMFYUI_URL = "http://custom:9999";
      clearBackendCache();
      const backend = getLocalBackend();
      expect(backend).toBeInstanceOf(LocalBackend);
    });

    it("caches the LocalBackend instance", () => {
      const first = getLocalBackend();
      const second = getLocalBackend();
      expect(first).toBe(second);
    });
  });

  describe("getRunPodBackend", () => {
    it("throws if RUNPOD_ENDPOINT_ID is not set", () => {
      delete process.env.RUNPOD_ENDPOINT_ID;
      delete process.env.RUNPOD_API_KEY;
      expect(() => getRunPodBackend()).toThrow("RunPod not configured");
    });

    it("throws if RUNPOD_API_KEY is not set", () => {
      process.env.RUNPOD_ENDPOINT_ID = "test-endpoint";
      delete process.env.RUNPOD_API_KEY;
      expect(() => getRunPodBackend()).toThrow("RunPod not configured");
    });

    it("creates RunPodBackend when properly configured", () => {
      process.env.RUNPOD_ENDPOINT_ID = "test-endpoint";
      process.env.RUNPOD_API_KEY = "test-api-key";
      const backend = getRunPodBackend();
      expect(backend).toBeInstanceOf(RunPodBackend);
      expect(backend.name).toBe("runpod");
    });

    it("caches the RunPodBackend instance", () => {
      process.env.RUNPOD_ENDPOINT_ID = "test-endpoint";
      process.env.RUNPOD_API_KEY = "test-api-key";
      const first = getRunPodBackend();
      const second = getRunPodBackend();
      expect(first).toBe(second);
    });
  });

  describe("isRunPodConfigured", () => {
    it("returns false when neither env var is set", () => {
      delete process.env.RUNPOD_ENDPOINT_ID;
      delete process.env.RUNPOD_API_KEY;
      expect(isRunPodConfigured()).toBe(false);
    });

    it("returns false when only RUNPOD_ENDPOINT_ID is set", () => {
      process.env.RUNPOD_ENDPOINT_ID = "test-endpoint";
      delete process.env.RUNPOD_API_KEY;
      expect(isRunPodConfigured()).toBe(false);
    });

    it("returns false when only RUNPOD_API_KEY is set", () => {
      delete process.env.RUNPOD_ENDPOINT_ID;
      process.env.RUNPOD_API_KEY = "test-api-key";
      expect(isRunPodConfigured()).toBe(false);
    });

    it("returns true when both env vars are set", () => {
      process.env.RUNPOD_ENDPOINT_ID = "test-endpoint";
      process.env.RUNPOD_API_KEY = "test-api-key";
      expect(isRunPodConfigured()).toBe(true);
    });
  });

  describe("getBackendFor", () => {
    it("returns LocalBackend for image operations", () => {
      const backend = getBackendFor("portrait");
      expect(backend.name).toBe("local");
    });

    it("returns LocalBackend for imagine operation", () => {
      const backend = getBackendFor("imagine");
      expect(backend.name).toBe("local");
    });

    it("returns LocalBackend for controlnet operation", () => {
      const backend = getBackendFor("controlnet");
      expect(backend.name).toBe("local");
    });

    it("returns LocalBackend for lipsync when RunPod is not configured", () => {
      delete process.env.RUNPOD_ENDPOINT_ID;
      delete process.env.RUNPOD_API_KEY;
      const backend = getBackendFor("lipsync");
      expect(backend.name).toBe("local");
    });

    it("returns RunPodBackend for lipsync when RunPod is configured", () => {
      process.env.RUNPOD_ENDPOINT_ID = "test-endpoint";
      process.env.RUNPOD_API_KEY = "test-api-key";
      const backend = getBackendFor("lipsync");
      expect(backend.name).toBe("runpod");
    });

    it("returns RunPodBackend for video operations when RunPod is configured", () => {
      process.env.RUNPOD_ENDPOINT_ID = "test-endpoint";
      process.env.RUNPOD_API_KEY = "test-api-key";

      expect(getBackendFor("lipsync").name).toBe("runpod");
      expect(getBackendFor("img2video").name).toBe("runpod");
      expect(getBackendFor("video").name).toBe("runpod");
      expect(getBackendFor("talk").name).toBe("runpod");
      expect(getBackendFor("animate").name).toBe("runpod");
    });

    it("is case-insensitive", () => {
      process.env.RUNPOD_ENDPOINT_ID = "test-endpoint";
      process.env.RUNPOD_API_KEY = "test-api-key";

      expect(getBackendFor("LIPSYNC").name).toBe("runpod");
      expect(getBackendFor("LipSync").name).toBe("runpod");
    });

    it("matches partial operation names", () => {
      process.env.RUNPOD_ENDPOINT_ID = "test-endpoint";
      process.env.RUNPOD_API_KEY = "test-api-key";

      expect(getBackendFor("generate_lipsync_video").name).toBe("runpod");
      expect(getBackendFor("run_video_animation").name).toBe("runpod");
    });
  });

  describe("clearBackendCache", () => {
    it("clears cached backends", () => {
      process.env.RUNPOD_ENDPOINT_ID = "test-endpoint";
      process.env.RUNPOD_API_KEY = "test-api-key";

      const local1 = getLocalBackend();
      const runpod1 = getRunPodBackend();

      clearBackendCache();

      const local2 = getLocalBackend();
      const runpod2 = getRunPodBackend();

      expect(local1).not.toBe(local2);
      expect(runpod1).not.toBe(runpod2);
    });
  });

  describe("getBackendStatus", () => {
    it("reports local as configured and checks health", async () => {
      const status = await getBackendStatus();
      expect(status.local.configured).toBe(true);
      expect(status.local.healthy).toBe(true);
    });

    it("reports runpod as not configured when env vars missing", async () => {
      delete process.env.RUNPOD_ENDPOINT_ID;
      delete process.env.RUNPOD_API_KEY;
      const status = await getBackendStatus();
      expect(status.runpod.configured).toBe(false);
      expect(status.runpod.healthy).toBe(false);
    });

    it("checks runpod health when configured", async () => {
      process.env.RUNPOD_ENDPOINT_ID = "test-endpoint";
      process.env.RUNPOD_API_KEY = "test-api-key";
      const status = await getBackendStatus();
      expect(status.runpod.configured).toBe(true);
      expect(status.runpod.healthy).toBe(true);
    });
  });
});

describe("LocalBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearBackendCache();
  });

  describe("healthCheck", () => {
    it("returns healthy when ComfyUI responds", async () => {
      const backend = getLocalBackend();
      const health = await backend.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.version).toBe("local");
    });
  });

  describe("portrait", () => {
    it("generates a portrait image", async () => {
      const backend = getLocalBackend();
      const result = await backend.portrait({
        prompt: "a test portrait",
        outputPath: "/tmp/test.png",
      });

      expect(result.success).toBe(true);
      expect(result.backend).toBe("local");
      expect(result.files.length).toBeGreaterThan(0);
    });

    it("uses default values for optional params", async () => {
      const backend = getLocalBackend();
      const result = await backend.portrait({
        prompt: "minimal params",
        outputPath: "/tmp/test.png",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("imagine", () => {
    it("generates an image from description", async () => {
      const backend = getLocalBackend();
      const result = await backend.imagine({
        description: "a beautiful landscape",
        outputPath: "/tmp/test.png",
      });

      expect(result.success).toBe(true);
      expect(result.backend).toBe("local");
    });

    it("maps quality to appropriate step counts", async () => {
      const backend = getLocalBackend();

      // These should all succeed - we're testing the quality mapping works
      const draftResult = await backend.imagine({
        description: "test",
        quality: "draft",
        outputPath: "/tmp/test.png",
      });
      expect(draftResult.success).toBe(true);

      const ultraResult = await backend.imagine({
        description: "test",
        quality: "ultra",
        outputPath: "/tmp/test.png",
      });
      expect(ultraResult.success).toBe(true);
    });
  });

  describe("tts", () => {
    it("generates TTS audio", async () => {
      const backend = getLocalBackend();
      const result = await backend.tts({
        text: "Hello world",
        voiceReference: "voices/sample.wav",
        outputPath: "/tmp/test.wav",
      });

      expect(result.success).toBe(true);
      expect(result.backend).toBe("local");
    });
  });

  describe("lipsync", () => {
    it("generates lipsync video", async () => {
      const backend = getLocalBackend();
      const result = await backend.lipsync({
        portraitImage: "avatars/test.png",
        audio: "voices/speech.wav",
        outputPath: "/tmp/test.mp4",
      });

      expect(result.success).toBe(true);
      expect(result.backend).toBe("local");
    });
  });
});

describe("RunPodBackend", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    clearBackendCache();
    process.env = { ...originalEnv };
    process.env.RUNPOD_ENDPOINT_ID = "test-endpoint";
    process.env.RUNPOD_API_KEY = "test-api-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("healthCheck", () => {
    it("returns healthy when RunPod responds", async () => {
      const backend = getRunPodBackend();
      const health = await backend.healthCheck();
      expect(health.healthy).toBe(true);
    });
  });

  describe("portrait", () => {
    it("generates a portrait via RunPod", async () => {
      const backend = getRunPodBackend();
      const result = await backend.portrait({
        prompt: "a test portrait",
        outputPath: "/tmp/test.png",
      });

      expect(result.success).toBe(true);
      expect(result.backend).toBe("runpod");
    });
  });

  describe("imagine", () => {
    it("maps imagine to portrait", async () => {
      const backend = getRunPodBackend();
      const result = await backend.imagine({
        description: "a beautiful landscape",
        outputPath: "/tmp/test.png",
      });

      expect(result.success).toBe(true);
      expect(result.backend).toBe("runpod");
    });
  });

  describe("tts", () => {
    it("generates TTS via RunPod", async () => {
      const backend = getRunPodBackend();
      const result = await backend.tts({
        text: "Hello world",
        voiceReference: "voices/sample.wav",
        outputPath: "/tmp/test.wav",
      });

      expect(result.success).toBe(true);
      expect(result.backend).toBe("runpod");
    });
  });

  describe("lipsync", () => {
    it("generates lipsync via RunPod", async () => {
      const backend = getRunPodBackend();
      const result = await backend.lipsync({
        portraitImage: "avatars/test.png",
        audio: "voices/speech.wav",
        outputPath: "/tmp/test.mp4",
      });

      expect(result.success).toBe(true);
      expect(result.backend).toBe("runpod");
    });
  });
});

describe("Backend Interface Compliance", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    clearBackendCache();
    process.env = { ...originalEnv };
    process.env.RUNPOD_ENDPOINT_ID = "test-endpoint";
    process.env.RUNPOD_API_KEY = "test-api-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("both backends implement the same interface", async () => {
    const local = getLocalBackend();
    const runpod = getRunPodBackend();

    // Both should have the same methods
    expect(typeof local.healthCheck).toBe("function");
    expect(typeof runpod.healthCheck).toBe("function");

    expect(typeof local.portrait).toBe("function");
    expect(typeof runpod.portrait).toBe("function");

    expect(typeof local.tts).toBe("function");
    expect(typeof runpod.tts).toBe("function");

    expect(typeof local.lipsync).toBe("function");
    expect(typeof runpod.lipsync).toBe("function");

    expect(typeof local.imagine).toBe("function");
    expect(typeof runpod.imagine).toBe("function");
  });

  it("both backends return GenerationResult with required fields", async () => {
    const local = getLocalBackend();
    const runpod = getRunPodBackend();

    const localResult = await local.portrait({
      prompt: "test",
      outputPath: "/tmp/test.png",
    });

    const runpodResult = await runpod.portrait({
      prompt: "test",
      outputPath: "/tmp/test.png",
    });

    // Check required fields
    for (const result of [localResult, runpodResult]) {
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("files");
      expect(result).toHaveProperty("backend");
      expect(Array.isArray(result.files)).toBe(true);
    }

    // Check backend names are correct
    expect(localResult.backend).toBe("local");
    expect(runpodResult.backend).toBe("runpod");
  });
});
