/**
 * IP-Adapter Tool Tests
 *
 * Exhaustive test coverage for IP-Adapter identity preservation tool.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ipadapter, ipadapterSchema } from "./ipadapter.js";
import type { ComfyUIClient } from "../comfyui-client.js";

// Mock fs
vi.mock("fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// Create mock client
function createMockClient(): ComfyUIClient {
  return {
    queuePrompt: vi.fn().mockResolvedValue({ prompt_id: "test-prompt-id" }),
    waitForCompletion: vi.fn().mockResolvedValue({
      outputs: {
        "11": { images: [{ filename: "test.png", subfolder: "", type: "output" }] },
      },
    }),
    getImage: vi.fn().mockResolvedValue(Buffer.from("fake-image-data")),
    getObjectInfo: vi.fn().mockResolvedValue({}),
  } as unknown as ComfyUIClient;
}

// ============================================================================
// Schema Tests
// ============================================================================

describe("ipadapterSchema", () => {
  it("should require prompt", () => {
    expect(() =>
      ipadapterSchema.parse({
        reference_image: "ref.png",
        output_path: "/tmp/out.png",
      })
    ).toThrow();
  });

  it("should require reference_image", () => {
    expect(() =>
      ipadapterSchema.parse({
        prompt: "a character",
        output_path: "/tmp/out.png",
      })
    ).toThrow();
  });

  it("should require output_path", () => {
    expect(() =>
      ipadapterSchema.parse({
        prompt: "a character",
        reference_image: "ref.png",
      })
    ).toThrow();
  });

  it("should accept valid input", () => {
    const input = ipadapterSchema.parse({
      prompt: "a character in a forest",
      reference_image: "character_ref.png",
      output_path: "/tmp/ipadapter.png",
    });

    expect(input.prompt).toBe("a character in a forest");
    expect(input.reference_image).toBe("character_ref.png");
    expect(input.output_path).toBe("/tmp/ipadapter.png");
  });

  it("should apply defaults", () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      output_path: "/tmp/out.png",
    });

    expect(input.weight).toBe(0.8);
    expect(input.weight_type).toBe("linear");
    expect(input.start_at).toBe(0.0);
    expect(input.end_at).toBe(1.0);
    expect(input.combine_embeds).toBe("concat");
    expect(input.width).toBe(512);
    expect(input.height).toBe(768);
    expect(input.steps).toBe(28);
    expect(input.cfg_scale).toBe(7);
    expect(input.sampler).toBe("euler_ancestral");
    expect(input.scheduler).toBe("normal");
  });

  it("should accept all weight types", () => {
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
      "style transfer",
      "composition",
      "strong style transfer",
    ];

    for (const weightType of weightTypes) {
      const input = ipadapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        weight_type: weightType,
        output_path: "/tmp/out.png",
      });
      expect(input.weight_type).toBe(weightType);
    }
  });

  it("should accept all combine_embeds options", () => {
    const options = ["concat", "add", "subtract", "average", "norm average"];

    for (const option of options) {
      const input = ipadapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        combine_embeds: option,
        output_path: "/tmp/out.png",
      });
      expect(input.combine_embeds).toBe(option);
    }
  });

  it("should reject invalid weight_type", () => {
    expect(() =>
      ipadapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        weight_type: "invalid",
        output_path: "/tmp/out.png",
      })
    ).toThrow();
  });

  it("should accept multiple reference images", () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref1.png",
      reference_images: ["ref2.png", "ref3.png"],
      output_path: "/tmp/out.png",
    });

    expect(input.reference_images).toHaveLength(2);
    expect(input.reference_images).toContain("ref2.png");
    expect(input.reference_images).toContain("ref3.png");
  });

  it("should reject weight out of range", () => {
    expect(() =>
      ipadapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        weight: 2.5,
        output_path: "/tmp/out.png",
      })
    ).toThrow();

    expect(() =>
      ipadapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        weight: -0.5,
        output_path: "/tmp/out.png",
      })
    ).toThrow();
  });

  it("should reject start_at/end_at out of range", () => {
    expect(() =>
      ipadapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        start_at: 1.5,
        output_path: "/tmp/out.png",
      })
    ).toThrow();

    expect(() =>
      ipadapterSchema.parse({
        prompt: "test",
        reference_image: "ref.png",
        end_at: -0.1,
        output_path: "/tmp/out.png",
      })
    ).toThrow();
  });

  it("should accept all optional parameters", () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      negative_prompt: "bad quality",
      reference_image: "ref.png",
      reference_images: ["ref2.png"],
      weight: 0.9,
      weight_type: "style transfer",
      start_at: 0.1,
      end_at: 0.9,
      combine_embeds: "average",
      model: "sd15.safetensors",
      ipadapter_model: "ip-adapter-plus_sd15.safetensors",
      clip_vision_model: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
      width: 768,
      height: 1024,
      steps: 35,
      cfg_scale: 6,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      seed: 12345,
      loras: [{ name: "style.safetensors", strength_model: 0.8 }],
      output_path: "/tmp/out.png",
    });

    expect(input.negative_prompt).toBe("bad quality");
    expect(input.weight).toBe(0.9);
    expect(input.weight_type).toBe("style transfer");
    expect(input.ipadapter_model).toBe("ip-adapter-plus_sd15.safetensors");
    expect(input.clip_vision_model).toBe("CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors");
    expect(input.loras).toHaveLength(1);
  });
});

// ============================================================================
// IP-Adapter Function Tests
// ============================================================================

describe("ipadapter", () => {
  let mockClient: ComfyUIClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it("should throw if no model provided", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      output_path: "/tmp/out.png",
    });

    await expect(ipadapter(mockClient, input, "")).rejects.toThrow(
      "No model specified"
    );
  });

  it("should generate successfully with default model", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character in a forest",
      reference_image: "character_ref.png",
      output_path: "/tmp/ipadapter.png",
    });

    const result = await ipadapter(mockClient, input, "sd15.safetensors");

    expect(result.success).toBe(true);
    expect(result.path).toBe("/tmp/ipadapter.png");
    expect(result.referenceCount).toBe(1);
    expect(result.message).toContain("IP-Adapter");
    expect(mockClient.queuePrompt).toHaveBeenCalled();
    expect(mockClient.waitForCompletion).toHaveBeenCalled();
  });

  it("should use provided model over default", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      model: "custom.safetensors",
      output_path: "/tmp/out.png",
    });

    await ipadapter(mockClient, input, "default.safetensors");

    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["1"].inputs.ckpt_name).toBe("custom.safetensors");
  });

  it("should use provided seed", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      seed: 12345,
      output_path: "/tmp/out.png",
    });

    const result = await ipadapter(mockClient, input, "sd15.safetensors");

    expect(result.seed).toBe(12345);
    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["9"].inputs.seed).toBe(12345);
  });

  it("should generate random seed if not provided", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      output_path: "/tmp/out.png",
    });

    const result = await ipadapter(mockClient, input, "sd15.safetensors");

    expect(result.seed).toBeGreaterThan(0);
  });

  it("should configure workflow with IP-Adapter parameters", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      weight: 0.9,
      weight_type: "style transfer",
      start_at: 0.1,
      end_at: 0.8,
      combine_embeds: "average",
      output_path: "/tmp/out.png",
    });

    await ipadapter(mockClient, input, "sd15.safetensors");

    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["4"].inputs.image).toBe("ref.png");
    expect(workflow["5"].inputs.weight).toBe(0.9);
    expect(workflow["5"].inputs.weight_type).toBe("style transfer");
    expect(workflow["5"].inputs.start_at).toBe(0.1);
    expect(workflow["5"].inputs.end_at).toBe(0.8);
    expect(workflow["5"].inputs.combine_embeds).toBe("average");
  });

  it("should auto-detect IP-Adapter model for SD1.5", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      output_path: "/tmp/out.png",
    });

    await ipadapter(mockClient, input, "sd15_model.safetensors");

    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["3"].inputs.ipadapter_file).toBe("ip-adapter-plus_sd15.safetensors");
  });

  it("should auto-detect IP-Adapter model for SDXL", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      output_path: "/tmp/out.png",
    });

    await ipadapter(mockClient, input, "sdxl_model.safetensors");

    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["3"].inputs.ipadapter_file).toBe("ip-adapter-plus_sdxl_vit-h.safetensors");
  });

  it("should use explicit IP-Adapter model when provided", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      ipadapter_model: "custom_ipadapter.safetensors",
      output_path: "/tmp/out.png",
    });

    await ipadapter(mockClient, input, "sd15.safetensors");

    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["3"].inputs.ipadapter_file).toBe("custom_ipadapter.safetensors");
  });

  it("should count reference images correctly", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref1.png",
      reference_images: ["ref2.png", "ref3.png"],
      output_path: "/tmp/out.png",
    });

    const result = await ipadapter(mockClient, input, "sd15.safetensors");

    expect(result.referenceCount).toBe(3);
    expect(result.message).toContain("3 references");
  });

  it("should handle single reference correctly", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      output_path: "/tmp/out.png",
    });

    const result = await ipadapter(mockClient, input, "sd15.safetensors");

    expect(result.referenceCount).toBe(1);
    expect(result.message).toContain("1 reference,");
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Edge Cases", () => {
  let mockClient: ComfyUIClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it("should handle LoRAs", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      loras: [
        { name: "detail.safetensors", strength_model: 0.8, strength_clip: 0.7 },
        { name: "style.safetensors", strength_model: 0.6 },
      ],
      output_path: "/tmp/out.png",
    });

    const result = await ipadapter(mockClient, input, "sd15.safetensors");

    expect(result.success).toBe(true);
    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["lora_0"]).toBeDefined();
    expect(workflow["lora_0"].inputs.lora_name).toBe("detail.safetensors");
    expect(workflow["lora_1"]).toBeDefined();
    expect(workflow["lora_1"].inputs.lora_name).toBe("style.safetensors");
  });

  it("should configure dimensions correctly", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      width: 1024,
      height: 1024,
      output_path: "/tmp/out.png",
    });

    await ipadapter(mockClient, input, "sd15.safetensors");

    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["6"].inputs.width).toBe(1024);
    expect(workflow["6"].inputs.height).toBe(1024);
  });

  it("should use default negative prompt", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      output_path: "/tmp/out.png",
    });

    await ipadapter(mockClient, input, "sd15.safetensors");

    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["8"].inputs.text).toContain("bad quality");
  });

  it("should use custom negative prompt", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      negative_prompt: "ugly, deformed, blurry",
      reference_image: "ref.png",
      output_path: "/tmp/out.png",
    });

    await ipadapter(mockClient, input, "sd15.safetensors");

    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["8"].inputs.text).toBe("ugly, deformed, blurry");
  });

  it("should handle minimum weight", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      weight: 0,
      output_path: "/tmp/out.png",
    });

    const result = await ipadapter(mockClient, input, "sd15.safetensors");

    expect(result.success).toBe(true);
    expect(result.message).toContain("weight: 0");
  });

  it("should handle maximum weight", async () => {
    const input = ipadapterSchema.parse({
      prompt: "a character",
      reference_image: "ref.png",
      weight: 2,
      output_path: "/tmp/out.png",
    });

    const result = await ipadapter(mockClient, input, "sd15.safetensors");

    expect(result.success).toBe(true);
    expect(result.message).toContain("weight: 2");
  });
});
