import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  inpaint,
  inpaintSchema,
  outpaint,
  outpaintSchema,
  createMask,
  createMaskSchema,
} from "./inpaint.js";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  createMockFetch,
  mockHistoryComplete,
} from "../__mocks__/comfyui-responses.js";

// Mock the file system operations
vi.mock("fs/promises", async () => {
  const actual = await vi.importActual("fs/promises");
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock storage module
vi.mock("../storage/index.js", () => ({
  isCloudStorageConfigured: vi.fn().mockReturnValue(false),
  getStorageProvider: vi.fn(),
  generateRemotePath: vi.fn(),
}));

// ===========================================================================
// INPAINT TOOL TESTS
// ===========================================================================

describe("inpaint", () => {
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

  describe("basic inpainting", () => {
    it("should inpaint an image successfully", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await inpaint(
        client,
        {
          prompt: "detailed furry paws with five fingers",
          source_image: "character.png",
          mask_image: "hands_mask.png",
          output_path: "/tmp/test/inpaint_output.png",
          denoise_strength: 0.75,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "dreamshaper_8.safetensors"
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe("/tmp/test/inpaint_output.png");
      expect(typeof result.seed).toBe("number");
      expect(result.message).toContain("Inpainted");
    });

    it("should use default denoise strength of 0.75", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "fix hands",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["8"].inputs.denoise).toBe(0.75);
    });

    it("should use provided denoise strength", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "fix hands",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          denoise_strength: 0.5,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["8"].inputs.denoise).toBe(0.5);
    });
  });

  describe("image handling", () => {
    it("should set source image correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "test",
          source_image: "my_character.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["1"].inputs.image).toBe("my_character.png");
    });

    it("should set mask image correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          mask_image: "my_custom_mask.png",
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["2"].inputs.image).toBe("my_custom_mask.png");
    });
  });

  describe("model handling", () => {
    it("should use provided model", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          model: "custom_model.safetensors",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "default_model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["3"].inputs.ckpt_name).toBe("custom_model.safetensors");
    });

    it("should use default model when not specified", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "default_model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["3"].inputs.ckpt_name).toBe("default_model.safetensors");
    });

    it("should throw error when no model available", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      await expect(
        inpaint(
          client,
          {
            prompt: "test",
            source_image: "source.png",
            mask_image: "mask.png",
            output_path: "/tmp/test.png",
            steps: 28,
            cfg_scale: 7,
            sampler: "euler_ancestral",
            scheduler: "normal",
          },
          ""
        )
      ).rejects.toThrow("No model specified");
    });
  });

  describe("sampler parameters", () => {
    it("should use provided steps", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          steps: 50,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["8"].inputs.steps).toBe(50);
    });

    it("should use provided cfg_scale", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 12,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["8"].inputs.cfg).toBe(12);
    });

    it("should use provided sampler", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "dpmpp_2m",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["8"].inputs.sampler_name).toBe("dpmpp_2m");
    });

    it("should use provided scheduler", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "karras",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["8"].inputs.scheduler).toBe("karras");
    });

    it("should use provided seed", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
          seed: 42,
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["8"].inputs.seed).toBe(42);
    });

    it("should generate random seed when not provided", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(typeof calledWorkflow["8"].inputs.seed).toBe("number");
      expect(calledWorkflow["8"].inputs.seed).toBeGreaterThanOrEqual(0);
    });
  });

  describe("prompt handling", () => {
    it("should set positive prompt", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "detailed furry paws, five fingers",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["6"].inputs.text).toBe("detailed furry paws, five fingers");
    });

    it("should set negative prompt when provided", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "fix hands",
          negative_prompt: "bad anatomy, extra fingers",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["7"].inputs.text).toBe("bad anatomy, extra fingers");
    });

    it("should use default negative prompt when not provided", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "fix hands",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["7"].inputs.text).toContain("bad quality");
    });
  });

  describe("LoRA integration", () => {
    it("should inject single LoRA", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
          loras: [{ name: "style_lora.safetensors", strength_model: 0.8, strength_clip: 0.8 }],
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["lora_0"]).toBeDefined();
      expect(calledWorkflow["lora_0"].inputs.lora_name).toBe("style_lora.safetensors");
    });

    it("should inject multiple LoRAs", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
          loras: [
            { name: "lora1.safetensors", strength_model: 0.8, strength_clip: 0.8 },
            { name: "lora2.safetensors", strength_model: 0.5, strength_clip: 0.5 },
          ],
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["lora_0"]).toBeDefined();
      expect(calledWorkflow["lora_1"]).toBeDefined();
    });
  });

  describe("denoise strength edge cases", () => {
    it("should handle minimum denoise strength (0)", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          denoise_strength: 0,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["8"].inputs.denoise).toBe(0);
    });

    it("should handle maximum denoise strength (1)", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await inpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          denoise_strength: 1,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["8"].inputs.denoise).toBe(1);
    });
  });
});

