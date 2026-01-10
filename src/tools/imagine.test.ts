import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { imagine, imagineSchema } from "./imagine.js";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  createMockFetch,
  mockHistoryComplete,
  mockImageBuffer,
} from "../__mocks__/comfyui-responses.js";

// Mock fs/promises
vi.mock("fs/promises", async () => {
  const actual = await vi.importActual("fs/promises");
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

describe("imagine", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({
      url: "http://localhost:8188",
      outputDir: "/tmp/test-output",
    });

    // Mock waitForCompletion
    vi.spyOn(client, "waitForCompletion").mockResolvedValue(
      mockHistoryComplete["test-prompt-id-12345"]
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("basic generation", () => {
    it("should generate image from natural language description", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await imagine(
        client,
        {
          description: "A beautiful sunset over the ocean with sailing boats",
          output_path: "/tmp/test/sunset.png",
          model: "dreamshaper_8.safetensors",
          quality: "standard",
          enable_hires_fix: false,
          hires_scale: 1.5,
          hires_denoise: 0.4,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
          auto_recommend_loras: false,
        },
        ""
      );

      expect(result.success).toBe(true);
      expect(result.imagePath).toBe("/tmp/test/sunset.png");
      expect(result.seed).toBeTypeOf("number");
      expect(result.prompt.positive).toContain("sunset");
      expect(result.pipelineSteps).toContain("txt2img");
    });

    it("should auto-detect model family", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await imagine(
        client,
        {
          description: "An anime character",
          output_path: "/tmp/test/anime.png",
          model: "illustriousXL_v10.safetensors",
          quality: "standard",
          enable_hires_fix: false,
          hires_scale: 1.5,
          hires_denoise: 0.4,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
          auto_recommend_loras: false,
        },
        ""
      );

      expect(result.success).toBe(true);
      expect(result.modelFamily).toBe("illustrious");
    });

    it("should use explicit model family when provided", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await imagine(
        client,
        {
          description: "A portrait",
          output_path: "/tmp/test/portrait.png",
          model: "some_model.safetensors",
          model_family: "flux",
          quality: "standard",
          enable_hires_fix: false,
          hires_scale: 1.5,
          hires_denoise: 0.4,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
          auto_recommend_loras: false,
        },
        ""
      );

      expect(result.success).toBe(true);
      expect(result.modelFamily).toBe("flux");
      // Flux should have empty negative prompt
      expect(result.prompt.negative).toBe("");
    });
  });

  describe("style presets", () => {
    it("should apply anime style", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await imagine(
        client,
        {
          description: "A girl with blue hair",
          output_path: "/tmp/test/anime.png",
          model: "illustriousXL.safetensors",
          style: "anime",
          quality: "standard",
          enable_hires_fix: false,
          hires_scale: 1.5,
          hires_denoise: 0.4,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
          auto_recommend_loras: false,
        },
        ""
      );

      expect(result.success).toBe(true);
      // Anime style keywords should be present
      const prompt = result.prompt.positive.toLowerCase();
      expect(prompt).toMatch(/anime|illustration|1girl/);
    });

    it("should apply cinematic style", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await imagine(
        client,
        {
          description: "A dramatic landscape",
          output_path: "/tmp/test/cinematic.png",
          model: "sdxl_base.safetensors",
          style: "cinematic",
          quality: "standard",
          enable_hires_fix: false,
          hires_scale: 1.5,
          hires_denoise: 0.4,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
          auto_recommend_loras: false,
        },
        ""
      );

      expect(result.success).toBe(true);
      const prompt = result.prompt.positive.toLowerCase();
      expect(prompt).toMatch(/cinematic|film|dramatic/);
    });
  });

  describe("quality presets", () => {
    it("should apply draft quality (fast, no pipeline)", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await imagine(
        client,
        {
          description: "Quick test",
          output_path: "/tmp/test/draft.png",
          model: "model.safetensors",
          quality: "draft",
          enable_hires_fix: false,
          hires_scale: 1.5,
          hires_denoise: 0.4,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
          auto_recommend_loras: false,
        },
        ""
      );

      expect(result.success).toBe(true);
      expect(result.pipelineSteps).toEqual(["txt2img"]);
    });

    it("should apply high quality (with hi-res fix)", async () => {
      global.fetch = vi.fn().mockImplementation(async (url, init) => {
        const urlStr = url.toString();

        if (urlStr.includes("/upload/image")) {
          return new Response(JSON.stringify({ name: "uploaded.png" }), {
            status: 200,
          });
        }

        if (urlStr.includes("/prompt") && init?.method === "POST") {
          return new Response(
            JSON.stringify({ prompt_id: "test-id", number: 1 }),
            { status: 200 }
          );
        }

        if (urlStr.includes("/view")) {
          return new Response(new Uint8Array(mockImageBuffer), { status: 200 });
        }

        return new Response("{}", { status: 200 });
      });

      const result = await imagine(
        client,
        {
          description: "High quality portrait",
          output_path: "/tmp/test/high.png",
          model: "model.safetensors",
          quality: "high",
          enable_hires_fix: true,
          hires_scale: 1.5,
          hires_denoise: 0.4,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
          auto_recommend_loras: false,
        },
        ""
      );

      expect(result.success).toBe(true);
      expect(result.pipelineSteps).toContain("txt2img");
      expect(result.pipelineSteps).toContain("hires_fix");
    });
  });

  describe("artist reference", () => {
    it("should include artist reference in prompt", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await imagine(
        client,
        {
          description: "A fantasy forest",
          output_path: "/tmp/test/forest.png",
          model: "sdxl.safetensors",
          artist_reference: "studio ghibli",
          quality: "standard",
          enable_hires_fix: false,
          hires_scale: 1.5,
          hires_denoise: 0.4,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
          auto_recommend_loras: false,
        },
        ""
      );

      expect(result.success).toBe(true);
      expect(result.prompt.positive.toLowerCase()).toContain("studio ghibli");
    });
  });

  describe("error handling", () => {
    it("should throw error if no model available", async () => {
      await expect(
        imagine(
          client,
          {
            description: "test",
            output_path: "/tmp/test.png",
            quality: "standard",
            enable_hires_fix: false,
            hires_scale: 1.5,
            hires_denoise: 0.4,
            hires_steps: 20,
            enable_upscale: false,
            upscale_model: "RealESRGAN_x4plus.pth",
            auto_recommend_loras: false,
          },
          "" // No default model
        )
      ).rejects.toThrow(/No model specified/);
    });
  });

  describe("schema validation", () => {
    it("should validate required fields", () => {
      expect(() =>
        imagineSchema.parse({
          description: "test",
          // missing output_path
        })
      ).toThrow();
    });

    it("should apply defaults", () => {
      const result = imagineSchema.parse({
        description: "test",
        output_path: "/tmp/test.png",
      });

      expect(result.quality).toBe("standard");
      expect(result.auto_recommend_loras).toBe(false);
    });

    it("should validate style enum", () => {
      const result = imagineSchema.parse({
        description: "test",
        output_path: "/tmp/test.png",
        style: "anime",
      });

      expect(result.style).toBe("anime");
    });

    it("should reject invalid style", () => {
      expect(() =>
        imagineSchema.parse({
          description: "test",
          output_path: "/tmp/test.png",
          style: "invalid_style",
        })
      ).toThrow();
    });

    it("should validate quality enum", () => {
      const validQualities = ["draft", "standard", "high", "ultra"];
      for (const quality of validQualities) {
        const result = imagineSchema.parse({
          description: "test",
          output_path: "/tmp/test.png",
          quality,
        });
        expect(result.quality).toBe(quality);
      }
    });
  });

  describe("model-specific behavior", () => {
    it("should use low CFG for Flux models", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await imagine(
        client,
        {
          description: "A landscape",
          output_path: "/tmp/test/flux.png",
          model: "flux1-schnell.safetensors",
          quality: "standard",
          enable_hires_fix: false,
          hires_scale: 1.5,
          hires_denoise: 0.4,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
          auto_recommend_loras: false,
        },
        ""
      );

      expect(result.success).toBe(true);
      expect(result.settings.cfgScale).toBeLessThanOrEqual(4);
    });

    it("should include score tags for Pony models", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await imagine(
        client,
        {
          description: "A character portrait",
          output_path: "/tmp/test/pony.png",
          model: "ponyDiffusion_v6.safetensors",
          quality: "standard",
          enable_hires_fix: false,
          hires_scale: 1.5,
          hires_denoise: 0.4,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
          auto_recommend_loras: false,
        },
        ""
      );

      expect(result.success).toBe(true);
      expect(result.prompt.positive).toContain("score_9");
    });
  });

  describe("LoRA handling", () => {
    it("should include user-specified LoRAs", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await imagine(
        client,
        {
          description: "A portrait",
          output_path: "/tmp/test/lora.png",
          model: "model.safetensors",
          loras: [
            { name: "detail_enhancer.safetensors", strength_model: 0.8, strength_clip: 0.8 },
          ],
          quality: "standard",
          enable_hires_fix: false,
          hires_scale: 1.5,
          hires_denoise: 0.4,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
          auto_recommend_loras: false,
        },
        ""
      );

      const workflow = queueSpy.mock.calls[0][0];
      expect(workflow["lora_0"]).toBeDefined();
      expect(workflow["lora_0"].inputs.lora_name).toBe("detail_enhancer.safetensors");
      expect(workflow["lora_0"].inputs.strength_model).toBe(0.8);
    });
  });
});
