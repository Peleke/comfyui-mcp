import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateImage, img2img, generateImageSchema, img2imgSchema } from "./generate.js";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  createMockFetch,
  mockHistoryComplete,
  mockImageBuffer,
  mockQueuePromptResponse,
} from "../__mocks__/comfyui-responses.js";
import { rm, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

// Mock the file system operations
vi.mock("fs/promises", async () => {
  const actual = await vi.importActual("fs/promises");
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe("generateImage", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({
      url: "http://localhost:8188",
      outputDir: "/tmp/test-output",
    });

    // Mock waitForCompletion to avoid WebSocket issues in tests
    vi.spyOn(client, "waitForCompletion").mockResolvedValue(
      mockHistoryComplete["test-prompt-id-12345"]
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should generate an image successfully", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const result = await generateImage(
      client,
      {
        prompt: "a beautiful sunset",
        output_path: "/tmp/test/output.png",
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "dreamshaper_8.safetensors"
    );

    expect(result.success).toBe(true);
    expect(result.path).toBe("/tmp/test/output.png");
    expect(typeof result.seed).toBe("number");
    expect(result.message).toContain("Image generated");
  });

  it("should use provided model over default", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await generateImage(
      client,
      {
        prompt: "test",
        output_path: "/tmp/test.png",
        model: "custom_model.safetensors",
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "default_model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["4"].inputs.ckpt_name).toBe("custom_model.safetensors");
  });

  it("should use default model when not specified", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await generateImage(
      client,
      {
        prompt: "test",
        output_path: "/tmp/test.png",
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "default_model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["4"].inputs.ckpt_name).toBe("default_model.safetensors");
  });

  it("should throw error when no model specified and no default", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    await expect(
      generateImage(
        client,
        {
          prompt: "test",
          output_path: "/tmp/test.png",
          width: 512,
          height: 768,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "" // No default model
      )
    ).rejects.toThrow("No model specified and COMFYUI_MODEL not set");
  });

  it("should use provided seed", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await generateImage(
      client,
      {
        prompt: "test",
        output_path: "/tmp/test.png",
        seed: 42,
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["3"].inputs.seed).toBe(42);
  });

  it("should include LoRAs in workflow", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await generateImage(
      client,
      {
        prompt: "test",
        output_path: "/tmp/test.png",
        loras: [
          { name: "style.safetensors", strength_model: 0.8, strength_clip: 0.6 },
        ],
        width: 512,
        height: 768,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["lora_0"]).toBeDefined();
    expect(calledWorkflow["lora_0"].inputs.lora_name).toBe("style.safetensors");
  });
});

describe("img2img", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({
      url: "http://localhost:8188",
      outputDir: "/tmp/test-output",
    });

    vi.spyOn(client, "waitForCompletion").mockResolvedValue(
      mockHistoryComplete["test-prompt-id-12345"]
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should perform img2img successfully", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const result = await img2img(
      client,
      {
        prompt: "enhanced version",
        input_image: "input.png",
        output_path: "/tmp/test/output.png",
        denoise: 0.75,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "dreamshaper_8.safetensors"
    );

    expect(result.success).toBe(true);
    expect(result.path).toBe("/tmp/test/output.png");
    expect(result.message).toContain("img2img");
  });

  it("should set denoise value in workflow", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await img2img(
      client,
      {
        prompt: "test",
        input_image: "input.png",
        output_path: "/tmp/test.png",
        denoise: 0.5,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["3"].inputs.denoise).toBe(0.5);
  });

  it("should set input image in workflow", async () => {
    global.fetch = createMockFetch() as typeof fetch;
    const queueSpy = vi.spyOn(client, "queuePrompt");

    await img2img(
      client,
      {
        prompt: "test",
        input_image: "my_image.png",
        output_path: "/tmp/test.png",
        denoise: 0.75,
        steps: 28,
        cfg_scale: 7,
        sampler: "euler_ancestral",
        scheduler: "normal",
      },
      "model.safetensors"
    );

    const calledWorkflow = queueSpy.mock.calls[0][0];
    expect(calledWorkflow["1"].inputs.image).toBe("my_image.png");
  });
});

describe("generateImageSchema", () => {
  it("should validate valid input", () => {
    const input = {
      prompt: "a test prompt",
      output_path: "/tmp/test.png",
    };

    const result = generateImageSchema.parse(input);

    expect(result.prompt).toBe("a test prompt");
    expect(result.output_path).toBe("/tmp/test.png");
    expect(result.width).toBe(512); // default
    expect(result.height).toBe(768); // default
    expect(result.steps).toBe(28); // default
    expect(result.cfg_scale).toBe(7); // default
    expect(result.sampler).toBe("euler_ancestral"); // default
    expect(result.scheduler).toBe("normal"); // default
  });

  it("should reject missing prompt", () => {
    expect(() =>
      generateImageSchema.parse({
        output_path: "/tmp/test.png",
      })
    ).toThrow();
  });

  it("should reject missing output_path", () => {
    expect(() =>
      generateImageSchema.parse({
        prompt: "test",
      })
    ).toThrow();
  });

  it("should validate LoRA schema", () => {
    const input = {
      prompt: "test",
      output_path: "/tmp/test.png",
      loras: [
        { name: "style.safetensors" },
        { name: "char.safetensors", strength_model: 0.8, strength_clip: 0.6 },
      ],
    };

    const result = generateImageSchema.parse(input);

    expect(result.loras).toHaveLength(2);
    expect(result.loras![0].name).toBe("style.safetensors");
    expect(result.loras![0].strength_model).toBe(1.0); // default
    expect(result.loras![1].strength_model).toBe(0.8);
  });
});

describe("img2imgSchema", () => {
  it("should validate valid input", () => {
    const input = {
      prompt: "test",
      input_image: "input.png",
      output_path: "/tmp/test.png",
    };

    const result = img2imgSchema.parse(input);

    expect(result.prompt).toBe("test");
    expect(result.input_image).toBe("input.png");
    expect(result.denoise).toBe(0.75); // default
  });

  it("should reject missing input_image", () => {
    expect(() =>
      img2imgSchema.parse({
        prompt: "test",
        output_path: "/tmp/test.png",
      })
    ).toThrow();
  });
});