// ===========================================================================
// INPAINT SCHEMA TESTS
// ===========================================================================

describe("inpaintSchema", () => {
  describe("required fields", () => {
    it("should require prompt", () => {
      expect(() =>
        inpaintSchema.parse({
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
        })
      ).toThrow();
    });

    it("should require source_image", () => {
      expect(() =>
        inpaintSchema.parse({
          prompt: "test",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
        })
      ).toThrow();
    });

    it("should require mask_image", () => {
      expect(() =>
        inpaintSchema.parse({
          prompt: "test",
          source_image: "source.png",
          output_path: "/tmp/test.png",
        })
      ).toThrow();
    });

    it("should require output_path", () => {
      expect(() =>
        inpaintSchema.parse({
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
        })
      ).toThrow();
    });
  });

  describe("default values", () => {
    it("should default denoise_strength to 0.75", () => {
      const parsed = inpaintSchema.parse({
        prompt: "test",
        source_image: "source.png",
        mask_image: "mask.png",
        output_path: "/tmp/test.png",
      });
      expect(parsed.denoise_strength).toBe(0.75);
    });

    it("should default steps to 28", () => {
      const parsed = inpaintSchema.parse({
        prompt: "test",
        source_image: "source.png",
        mask_image: "mask.png",
        output_path: "/tmp/test.png",
      });
      expect(parsed.steps).toBe(28);
    });

    it("should default cfg_scale to 7", () => {
      const parsed = inpaintSchema.parse({
        prompt: "test",
        source_image: "source.png",
        mask_image: "mask.png",
        output_path: "/tmp/test.png",
      });
      expect(parsed.cfg_scale).toBe(7);
    });
  });

  describe("validation", () => {
    it("should reject denoise_strength > 1", () => {
      expect(() =>
        inpaintSchema.parse({
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          denoise_strength: 1.5,
        })
      ).toThrow();
    });

    it("should reject denoise_strength < 0", () => {
      expect(() =>
        inpaintSchema.parse({
          prompt: "test",
          source_image: "source.png",
          mask_image: "mask.png",
          output_path: "/tmp/test.png",
          denoise_strength: -0.1,
        })
      ).toThrow();
    });
  });
});

// ===========================================================================
// OUTPAINT TOOL TESTS
// ===========================================================================

