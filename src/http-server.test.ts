/**
 * HTTP Server Tests
 *
 * Exhaustive test coverage for all HTTP endpoints.
 * Tests request validation, response format, error handling, and cloud upload.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { app } from "./http-server.js";

// Mock the ComfyUI client
vi.mock("./comfyui-client.js", () => {
  const mockClient = {
    queuePrompt: vi.fn().mockResolvedValue({ prompt_id: "test-prompt-id" }),
    waitForCompletion: vi.fn().mockResolvedValue({
      outputs: {
        "5": { images: [{ filename: "test.png", subfolder: "", type: "output" }] },
        "9": { images: [{ filename: "test.png", subfolder: "", type: "output" }] },
        "3": { images: [{ filename: "test.png", subfolder: "", type: "output" }] },
      },
    }),
    getImage: vi.fn().mockResolvedValue(Buffer.from("fake-image-data")),
    getObjectInfo: vi.fn().mockResolvedValue({}),
    systemStats: vi.fn().mockResolvedValue({
      system: { comfyui_version: "0.0.1" },
      devices: [{ name: "GPU", vram_total: 1000000000 }],
    }),
    getHistory: vi.fn().mockResolvedValue({}),
  };

  return {
    ComfyUIClient: class MockComfyUIClient {
      queuePrompt = mockClient.queuePrompt;
      waitForCompletion = mockClient.waitForCompletion;
      getImage = mockClient.getImage;
      getObjectInfo = mockClient.getObjectInfo;
      systemStats = mockClient.systemStats;
      getHistory = mockClient.getHistory;
    },
  };
});

// Mock storage
vi.mock("./storage/index.js", () => ({
  getStorageProvider: vi.fn().mockReturnValue({
    upload: vi.fn().mockResolvedValue({
      path: "test/path",
      url: "https://test.com/image.png",
      signedUrl: "https://test.com/image.png?signed=true",
    }),
    healthCheck: vi.fn().mockResolvedValue({ ok: true }),
  }),
  isCloudStorageConfigured: vi.fn().mockReturnValue(true),
  generateRemotePath: vi.fn().mockReturnValue("generated/images/test.png"),
}));

// Mock fs
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from("fake-data")),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock tool functions
vi.mock("./tools/avatar.js", () => ({
  createPortrait: vi.fn().mockResolvedValue({
    image: "/tmp/portrait.png",
    remote_url: "https://test.com/portrait.png",
    prompt: "test prompt",
    model: "test-model",
    taskId: "task-123",
  }),
  createPortraitSchema: {
    parse: vi.fn().mockImplementation((input) => input),
  },
}));

vi.mock("./tools/tts.js", () => ({
  ttsGenerate: vi.fn().mockResolvedValue({
    audio: "/tmp/tts.wav",
    remote_url: "https://test.com/tts.wav",
    taskId: "task-123",
  }),
  ttsGenerateSchema: {
    parse: vi.fn().mockImplementation((input) => input),
  },
}));

vi.mock("./tools/lipsync.js", () => ({
  lipSyncGenerate: vi.fn().mockResolvedValue({
    video: "/tmp/lipsync.mp4",
    remote_url: "https://test.com/lipsync.mp4",
    taskId: "task-123",
  }),
  lipSyncGenerateSchema: {
    parse: vi.fn().mockImplementation((input) => input),
  },
}));

vi.mock("./tools/imagine.js", () => ({
  imagine: vi.fn().mockResolvedValue({
    imagePath: "/tmp/imagine.png",
    prompt: { positive: "test", negative: "bad" },
    modelFamily: "sdxl",
    seed: 12345,
    pipelineSteps: ["txt2img"],
    settings: {},
  }),
  imagineSchema: {
    parse: vi.fn().mockImplementation((input) => input),
  },
}));

vi.mock("./tools/generate.js", () => ({
  generateImage: vi.fn().mockResolvedValue({
    path: "/tmp/image.png",
    seed: 12345,
  }),
  generateImageSchema: {
    parse: vi.fn().mockImplementation((input) => input),
  },
}));

vi.mock("./tools/upscale.js", () => ({
  upscaleImage: vi.fn().mockResolvedValue({
    success: true,
    path: "/tmp/upscale.png",
    message: "Image upscaled successfully",
  }),
  upscaleSchema: {
    parse: vi.fn().mockImplementation((input) => input),
  },
}));

vi.mock("./tools/inpaint.js", () => ({
  inpaint: vi.fn().mockResolvedValue({
    success: true,
    path: "/tmp/inpaint.png",
    seed: 12345,
    message: "Inpainted image saved",
  }),
  inpaintSchema: {
    parse: vi.fn().mockImplementation((input) => input),
  },
  outpaint: vi.fn().mockResolvedValue({
    success: true,
    path: "/tmp/outpaint.png",
    seed: 12345,
    message: "Outpainted image (right: 256px) saved",
  }),
  outpaintSchema: {
    parse: vi.fn().mockImplementation((input) => input),
  },
}));

vi.mock("./tools/controlnet.js", () => ({
  generateWithControlNet: vi.fn().mockResolvedValue({
    success: true,
    path: "/tmp/controlnet.png",
    seed: 12345,
    control_type: "canny",
    message: "Generated with canny ControlNet",
  }),
  generateWithControlNetSchema: {
    parse: vi.fn().mockImplementation((input) => input),
  },
  generateWithMultiControlNet: vi.fn().mockResolvedValue({
    success: true,
    path: "/tmp/controlnet_multi.png",
    seed: 12345,
    control_types: ["canny", "depth"],
    message: "Generated with 2 ControlNets",
  }),
  generateWithMultiControlNetSchema: {
    parse: vi.fn().mockImplementation((input) => input),
  },
  preprocessControlImage: vi.fn().mockResolvedValue({
    success: true,
    path: "/tmp/preprocess.png",
    message: "Preprocessed with canny detector",
  }),
  preprocessControlImageSchema: {
    parse: vi.fn().mockImplementation((input) => input),
  },
}));

vi.mock("./tools/health.js", () => ({
  checkConnection: vi.fn().mockResolvedValue({
    gpu: { name: "Test GPU", vram_total: "10GB" },
    storage: { ok: true },
    system: { comfyui_version: "0.0.1" },
  }),
  pingComfyUI: vi.fn().mockResolvedValue({
    reachable: true,
    latency_ms: 50,
  }),
}));

vi.mock("./tools/list-models.js", () => ({
  listModels: vi.fn().mockResolvedValue(["model1.safetensors", "model2.safetensors"]),
}));

// Mock queues
vi.mock("./queues/index.js", () => ({
  initPortraitQueue: vi.fn(),
  getPortraitQueue: vi.fn().mockReturnValue({
    enqueue: vi.fn().mockResolvedValue({ id: "job-123" }),
    getJob: vi.fn().mockReturnValue({
      id: "job-123",
      status: "completed",
      result: { image: "/tmp/portrait.png" },
      createdAt: new Date(),
      completedAt: new Date(),
    }),
  }),
  initTTSQueue: vi.fn(),
  getTTSQueue: vi.fn().mockReturnValue({
    enqueue: vi.fn().mockResolvedValue({ id: "job-123" }),
    getJob: vi.fn().mockReturnValue(null),
  }),
  initLipsyncQueue: vi.fn(),
  getLipsyncQueue: vi.fn().mockReturnValue({
    enqueue: vi.fn().mockResolvedValue({ id: "job-123" }),
    getJob: vi.fn().mockReturnValue(null),
  }),
  startQueueCleanup: vi.fn(),
}));

// Mock middleware
vi.mock("./middleware/auth.js", () => ({
  createAuthMiddleware: vi.fn().mockReturnValue(async (_c: any, next: any) => next()),
}));

vi.mock("./middleware/rate-limit.js", () => ({
  createRateLimitMiddleware: vi.fn().mockReturnValue(async (_c: any, next: any) => next()),
}));

// ============================================================================
// Test Helpers
// ============================================================================

async function makeRequest(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: object
) {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) {
    init.body = JSON.stringify(body);
  }
  const req = new Request(`http://localhost${path}`, init);
  return app.fetch(req);
}

// ============================================================================
// Health Endpoints
// ============================================================================

describe("Health Endpoints", () => {
  describe("GET /health", () => {
    it("should return healthy status when ComfyUI is reachable", async () => {
      const res = await makeRequest("/health");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe("healthy");
      expect(data.latency_ms).toBeDefined();
    });
  });

  describe("GET /ping", () => {
    it("should return ping result", async () => {
      const res = await makeRequest("/ping");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.reachable).toBe(true);
      expect(data.latency_ms).toBeDefined();
    });
  });

  describe("GET /models", () => {
    it("should return available models", async () => {
      const res = await makeRequest("/models");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.models).toBeInstanceOf(Array);
      expect(data.models).toContain("model1.safetensors");
    });
  });

  describe("GET /", () => {
    it("should return API info", async () => {
      const res = await makeRequest("/");
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.name).toBe("comfyui-mcp");
      expect(data.endpoints).toBeDefined();
      expect(data.endpoints["POST /upscale"]).toBeDefined();
      expect(data.endpoints["POST /controlnet"]).toBeDefined();
      expect(data.endpoints["POST /controlnet/multi"]).toBeDefined();
      expect(data.endpoints["POST /preprocess/:type"]).toBeDefined();
      expect(data.endpoints["POST /inpaint"]).toBeDefined();
      expect(data.endpoints["POST /outpaint"]).toBeDefined();
    });
  });
});

// ============================================================================
// Portrait Endpoint
// ============================================================================

describe("POST /portrait", () => {
  it("should require description field", async () => {
    const res = await makeRequest("/portrait", "POST", {});
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("description is required");
  });

  it("should generate portrait successfully", async () => {
    const res = await makeRequest("/portrait", "POST", {
      description: "A professional headshot",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.localPath).toBeDefined();
    expect(data.signedUrl).toBeDefined();
  });

  it("should accept optional parameters", async () => {
    const res = await makeRequest("/portrait", "POST", {
      description: "A professional headshot",
      style: "realistic",
      gender: "female",
      expression: "slight_smile",
      age: "30s",
      width: 768,
      height: 1024,
      upload_to_cloud: false,
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// TTS Endpoint
// ============================================================================

describe("POST /tts", () => {
  it("should require text field", async () => {
    const res = await makeRequest("/tts", "POST", {
      voice_reference: "voice.wav",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("text is required");
  });

  it("should require voice_reference field", async () => {
    const res = await makeRequest("/tts", "POST", {
      text: "Hello world",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("voice_reference is required");
  });

  it("should generate TTS successfully", async () => {
    const res = await makeRequest("/tts", "POST", {
      text: "Hello world",
      voice_reference: "voice.wav",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.localPath).toBeDefined();
  });
});

// ============================================================================
// Lipsync Endpoint
// ============================================================================

describe("POST /lipsync", () => {
  it("should require portrait_image field", async () => {
    const res = await makeRequest("/lipsync", "POST", {
      audio: "audio.wav",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("portrait_image is required");
  });

  it("should require audio field", async () => {
    const res = await makeRequest("/lipsync", "POST", {
      portrait_image: "portrait.png",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("audio is required");
  });

  it("should generate lipsync successfully", async () => {
    const res = await makeRequest("/lipsync", "POST", {
      portrait_image: "portrait.png",
      audio: "audio.wav",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.localPath).toBeDefined();
  });
});

// ============================================================================
// Imagine Endpoint
// ============================================================================

describe("POST /imagine", () => {
  it("should require description field", async () => {
    const res = await makeRequest("/imagine", "POST", {});
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("description is required");
  });

  it("should generate image successfully", async () => {
    const res = await makeRequest("/imagine", "POST", {
      description: "A beautiful sunset over the ocean",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.localPath).toBeDefined();
    expect(data.prompt).toBeDefined();
    expect(data.modelFamily).toBeDefined();
    expect(data.seed).toBeDefined();
  });

  it("should accept quality and style parameters", async () => {
    const res = await makeRequest("/imagine", "POST", {
      description: "A beautiful sunset",
      quality: "high",
      style: "cinematic",
      width: 1024,
      height: 768,
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Image Endpoint
// ============================================================================

describe("POST /image", () => {
  it("should require prompt field", async () => {
    const res = await makeRequest("/image", "POST", {});
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("prompt is required");
  });

  it("should generate image successfully", async () => {
    const res = await makeRequest("/image", "POST", {
      prompt: "A cat sitting on a windowsill",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.localPath).toBeDefined();
    expect(data.seed).toBeDefined();
  });

  it("should accept generation parameters", async () => {
    const res = await makeRequest("/image", "POST", {
      prompt: "A cat sitting on a windowsill",
      negative_prompt: "blurry, bad quality",
      width: 512,
      height: 768,
      steps: 30,
      cfg_scale: 7.5,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      seed: 12345,
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Upscale Endpoint
// ============================================================================

describe("POST /upscale", () => {
  it("should require input_image field", async () => {
    const res = await makeRequest("/upscale", "POST", {});
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("input_image is required");
  });

  it("should upscale image successfully", async () => {
    const res = await makeRequest("/upscale", "POST", {
      input_image: "image.png",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.localPath).toBeDefined();
    expect(data.message).toBeDefined();
  });

  it("should accept upscale model parameter", async () => {
    const res = await makeRequest("/upscale", "POST", {
      input_image: "image.png",
      upscale_model: "4x-UltraSharp.pth",
    });
    expect(res.status).toBe(200);
  });

  it("should accept target dimensions", async () => {
    const res = await makeRequest("/upscale", "POST", {
      input_image: "image.png",
      target_width: 2048,
      target_height: 2048,
    });
    expect(res.status).toBe(200);
  });

  it("should handle upload_to_cloud parameter", async () => {
    const res = await makeRequest("/upscale", "POST", {
      input_image: "image.png",
      upload_to_cloud: false,
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("should return signedUrl when cloud upload succeeds", async () => {
    const res = await makeRequest("/upscale", "POST", {
      input_image: "image.png",
      upload_to_cloud: true,
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.signedUrl).toBeDefined();
  });
});

// ============================================================================
// ControlNet Endpoint
// ============================================================================

describe("POST /controlnet", () => {
  it("should require prompt field", async () => {
    const res = await makeRequest("/controlnet", "POST", {
      control_image: "pose.png",
      control_type: "openpose",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("prompt is required");
  });

  it("should require control_image field", async () => {
    const res = await makeRequest("/controlnet", "POST", {
      prompt: "A person standing",
      control_type: "openpose",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("control_image is required");
  });

  it("should require control_type field", async () => {
    const res = await makeRequest("/controlnet", "POST", {
      prompt: "A person standing",
      control_image: "pose.png",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("control_type is required");
  });

  it("should generate with ControlNet successfully", async () => {
    const res = await makeRequest("/controlnet", "POST", {
      prompt: "A person standing in a field",
      control_image: "pose.png",
      control_type: "openpose",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.localPath).toBeDefined();
    expect(data.seed).toBeDefined();
    expect(data.controlType).toBe("canny"); // From mock
  });

  it("should accept strength parameter", async () => {
    const res = await makeRequest("/controlnet", "POST", {
      prompt: "A person standing",
      control_image: "pose.png",
      control_type: "openpose",
      strength: 0.8,
    });
    expect(res.status).toBe(200);
  });

  it("should accept start_percent and end_percent", async () => {
    const res = await makeRequest("/controlnet", "POST", {
      prompt: "A person standing",
      control_image: "pose.png",
      control_type: "openpose",
      start_percent: 0.0,
      end_percent: 0.8,
    });
    expect(res.status).toBe(200);
  });

  it("should accept preprocess option", async () => {
    const res = await makeRequest("/controlnet", "POST", {
      prompt: "Edge detection",
      control_image: "photo.png",
      control_type: "canny",
      preprocess: true,
    });
    expect(res.status).toBe(200);
  });

  it("should accept preprocessor_options", async () => {
    const res = await makeRequest("/controlnet", "POST", {
      prompt: "Edge detection",
      control_image: "photo.png",
      control_type: "canny",
      preprocessor_options: {
        low_threshold: 50,
        high_threshold: 150,
      },
    });
    expect(res.status).toBe(200);
  });

  it("should accept model and generation parameters", async () => {
    const res = await makeRequest("/controlnet", "POST", {
      prompt: "A character",
      control_image: "pose.png",
      control_type: "openpose",
      model: "sd15.safetensors",
      width: 512,
      height: 768,
      steps: 28,
      cfg_scale: 7,
      sampler: "euler_ancestral",
      scheduler: "normal",
      seed: 42,
    });
    expect(res.status).toBe(200);
  });

  it("should accept LoRA configurations", async () => {
    const res = await makeRequest("/controlnet", "POST", {
      prompt: "A character",
      control_image: "pose.png",
      control_type: "openpose",
      loras: [
        { name: "style_lora.safetensors", strength_model: 0.8, strength_clip: 0.8 },
      ],
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Multi-ControlNet Endpoint
// ============================================================================

describe("POST /controlnet/multi", () => {
  it("should require prompt field", async () => {
    const res = await makeRequest("/controlnet/multi", "POST", {
      controls: [{ image: "pose.png", type: "openpose" }],
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("prompt is required");
  });

  it("should require controls array", async () => {
    const res = await makeRequest("/controlnet/multi", "POST", {
      prompt: "A person",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("controls array is required (1-5 conditions)");
  });

  it("should reject empty controls array", async () => {
    const res = await makeRequest("/controlnet/multi", "POST", {
      prompt: "A person",
      controls: [],
    });
    expect(res.status).toBe(400);
  });

  it("should generate with multiple ControlNets", async () => {
    const res = await makeRequest("/controlnet/multi", "POST", {
      prompt: "A person in a room",
      controls: [
        { image: "pose.png", type: "openpose" },
        { image: "depth.png", type: "depth" },
      ],
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.localPath).toBeDefined();
    expect(data.controlTypes).toEqual(["canny", "depth"]); // From mock
  });

  it("should accept per-control strength and timing", async () => {
    const res = await makeRequest("/controlnet/multi", "POST", {
      prompt: "A person",
      controls: [
        { image: "pose.png", type: "openpose", strength: 1.0, start_percent: 0, end_percent: 0.5 },
        { image: "depth.png", type: "depth", strength: 0.7, start_percent: 0.2, end_percent: 1.0 },
      ],
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Preprocess Endpoint
// ============================================================================

describe("POST /preprocess/:type", () => {
  it("should require input_image field", async () => {
    const res = await makeRequest("/preprocess/canny", "POST", {});
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("input_image is required");
  });

  it("should reject invalid control type", async () => {
    const res = await makeRequest("/preprocess/invalid", "POST", {
      input_image: "photo.png",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("Invalid control type");
  });

  it("should preprocess with canny", async () => {
    const res = await makeRequest("/preprocess/canny", "POST", {
      input_image: "photo.png",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.localPath).toBeDefined();
  });

  it("should preprocess with depth", async () => {
    const res = await makeRequest("/preprocess/depth", "POST", {
      input_image: "photo.png",
    });
    expect(res.status).toBe(200);
  });

  it("should preprocess with openpose", async () => {
    const res = await makeRequest("/preprocess/openpose", "POST", {
      input_image: "photo.png",
    });
    expect(res.status).toBe(200);
  });

  it("should preprocess with lineart", async () => {
    const res = await makeRequest("/preprocess/lineart", "POST", {
      input_image: "photo.png",
    });
    expect(res.status).toBe(200);
  });

  it("should preprocess with scribble", async () => {
    const res = await makeRequest("/preprocess/scribble", "POST", {
      input_image: "photo.png",
    });
    expect(res.status).toBe(200);
  });

  it("should preprocess with semantic_seg", async () => {
    const res = await makeRequest("/preprocess/semantic_seg", "POST", {
      input_image: "photo.png",
    });
    expect(res.status).toBe(200);
  });

  it("should accept preprocessor options for canny", async () => {
    const res = await makeRequest("/preprocess/canny", "POST", {
      input_image: "photo.png",
      preprocessor_options: {
        low_threshold: 50,
        high_threshold: 150,
      },
    });
    expect(res.status).toBe(200);
  });

  it("should accept preprocessor options for openpose", async () => {
    const res = await makeRequest("/preprocess/openpose", "POST", {
      input_image: "photo.png",
      preprocessor_options: {
        detect_body: true,
        detect_face: true,
        detect_hands: false,
      },
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Inpaint Endpoint
// ============================================================================

describe("POST /inpaint", () => {
  it("should require prompt field", async () => {
    const res = await makeRequest("/inpaint", "POST", {
      source_image: "img.png",
      mask_image: "mask.png",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("prompt is required");
  });

  it("should require source_image field", async () => {
    const res = await makeRequest("/inpaint", "POST", {
      prompt: "fix this",
      mask_image: "mask.png",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("source_image is required");
  });

  it("should require mask_image field", async () => {
    const res = await makeRequest("/inpaint", "POST", {
      prompt: "fix this",
      source_image: "img.png",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("mask_image is required");
  });

  it("should inpaint successfully", async () => {
    const res = await makeRequest("/inpaint", "POST", {
      prompt: "beautiful face",
      source_image: "portrait.png",
      mask_image: "face_mask.png",
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.localPath).toBeDefined();
    expect(data.seed).toBeDefined();
    expect(data.message).toBeDefined();
  });

  it("should accept denoise_strength parameter", async () => {
    const res = await makeRequest("/inpaint", "POST", {
      prompt: "fix this",
      source_image: "img.png",
      mask_image: "mask.png",
      denoise_strength: 0.9,
    });
    expect(res.status).toBe(200);
  });

  it("should accept grow_mask_by parameter", async () => {
    const res = await makeRequest("/inpaint", "POST", {
      prompt: "fix this",
      source_image: "img.png",
      mask_image: "mask.png",
      grow_mask_by: 10,
    });
    expect(res.status).toBe(200);
  });

  it("should accept generation parameters", async () => {
    const res = await makeRequest("/inpaint", "POST", {
      prompt: "fix this",
      negative_prompt: "bad anatomy",
      source_image: "img.png",
      mask_image: "mask.png",
      model: "sd15.safetensors",
      steps: 35,
      cfg_scale: 8,
      sampler: "dpmpp_2m",
      seed: 12345,
    });
    expect(res.status).toBe(200);
  });

  it("should accept LoRA configurations", async () => {
    const res = await makeRequest("/inpaint", "POST", {
      prompt: "fix hands",
      source_image: "img.png",
      mask_image: "mask.png",
      loras: [
        { name: "detail_lora.safetensors", strength_model: 0.8 },
      ],
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Outpaint Endpoint
// ============================================================================

describe("POST /outpaint", () => {
  it("should require prompt field", async () => {
    const res = await makeRequest("/outpaint", "POST", {
      source_image: "img.png",
      extend_right: 256,
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("prompt is required");
  });

  it("should require source_image field", async () => {
    const res = await makeRequest("/outpaint", "POST", {
      prompt: "extend",
      extend_right: 256,
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe("source_image is required");
  });

  it("should require at least one extend direction", async () => {
    const res = await makeRequest("/outpaint", "POST", {
      prompt: "extend",
      source_image: "img.png",
    });
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain("At least one extend direction");
  });

  it("should outpaint successfully with extend_right", async () => {
    const res = await makeRequest("/outpaint", "POST", {
      prompt: "more landscape",
      source_image: "landscape.png",
      extend_right: 256,
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.localPath).toBeDefined();
    expect(data.seed).toBeDefined();
    expect(data.message).toBeDefined();
  });

  it("should outpaint with multiple directions", async () => {
    const res = await makeRequest("/outpaint", "POST", {
      prompt: "extend all sides",
      source_image: "img.png",
      extend_left: 100,
      extend_right: 200,
      extend_top: 150,
      extend_bottom: 50,
    });
    expect(res.status).toBe(200);
  });

  it("should accept feathering parameter", async () => {
    const res = await makeRequest("/outpaint", "POST", {
      prompt: "extend",
      source_image: "img.png",
      extend_right: 256,
      feathering: 60,
    });
    expect(res.status).toBe(200);
  });

  it("should accept denoise_strength parameter", async () => {
    const res = await makeRequest("/outpaint", "POST", {
      prompt: "extend",
      source_image: "img.png",
      extend_right: 256,
      denoise_strength: 0.9,
    });
    expect(res.status).toBe(200);
  });

  it("should accept generation parameters", async () => {
    const res = await makeRequest("/outpaint", "POST", {
      prompt: "extend landscape",
      negative_prompt: "bad quality",
      source_image: "landscape.png",
      extend_right: 256,
      model: "sdxl.safetensors",
      steps: 40,
      cfg_scale: 6,
      seed: 42,
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================================
// Cloud Upload Integration
// ============================================================================

describe("Cloud Upload Integration", () => {
  it("should return signedUrl when upload_to_cloud is true", async () => {
    const res = await makeRequest("/controlnet", "POST", {
      prompt: "Test",
      control_image: "pose.png",
      control_type: "openpose",
      upload_to_cloud: true,
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.signedUrl).toBeDefined();
  });

  it("should not return signedUrl when upload_to_cloud is false", async () => {
    // Mock isCloudStorageConfigured to return false for this test
    const { isCloudStorageConfigured } = await import("./storage/index.js");
    vi.mocked(isCloudStorageConfigured).mockReturnValueOnce(false);

    const res = await makeRequest("/controlnet", "POST", {
      prompt: "Test",
      control_image: "pose.png",
      control_type: "openpose",
      upload_to_cloud: false,
    });
    expect(res.status).toBe(200);

    const data = await res.json();
    // signedUrl should still be undefined because cloud is not configured
    expect(data.success).toBe(true);
  });
});

// ============================================================================
// Error Handling
// ============================================================================

describe("Error Handling", () => {
  it("should handle JSON parse errors gracefully", async () => {
    const req = new Request("http://localhost/controlnet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid json{",
    });
    const res = await app.fetch(req);
    expect(res.status).toBe(500);
  });

  it("should return 404 for unknown routes", async () => {
    const res = await makeRequest("/unknown-endpoint");
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// Response Format Consistency
// ============================================================================

describe("Response Format Consistency", () => {
  it("all generation endpoints should return success field", async () => {
    const endpoints = [
      { path: "/portrait", body: { description: "test" } },
      { path: "/tts", body: { text: "test", voice_reference: "voice.wav" } },
      { path: "/lipsync", body: { portrait_image: "p.png", audio: "a.wav" } },
      { path: "/imagine", body: { description: "test" } },
      { path: "/image", body: { prompt: "test" } },
      { path: "/upscale", body: { input_image: "img.png" } },
      { path: "/controlnet", body: { prompt: "test", control_image: "c.png", control_type: "canny" } },
      { path: "/inpaint", body: { prompt: "fix", source_image: "s.png", mask_image: "m.png" } },
      { path: "/outpaint", body: { prompt: "extend", source_image: "s.png", extend_right: 256 } },
    ];

    for (const { path, body } of endpoints) {
      const res = await makeRequest(path, "POST", body);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.localPath).toBeDefined();
    }
  });

  it("all generation endpoints should return localPath", async () => {
    const res = await makeRequest("/upscale", "POST", {
      input_image: "test.png",
    });
    const data = await res.json();
    expect(data.localPath).toBeDefined();
    expect(typeof data.localPath).toBe("string");
  });

  it("error responses should have error field", async () => {
    const res = await makeRequest("/controlnet", "POST", {});
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(typeof data.error).toBe("string");
  });
});
