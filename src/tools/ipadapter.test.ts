import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateWithIPAdapter,
  generateWithIPAdapterSchema,
} from "./ipadapter.js";
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

describe("generateWithIPAdapter", () => {
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

  describe("basic generation", () => {
    it("should generate an image with IP-Adapter successfully", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await generateWithIPAdapter(
        client,
        {
          prompt: "a portrait of the same person in a different pose",
          reference_image: "character_ref.png",
          output_path: "/tmp/test/ipadapter_output.png",
          weight: 0.8,
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
      expect(result.path).toBe("/tmp/test/ipadapter_output.png");
      expect(typeof result.seed).toBe("number");
      expect(result.message).toContain("IP-Adapter");
    });

    it("should use default weight of 0.8", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
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
      expect(calledWorkflow["15"].inputs.weight).toBe(0.8);
    });

    it("should use provided seed when specified", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
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

    it("should throw error when no model specified and no default", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      await expect(
        generateWithIPAdapter(
          client,
          {
            prompt: "test",
            reference_image: "ref.png",
            output_path: "/tmp/test.png",
            width: 512,
            height: 768,
            steps: 28,
            cfg_scale: 7,
            sampler: "euler_ancestral",
            scheduler: "normal",
          },
          ""
        )
      ).rejects.toThrow("No model specified and COMFYUI_MODEL not set");
    });
  });

  describe("weight configuration", () => {
    it("should set custom weight correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          weight: 0.5,
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
      expect(calledWorkflow["15"].inputs.weight).toBe(0.5);
    });

    it("should set weight_type correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          weight_type: "ease in-out",
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
      expect(calledWorkflow["15"].inputs.weight_type).toBe("ease in-out");
    });

    it("should use default weight_type of linear", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
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
      expect(calledWorkflow["15"].inputs.weight_type).toBe("linear");
    });
  });

  describe("timing control", () => {
    it("should set start_at correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          start_at: 0.2,
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
      expect(calledWorkflow["15"].inputs.start_at).toBe(0.2);
    });

    it("should set end_at correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          end_at: 0.8,
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
      expect(calledWorkflow["15"].inputs.end_at).toBe(0.8);
    });

    it("should default start_at to 0 and end_at to 1", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
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
      expect(calledWorkflow["15"].inputs.start_at).toBe(0);
      expect(calledWorkflow["15"].inputs.end_at).toBe(1);
    });
  });

  describe("model configuration", () => {
    it("should use custom IP-Adapter model when specified", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          ipadapter_model: "ip-adapter-plus_sdxl_vit-h.safetensors",
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
      expect(calledWorkflow["11"].inputs.ipadapter_file).toBe(
        "ip-adapter-plus_sdxl_vit-h.safetensors"
      );
    });

    it("should use custom CLIP Vision model when specified", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          clip_vision_model: "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors",
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
      expect(calledWorkflow["12"].inputs.clip_name).toBe(
        "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors"
      );
    });

    it("should use default IP-Adapter model", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
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
      expect(calledWorkflow["11"].inputs.ipadapter_file).toBe(
        "ip-adapter_sdxl_vit-h.safetensors"
      );
    });
  });

  describe("reference image handling", () => {
    it("should set single reference image correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "my_character.png",
          output_path: "/tmp/test.png",
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
      expect(calledWorkflow["10"].inputs.image).toBe("my_character.png");
    });

    it("should handle multiple reference images", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "char_front.png",
          reference_images: ["char_side.png", "char_back.png"],
          output_path: "/tmp/test.png",
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
      // Multiple images should create additional LoadImage nodes
      expect(calledWorkflow["ref_image_0"]).toBeDefined();
      expect(calledWorkflow["ref_image_1"]).toBeDefined();
      expect(calledWorkflow["ref_image_2"]).toBeDefined();
    });

    it("should create ImageBatch nodes for multiple images", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref1.png",
          reference_images: ["ref2.png"],
          output_path: "/tmp/test.png",
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
      expect(calledWorkflow["image_batch_1"]).toBeDefined();
      expect(calledWorkflow["image_batch_1"].class_type).toBe("ImageBatch");
    });
  });

  describe("LoRA integration", () => {
    it("should include LoRAs in workflow", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          loras: [
            { name: "style_lora.safetensors", strength_model: 0.8, strength_clip: 0.8 },
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
      expect(calledWorkflow["lora_0"].class_type).toBe("LoraLoader");
      expect(calledWorkflow["lora_0"].inputs.lora_name).toBe("style_lora.safetensors");
    });

    it("should chain multiple LoRAs correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          loras: [
            { name: "lora1.safetensors", strength_model: 1.0, strength_clip: 1.0 },
            { name: "lora2.safetensors", strength_model: 0.5, strength_clip: 0.5 },
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
      expect(calledWorkflow["lora_1"]).toBeDefined();
      // Second LoRA should chain from first
      expect(calledWorkflow["lora_1"].inputs.model[0]).toBe("lora_0");
    });
  });

  describe("sampler parameters", () => {
    it("should set dimensions correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          width: 1024,
          height: 1024,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["5"].inputs.width).toBe(1024);
      expect(calledWorkflow["5"].inputs.height).toBe(1024);
    });

    it("should set steps correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          steps: 50,
          width: 512,
          height: 768,
          cfg_scale: 7,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["3"].inputs.steps).toBe(50);
    });

    it("should set CFG scale correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          cfg_scale: 2.5,
          width: 512,
          height: 768,
          steps: 28,
          sampler: "euler_ancestral",
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["3"].inputs.cfg).toBe(2.5);
    });

    it("should set sampler correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          sampler: "dpmpp_2m_sde",
          width: 512,
          height: 768,
          steps: 28,
          cfg_scale: 7,
          scheduler: "normal",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["3"].inputs.sampler_name).toBe("dpmpp_2m_sde");
    });

    it("should set scheduler correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          scheduler: "karras",
          width: 512,
          height: 768,
          steps: 28,
          cfg_scale: 7,
          sampler: "euler_ancestral",
        },
        "model.safetensors"
      );

      const calledWorkflow = queueSpy.mock.calls[0][0];
      expect(calledWorkflow["3"].inputs.scheduler).toBe("karras");
    });
  });

  describe("prompts", () => {
    it("should set positive prompt correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "a beautiful portrait of the same character",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
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
      expect(calledWorkflow["6"].inputs.text).toBe(
        "a beautiful portrait of the same character"
      );
    });

    it("should set negative prompt correctly", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          negative_prompt: "ugly, blurry, bad anatomy",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
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
      expect(calledWorkflow["7"].inputs.text).toBe("ugly, blurry, bad anatomy");
    });

    it("should use default negative prompt when not specified", async () => {
      global.fetch = createMockFetch() as typeof fetch;
      const queueSpy = vi.spyOn(client, "queuePrompt");

      await generateWithIPAdapter(
        client,
        {
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
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
      expect(calledWorkflow["7"].inputs.text).toContain("bad quality");
    });
  });
});