describe("outpaint", () => {
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

  describe("basic outpainting", () => {
    it("should outpaint an image successfully", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await outpaint(
        client,
        {
          prompt: "forest background, trees, nature",
          source_image: "portrait.png",
          extend_right: 256,
          output_path: "/tmp/test/outpaint_output.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "dreamshaper_8.safetensors"
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe("/tmp/test/outpaint_output.png");
      expect(result.extensions.right).toBe(256);
      expect(result.message).toContain("Outpainted");
    });

    it("should return extension information", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await outpaint(
        client,
        {
          prompt: "background",
          source_image: "source.png",
          extend_left: 128,
          extend_right: 256,
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      expect(result.extensions).toEqual({
        left: 128,
        right: 256,
        top: 0,
        bottom: 0,
      });
    });
  });

  describe("direction extensions", () => {
    it("should extend left", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await outpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          extend_left: 200,
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["2"].inputs.left).toBe(200);
    });

    it("should extend right", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await outpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          extend_right: 300,
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["2"].inputs.right).toBe(300);
    });

    it("should extend top", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await outpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          extend_top: 150,
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["2"].inputs.top).toBe(150);
    });

    it("should extend bottom", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await outpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          extend_bottom: 100,
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["2"].inputs.bottom).toBe(100);
    });

    it("should extend multiple directions", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await outpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          extend_left: 64,
          extend_right: 64,
          extend_top: 32,
          extend_bottom: 32,
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["2"].inputs.left).toBe(64);
      expect(calledWorkflow["2"].inputs.right).toBe(64);
      expect(calledWorkflow["2"].inputs.top).toBe(32);
      expect(calledWorkflow["2"].inputs.bottom).toBe(32);
    });
  });

  describe("feathering", () => {
    it("should use default feathering of 40", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await outpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          extend_right: 100,
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["2"].inputs.feathering).toBe(40);
    });

    it("should use provided feathering", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await outpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          extend_right: 100,
          feathering: 60,
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["2"].inputs.feathering).toBe(60);
    });
  });

  describe("denoise strength", () => {
    it("should use default denoise of 0.8 for outpaint", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await outpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          extend_right: 100,
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["8"].inputs.denoise).toBe(0.8);
    });

    it("should use provided denoise strength", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await outpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          extend_right: 100,
          denoise_strength: 0.9,
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["8"].inputs.denoise).toBe(0.9);
    });
  });

  describe("error handling", () => {
    it("should throw when no extension specified", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      await expect(
        outpaint(
          client,
          {
            prompt: "test",
            source_image: "source.png",
            output_path: "/tmp/test.png",
            steps: 28,
            cfg_scale: 7,
            sampler: "euler_ancestral",
            scheduler: "normal",
          },
          "model.safetensors"
        )
      ).rejects.toThrow("Must extend at least one direction");
    });

    it("should throw when all extensions are 0", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      await expect(
        outpaint(
          client,
          {
            prompt: "test",
            source_image: "source.png",
            extend_left: 0,
            extend_right: 0,
            extend_top: 0,
            extend_bottom: 0,
            output_path: "/tmp/test.png",
            steps: 28,
            cfg_scale: 7,
            sampler: "euler_ancestral",
            scheduler: "normal",
          },
          "model.safetensors"
        )
      ).rejects.toThrow("Must extend at least one direction");
    });

    it("should throw when no model available", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      await expect(
        outpaint(
          client,
          {
            prompt: "test",
            source_image: "source.png",
            extend_right: 100,
            output_path: "/tmp/test.png",
            steps: 28,
            cfg_scale: 7,
            sampler: "euler_ancestral",
            scheduler: "normal",
          },
          ""
        )
      ).rejects.toThrow("No model specified");
    });
  });

  describe("LoRA integration", () => {
    it("should inject LoRAs for outpaint", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await outpaint(
        client,
        {
          prompt: "test",
          source_image: "source.png",
          extend_right: 100,
          output_path: "/tmp/test.png",
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
          loras: [{ name: "bg_lora.safetensors", strength_model: 0.7, strength_clip: 0.7 }],
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["lora_0"]).toBeDefined();
      expect(calledWorkflow["lora_0"].inputs.lora_name).toBe("bg_lora.safetensors");
    });
  });
});

// ===========================================================================
// OUTPAINT SCHEMA TESTS
// ===========================================================================

describe("outpaintSchema", () => {
  describe("required fields", () => {
    it("should require prompt", () => {
      expect(() =>
        outpaintSchema.parse({
          source_image: "source.png",
          extend_right: 100,
          output_path: "/tmp/test.png",
        })
      ).toThrow();
    });

    it("should require source_image", () => {
      expect(() =>
        outpaintSchema.parse({
          prompt: "test",
          extend_right: 100,
          output_path: "/tmp/test.png",
        })
      ).toThrow();
    });

    it("should require output_path", () => {
      expect(() =>
        outpaintSchema.parse({
          prompt: "test",
          source_image: "source.png",
          extend_right: 100,
        })
      ).toThrow();
    });
  });

  describe("default values", () => {
    it("should default all extensions to 0", () => {
      const parsed = outpaintSchema.parse({
        prompt: "test",
        source_image: "source.png",
        output_path: "/tmp/test.png",
      });
      expect(parsed.extend_left).toBe(0);
      expect(parsed.extend_right).toBe(0);
      expect(parsed.extend_top).toBe(0);
      expect(parsed.extend_bottom).toBe(0);
    });

    it("should default feathering to 40", () => {
      const parsed = outpaintSchema.parse({
        prompt: "test",
        source_image: "source.png",
        output_path: "/tmp/test.png",
      });
      expect(parsed.feathering).toBe(40);
    });

    it("should default denoise_strength to 0.8", () => {
      const parsed = outpaintSchema.parse({
        prompt: "test",
        source_image: "source.png",
        output_path: "/tmp/test.png",
      });
      expect(parsed.denoise_strength).toBe(0.8);
    });
  });

  describe("validation", () => {
    it("should reject negative extension values", () => {
      expect(() =>
        outpaintSchema.parse({
          prompt: "test",
          source_image: "source.png",
          extend_left: -10,
          output_path: "/tmp/test.png",
        })
      ).toThrow();
    });
  });
});

// ===========================================================================
// CREATE_MASK TOOL TESTS
// ===========================================================================

