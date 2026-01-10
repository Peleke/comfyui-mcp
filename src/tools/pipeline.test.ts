import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executePipeline, executePipelineSchema } from "./pipeline.js";
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

describe("executePipeline", () => {
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

  describe("txt2img only", () => {
    it("should execute txt2img successfully", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await executePipeline(
        client,
        {
          prompt: "a beautiful landscape",
          model: "dreamshaper_8.safetensors",
          output_path: "/tmp/test/output.png",
          width: 768,
          height: 1024,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
          enable_hires_fix: false,
          hires_scale: 1.5,
          hires_denoise: 0.4,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
        },
        ""
      );

      expect(result.success).toBe(true);
      expect(result.finalPath).toBe("/tmp/test/output.png");
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].name).toBe("txt2img");
      expect(result.steps[0].success).toBe(true);
    });

    it("should use default model if not specified", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await executePipeline(
        client,
        {
          prompt: "test",
          model: "",
          output_path: "/tmp/test.png",
          width: 768,
          height: 1024,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
          enable_hires_fix: false,
          hires_scale: 1.5,
          hires_denoise: 0.4,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
        },
        "default_model.safetensors"
      );

      const workflow = queueSpy.mock.calls[0][0];
      expect(workflow["4"].inputs.ckpt_name).toBe("default_model.safetensors");
    });

    it("should throw error if no model available", async () => {
      await expect(
        executePipeline(
          client,
          {
            prompt: "test",
            model: "",
            output_path: "/tmp/test.png",
            width: 768,
            height: 1024,
            steps: 28,
            cfg_scale: 7,
            sampler: "euler_ancestral",
            scheduler: "normal",
            enable_hires_fix: false,
            hires_scale: 1.5,
            hires_denoise: 0.4,
            hires_steps: 20,
            enable_upscale: false,
            upscale_model: "RealESRGAN_x4plus.pth",
          },
          "" // No default
        )
      ).rejects.toThrow("No model specified");
    });

    it("should include LoRAs in workflow", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await executePipeline(
        client,
        {
          prompt: "test",
          model: "model.safetensors",
          output_path: "/tmp/test.png",
          loras: [
            { name: "style.safetensors", strength_model: 0.8, strength_clip: 0.6 },
          ],
          width: 768,
          height: 1024,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
          enable_hires_fix: false,
          hires_scale: 1.5,
          hires_denoise: 0.4,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
        },
        ""
      );

      const workflow = queueSpy.mock.calls[0][0];
      expect(workflow["lora_0"]).toBeDefined();
      expect(workflow["lora_0"].inputs.lora_name).toBe("style.safetensors");
    });
  });

  describe("with hi-res fix", () => {
    it("should execute txt2img + hi-res fix", async () => {
      // Mock the upload endpoint
      global.fetch = vi.fn().mockImplementation(async (url, init) => {
        const urlStr = url.toString();

        // Upload endpoint
        if (urlStr.includes("/upload/image")) {
          return new Response(JSON.stringify({ name: "uploaded.png" }), {
            status: 200,
          });
        }

        // Queue prompt
        if (urlStr.includes("/prompt") && init?.method === "POST") {
          return new Response(
            JSON.stringify({ prompt_id: "test-id", number: 1 }),
            { status: 200 }
          );
        }

        // Get image
        if (urlStr.includes("/view")) {
          return new Response(new Uint8Array(mockImageBuffer), { status: 200 });
        }

        return new Response("{}", { status: 200 });
      });

      const result = await executePipeline(
        client,
        {
          prompt: "a portrait",
          model: "model.safetensors",
          output_path: "/tmp/test.png",
          enable_hires_fix: true,
          hires_denoise: 0.4,
          width: 768,
          height: 1024,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
          hires_scale: 1.5,
          hires_steps: 20,
          enable_upscale: false,
          upscale_model: "RealESRGAN_x4plus.pth",
        },
        ""
      );

      expect(result.success).toBe(true);
      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].name).toBe("txt2img");
      expect(result.steps[1].name).toBe("hires_fix");
    });
  });

  describe("schema validation", () => {
    it("should validate required fields", () => {
      expect(() =>
        executePipelineSchema.parse({
          prompt: "test",
          // missing model and output_path
        })
      ).toThrow();
    });

    it("should apply defaults", () => {
      const result = executePipelineSchema.parse({
        prompt: "test",
        model: "model.safetensors",
        output_path: "/tmp/test.png",
      });

      expect(result.width).toBe(768);
      expect(result.height).toBe(1024);
      expect(result.steps).toBe(28);
      expect(result.cfg_scale).toBe(7);
      expect(result.enable_hires_fix).toBe(false);
      expect(result.enable_upscale).toBe(false);
    });
  });
});