describe("generateWithIPAdapterSchema", () => {
  describe("required fields", () => {
    it("should validate valid minimal input", () => {
      const input = {
        prompt: "test prompt",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
      };

      const result = generateWithIPAdapterSchema.parse(input);

      expect(result.prompt).toBe("test prompt");
      expect(result.reference_image).toBe("ref.png");
      expect(result.output_path).toBe("/tmp/test.png");
    });

    it("should reject missing prompt", () => {
      expect(() =>
        generateWithIPAdapterSchema.parse({
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
        })
      ).toThrow();
    });

    it("should reject missing reference_image", () => {
      expect(() =>
        generateWithIPAdapterSchema.parse({
          prompt: "test",
          output_path: "/tmp/test.png",
        })
      ).toThrow();
    });

    it("should reject missing output_path", () => {
      expect(() =>
        generateWithIPAdapterSchema.parse({
          prompt: "test",
          reference_image: "ref.png",
        })
      ).toThrow();
    });
  });

  describe("default values", () => {
    it("should apply default weight of 0.8", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
      });

      expect(result.weight).toBe(0.8);
    });

    it("should apply default weight_type of linear", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
      });

      expect(result.weight_type).toBe("linear");
    });

    it("should apply default start_at of 0", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
      });

      expect(result.start_at).toBe(0);
    });

    it("should apply default end_at of 1", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
      });

      expect(result.end_at).toBe(1);
    });

    it("should apply default width of 512", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
      });

      expect(result.width).toBe(512);
    });

    it("should apply default height of 768", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
      });

      expect(result.height).toBe(768);
    });

    it("should apply default steps of 28", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
      });

      expect(result.steps).toBe(28);
    });

    it("should apply default cfg_scale of 7", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
      });

      expect(result.cfg_scale).toBe(7);
    });

    it("should apply default sampler of euler_ancestral", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
      });

      expect(result.sampler).toBe("euler_ancestral");
    });

    it("should apply default scheduler of normal", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
      });

      expect(result.scheduler).toBe("normal");
    });

    it("should apply default upload_to_cloud of true", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
      });

      expect(result.upload_to_cloud).toBe(true);
    });
  });

  describe("weight validation", () => {
    it("should accept weight of 0", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
        weight: 0,
      });

      expect(result.weight).toBe(0);
    });

    it("should accept weight of 2", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
        weight: 2,
      });

      expect(result.weight).toBe(2);
    });

    it("should reject weight below 0", () => {
      expect(() =>
        generateWithIPAdapterSchema.parse({
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          weight: -0.1,
        })
      ).toThrow();
    });

    it("should reject weight above 2", () => {
      expect(() =>
        generateWithIPAdapterSchema.parse({
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          weight: 2.1,
        })
      ).toThrow();
    });
  });

  describe("weight_type validation", () => {
    it("should accept all valid weight types", () => {
      const weightTypes = [
        "linear",
        "ease in",
        "ease out",
        "ease in-out",
        "reverse in-out",
        "weak input",
        "weak output",
        "weak middle",
        "strong middle",
      ];

      weightTypes.forEach((weightType) => {
        const result = generateWithIPAdapterSchema.parse({
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          weight_type: weightType,
        });
        expect(result.weight_type).toBe(weightType);
      });
    });

    it("should reject invalid weight_type", () => {
      expect(() =>
        generateWithIPAdapterSchema.parse({
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          weight_type: "invalid_type",
        })
      ).toThrow();
    });
  });

  describe("timing validation", () => {
    it("should accept start_at of 0", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
        start_at: 0,
      });

      expect(result.start_at).toBe(0);
    });

    it("should accept start_at of 1", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
        start_at: 1,
      });

      expect(result.start_at).toBe(1);
    });

    it("should reject start_at below 0", () => {
      expect(() =>
        generateWithIPAdapterSchema.parse({
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          start_at: -0.1,
        })
      ).toThrow();
    });

    it("should reject start_at above 1", () => {
      expect(() =>
        generateWithIPAdapterSchema.parse({
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          start_at: 1.1,
        })
      ).toThrow();
    });

    it("should reject end_at below 0", () => {
      expect(() =>
        generateWithIPAdapterSchema.parse({
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          end_at: -0.1,
        })
      ).toThrow();
    });

    it("should reject end_at above 1", () => {
      expect(() =>
        generateWithIPAdapterSchema.parse({
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          end_at: 1.1,
        })
      ).toThrow();
    });
  });

  describe("combine_embeds validation", () => {
    it("should accept all valid combine_embeds values", () => {
      const combineTypes = ["concat", "add", "subtract", "average", "norm average"];

      combineTypes.forEach((combineType) => {
        const result = generateWithIPAdapterSchema.parse({
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          combine_embeds: combineType,
        });
        expect(result.combine_embeds).toBe(combineType);
      });
    });

    it("should reject invalid combine_embeds", () => {
      expect(() =>
        generateWithIPAdapterSchema.parse({
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          combine_embeds: "invalid",
        })
      ).toThrow();
    });
  });

  describe("reference_images validation", () => {
    it("should accept array of reference images", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref1.png",
        reference_images: ["ref2.png", "ref3.png"],
        output_path: "/tmp/test.png",
      });

      expect(result.reference_images).toEqual(["ref2.png", "ref3.png"]);
    });

    it("should accept empty reference_images array", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        reference_images: [],
        output_path: "/tmp/test.png",
      });

      expect(result.reference_images).toEqual([]);
    });
  });

  describe("LoRA validation", () => {
    it("should accept valid LoRA configuration", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
        loras: [
          { name: "lora1.safetensors", strength_model: 0.8, strength_clip: 0.8 },
        ],
      });

      expect(result.loras).toHaveLength(1);
      expect(result.loras![0].name).toBe("lora1.safetensors");
    });

    it("should apply default LoRA strengths", () => {
      const result = generateWithIPAdapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        output_path: "/tmp/test.png",
        loras: [{ name: "lora.safetensors" }],
      });

      expect(result.loras![0].strength_model).toBe(1.0);
      expect(result.loras![0].strength_clip).toBe(1.0);
    });

    it("should reject LoRA without name", () => {
      expect(() =>
        generateWithIPAdapterSchema.parse({
          prompt: "test",
          reference_image: "ref.png",
          output_path: "/tmp/test.png",
          loras: [{ strength_model: 0.8 }],
        })
      ).toThrow();
    });
  });

  describe("full configuration", () => {
    it("should accept complete configuration", () => {
      const input = {
        prompt: "a portrait of the character in a new pose",
        negative_prompt: "ugly, blurry",
        reference_image: "character.png",
        reference_images: ["char_side.png"],
        weight: 0.9,
        weight_type: "ease in-out",
        start_at: 0.1,
        end_at: 0.9,
        combine_embeds: "average",
        ipadapter_model: "ip-adapter-plus_sdxl_vit-h.safetensors",
        clip_vision_model: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
        model: "dreamshaper_8.safetensors",
        width: 768,
        height: 1024,
        steps: 40,
        cfg_scale: 5,
        sampler: "dpmpp_2m_sde",
        scheduler: "karras",
        seed: 12345,
        loras: [
          { name: "style.safetensors", strength_model: 0.7, strength_clip: 0.7 },
        ],
        output_path: "/output/result.png",
        upload_to_cloud: false,
      };

      const result = generateWithIPAdapterSchema.parse(input);

      expect(result.prompt).toBe(input.prompt);
      expect(result.negative_prompt).toBe(input.negative_prompt);
      expect(result.reference_image).toBe(input.reference_image);
      expect(result.reference_images).toEqual(input.reference_images);
      expect(result.weight).toBe(input.weight);
      expect(result.weight_type).toBe(input.weight_type);
      expect(result.start_at).toBe(input.start_at);
      expect(result.end_at).toBe(input.end_at);
      expect(result.combine_embeds).toBe(input.combine_embeds);
      expect(result.ipadapter_model).toBe(input.ipadapter_model);
      expect(result.clip_vision_model).toBe(input.clip_vision_model);
      expect(result.model).toBe(input.model);
      expect(result.width).toBe(input.width);
      expect(result.height).toBe(input.height);
      expect(result.steps).toBe(input.steps);
      expect(result.cfg_scale).toBe(input.cfg_scale);
      expect(result.sampler).toBe(input.sampler);
      expect(result.scheduler).toBe(input.scheduler);
      expect(result.seed).toBe(input.seed);
      expect(result.loras).toEqual(input.loras);
      expect(result.output_path).toBe(input.output_path);
      expect(result.upload_to_cloud).toBe(input.upload_to_cloud);
    });
  });
});