describe("createMask", () => {
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

  describe("preset-based masks", () => {
    it("should create mask with hands preset", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      const result = await createMask(client, {
        source_image: "character.png",
        preset: "hands",
        output_path: "/tmp/test/mask.png",
      });

      expect(result.success).toBe(true);
      expect(result.method).toBe("preset");
      expect(result.message).toContain('preset "hands"');

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["4"].inputs.prompt).toContain("hand");
    });

    it("should create mask with face preset", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await createMask(client, {
        source_image: "character.png",
        preset: "face",
        output_path: "/tmp/test/mask.png",
      });

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["4"].inputs.prompt).toContain("face");
    });

    it("should create mask with eyes preset", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await createMask(client, {
        source_image: "character.png",
        preset: "eyes",
        output_path: "/tmp/test/mask.png",
      });

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["4"].inputs.prompt).toContain("eye");
    });

    it("should create mask with body preset", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await createMask(client, {
        source_image: "character.png",
        preset: "body",
        output_path: "/tmp/test/mask.png",
      });

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["4"].inputs.prompt).toContain("body");
    });

    it("should create mask with background preset", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await createMask(client, {
        source_image: "character.png",
        preset: "background",
        output_path: "/tmp/test/mask.png",
      });

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["4"].inputs.prompt).toContain("background");
    });

    it("should create mask with foreground preset", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await createMask(client, {
        source_image: "character.png",
        preset: "foreground",
        output_path: "/tmp/test/mask.png",
      });

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["4"].inputs.prompt).toContain("subject");
    });
  });

  describe("text prompt masks", () => {
    it("should create mask with custom text prompt", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      const result = await createMask(client, {
        source_image: "image.png",
        text_prompt: "red shirt",
        output_path: "/tmp/test/mask.png",
      });

      expect(result.success).toBe(true);
      expect(result.method).toBe("text_prompt");
      expect(result.message).toContain('text prompt "red shirt"');

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["4"].inputs.prompt).toBe("red shirt");
    });

    it("should handle complex text prompts", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await createMask(client, {
        source_image: "image.png",
        text_prompt: "orange cat sitting on a blue chair",
        output_path: "/tmp/test/mask.png",
      });

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["4"].inputs.prompt).toBe("orange cat sitting on a blue chair");
    });
  });

  describe("region-based masks", () => {
    it("should create mask with manual region", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await createMask(client, {
        source_image: "image.png",
        region: { x: 25, y: 25, width: 50, height: 50 },
        output_path: "/tmp/test/mask.png",
      });

      expect(result.success).toBe(true);
      expect(result.method).toBe("region");
      expect(result.message).toContain("manual region");
    });
  });

  describe("mask processing options", () => {
    it("should expand mask when expand_pixels specified", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await createMask(client, {
        source_image: "image.png",
        preset: "face",
        expand_pixels: 20,
        output_path: "/tmp/test/mask.png",
      });

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["5"]).toBeDefined();
      expect(calledWorkflow["5"].class_type).toBe("GrowMask");
      expect(calledWorkflow["5"].inputs.expand).toBe(20);
    });

    it("should feather mask when feather_pixels specified", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await createMask(client, {
        source_image: "image.png",
        preset: "face",
        feather_pixels: 10,
        output_path: "/tmp/test/mask.png",
      });

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["6"]).toBeDefined();
      expect(calledWorkflow["6"].class_type).toBe("FeatherMask");
    });

    it("should invert mask when invert is true", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await createMask(client, {
        source_image: "image.png",
        preset: "face",
        invert: true,
        output_path: "/tmp/test/mask.png",
      });

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["7"]).toBeDefined();
      expect(calledWorkflow["7"].class_type).toBe("InvertMask");
    });

    it("should chain expand, feather, and invert", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await createMask(client, {
        source_image: "image.png",
        preset: "face",
        expand_pixels: 15,
        feather_pixels: 8,
        invert: true,
        output_path: "/tmp/test/mask.png",
      });

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["5"]).toBeDefined(); // GrowMask
      expect(calledWorkflow["6"]).toBeDefined(); // FeatherMask
      expect(calledWorkflow["7"]).toBeDefined(); // InvertMask
    });
  });

  describe("model configuration", () => {
    it("should use default SAM model", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await createMask(client, {
        source_image: "image.png",
        preset: "face",
        output_path: "/tmp/test/mask.png",
      });

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["3"].inputs.model_name).toContain("sam_vit_h");
    });

    it("should use custom SAM model", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await createMask(client, {
        source_image: "image.png",
        preset: "face",
        sam_model: "sam_vit_b (375MB)",
        output_path: "/tmp/test/mask.png",
      });

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["3"].inputs.model_name).toBe("sam_vit_b (375MB)");
    });

    it("should use custom GroundingDINO model", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await createMask(client, {
        source_image: "image.png",
        preset: "face",
        grounding_dino_model: "GroundingDINO_SwinB (938MB)",
        output_path: "/tmp/test/mask.png",
      });

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["2"].inputs.model_name).toBe("GroundingDINO_SwinB (938MB)");
    });

    it("should use custom threshold", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await createMask(client, {
        source_image: "image.png",
        preset: "face",
        threshold: 0.5,
        output_path: "/tmp/test/mask.png",
      });

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["4"].inputs.threshold).toBe(0.5);
    });
  });

  describe("error handling", () => {
    it("should throw when no preset, text_prompt, or region specified", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      await expect(
        createMask(client, {
          source_image: "image.png",
          output_path: "/tmp/test/mask.png",
        })
      ).rejects.toThrow("Must specify one of: preset, text_prompt, or region");
    });
  });
});

// ===========================================================================
// CREATE_MASK SCHEMA TESTS
// ===========================================================================

describe("createMaskSchema", () => {
  describe("required fields", () => {
    it("should require source_image", () => {
      expect(() =>
        createMaskSchema.parse({
          preset: "face",
          output_path: "/tmp/test.png",
        })
      ).toThrow();
    });

    it("should require output_path", () => {
      expect(() =>
        createMaskSchema.parse({
          source_image: "image.png",
          preset: "face",
        })
      ).toThrow();
    });
  });

  describe("preset validation", () => {
    it("should accept valid presets", () => {
      const presets = ["hands", "face", "eyes", "body", "background", "foreground"];
      for (const preset of presets) {
        const parsed = createMaskSchema.parse({
          source_image: "image.png",
          preset,
          output_path: "/tmp/test.png",
        });
        expect(parsed.preset).toBe(preset);
      }
    });

    it("should reject invalid presets", () => {
      expect(() =>
        createMaskSchema.parse({
          source_image: "image.png",
          preset: "invalid_preset",
          output_path: "/tmp/test.png",
        })
      ).toThrow();
    });
  });

  describe("region validation", () => {
    it("should accept valid region", () => {
      const parsed = createMaskSchema.parse({
        source_image: "image.png",
        region: { x: 0, y: 0, width: 100, height: 100 },
        output_path: "/tmp/test.png",
      });
      expect(parsed.region).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    });

    it("should reject region with x > 100", () => {
      expect(() =>
        createMaskSchema.parse({
          source_image: "image.png",
          region: { x: 150, y: 0, width: 50, height: 50 },
          output_path: "/tmp/test.png",
        })
      ).toThrow();
    });

    it("should reject region with negative values", () => {
      expect(() =>
        createMaskSchema.parse({
          source_image: "image.png",
          region: { x: -10, y: 0, width: 50, height: 50 },
          output_path: "/tmp/test.png",
        })
      ).toThrow();
    });
  });

  describe("default values", () => {
    it("should default expand_pixels to 0", () => {
      const parsed = createMaskSchema.parse({
        source_image: "image.png",
        preset: "face",
        output_path: "/tmp/test.png",
      });
      expect(parsed.expand_pixels).toBe(0);
    });

    it("should default feather_pixels to 0", () => {
      const parsed = createMaskSchema.parse({
        source_image: "image.png",
        preset: "face",
        output_path: "/tmp/test.png",
      });
      expect(parsed.feather_pixels).toBe(0);
    });

    it("should default invert to false", () => {
      const parsed = createMaskSchema.parse({
        source_image: "image.png",
        preset: "face",
        output_path: "/tmp/test.png",
      });
      expect(parsed.invert).toBe(false);
    });

    it("should default threshold to 0.3", () => {
      const parsed = createMaskSchema.parse({
        source_image: "image.png",
        preset: "face",
        output_path: "/tmp/test.png",
      });
      expect(parsed.threshold).toBe(0.3);
    });
  });

  describe("threshold validation", () => {
    it("should reject threshold > 1", () => {
      expect(() =>
        createMaskSchema.parse({
          source_image: "image.png",
          preset: "face",
          threshold: 1.5,
          output_path: "/tmp/test.png",
        })
      ).toThrow();
    });

    it("should reject threshold < 0", () => {
      expect(() =>
        createMaskSchema.parse({
          source_image: "image.png",
          preset: "face",
          threshold: -0.1,
          output_path: "/tmp/test.png",
        })
      ).toThrow();
    });
  });
});
