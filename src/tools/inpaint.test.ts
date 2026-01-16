/**
 * Inpainting Tool Tests
 *
 * Exhaustive test coverage for inpaint and outpaint tools.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { inpaint, outpaint, inpaintSchema, outpaintSchema } from "./inpaint.js";
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
        "9": { images: [{ filename: "test.png", subfolder: "", type: "output" }] },
      },
    }),
    getImage: vi.fn().mockResolvedValue(Buffer.from("fake-image-data")),
  } as unknown as ComfyUIClient;
}

// ============================================================================
// Inpaint Schema Tests
// ============================================================================

describe("inpaintSchema", () => {
  it("should require prompt", () => {
    expect(() =>
      inpaintSchema.parse({
        source_image: "img.png",
        mask_image: "mask.png",
        output_path: "/tmp/out.png",
      })
    ).toThrow();
  });

  it("should require source_image", () => {
    expect(() =>
      inpaintSchema.parse({
        prompt: "fix this",
        mask_image: "mask.png",
        output_path: "/tmp/out.png",
      })
    ).toThrow();
  });

  it("should require mask_image", () => {
    expect(() =>
      inpaintSchema.parse({
        prompt: "fix this",
        source_image: "img.png",
        output_path: "/tmp/out.png",
      })
    ).toThrow();
  });

  it("should require output_path", () => {
    expect(() =>
      inpaintSchema.parse({
        prompt: "fix this",
        source_image: "img.png",
        mask_image: "mask.png",
      })
    ).toThrow();
  });

  it("should accept valid input", () => {
    const input = inpaintSchema.parse({
      prompt: "beautiful face",
      source_image: "portrait.png",
      mask_image: "face_mask.png",
      output_path: "/tmp/inpaint.png",
    });

    expect(input.prompt).toBe("beautiful face");
    expect(input.source_image).toBe("portrait.png");
    expect(input.mask_image).toBe("face_mask.png");
    expect(input.output_path).toBe("/tmp/inpaint.png");
  });

  it("should apply defaults", () => {
    const input = inpaintSchema.parse({
      prompt: "fix hands",
      source_image: "img.png",
      mask_image: "mask.png",
      output_path: "/tmp/out.png",
    });

    expect(input.denoise_strength).toBe(0.75);
    expect(input.grow_mask_by).toBe(6);
    expect(input.steps).toBe(28);
    expect(input.cfg_scale).toBe(7);
    expect(input.sampler).toBe("euler_ancestral");
    expect(input.scheduler).toBe("normal");
  });

  it("should accept all optional parameters", () => {
    const input = inpaintSchema.parse({
      prompt: "fix hands",
      negative_prompt: "bad anatomy",
      source_image: "img.png",
      mask_image: "mask.png",
      denoise_strength: 0.9,
      grow_mask_by: 10,
      model: "sd15.safetensors",
      steps: 35,
      cfg_scale: 8,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      seed: 12345,
      loras: [{ name: "detail_lora.safetensors", strength_model: 0.8 }],
      output_path: "/tmp/out.png",
    });

    expect(input.negative_prompt).toBe("bad anatomy");
    expect(input.denoise_strength).toBe(0.9);
    expect(input.grow_mask_by).toBe(10);
    expect(input.model).toBe("sd15.safetensors");
    expect(input.steps).toBe(35);
    expect(input.cfg_scale).toBe(8);
    expect(input.sampler).toBe("dpmpp_2m");
    expect(input.scheduler).toBe("karras");
    expect(input.seed).toBe(12345);
    expect(input.loras).toHaveLength(1);
  });

  it("should reject denoise_strength out of range", () => {
    expect(() =>
      inpaintSchema.parse({
        prompt: "test",
        source_image: "img.png",
        mask_image: "mask.png",
        denoise_strength: 1.5,
        output_path: "/tmp/out.png",
      })
    ).toThrow();

    expect(() =>
      inpaintSchema.parse({
        prompt: "test",
        source_image: "img.png",
        mask_image: "mask.png",
        denoise_strength: -0.1,
        output_path: "/tmp/out.png",
      })
    ).toThrow();
  });
});

// ============================================================================
// Outpaint Schema Tests
// ============================================================================

describe("outpaintSchema", () => {
  it("should require prompt", () => {
    expect(() =>
      outpaintSchema.parse({
        source_image: "img.png",
        extend_right: 256,
        output_path: "/tmp/out.png",
      })
    ).toThrow();
  });

  it("should require source_image", () => {
    expect(() =>
      outpaintSchema.parse({
        prompt: "extend",
        extend_right: 256,
        output_path: "/tmp/out.png",
      })
    ).toThrow();
  });

  it("should require output_path", () => {
    expect(() =>
      outpaintSchema.parse({
        prompt: "extend",
        source_image: "img.png",
        extend_right: 256,
      })
    ).toThrow();
  });

  it("should accept valid input", () => {
    const input = outpaintSchema.parse({
      prompt: "more landscape",
      source_image: "landscape.png",
      extend_right: 256,
      output_path: "/tmp/outpaint.png",
    });

    expect(input.prompt).toBe("more landscape");
    expect(input.source_image).toBe("landscape.png");
    expect(input.extend_right).toBe(256);
    expect(input.output_path).toBe("/tmp/outpaint.png");
  });

  it("should apply defaults", () => {
    const input = outpaintSchema.parse({
      prompt: "extend",
      source_image: "img.png",
      output_path: "/tmp/out.png",
    });

    expect(input.extend_left).toBe(0);
    expect(input.extend_right).toBe(0);
    expect(input.extend_top).toBe(0);
    expect(input.extend_bottom).toBe(0);
    expect(input.feathering).toBe(40);
    expect(input.denoise_strength).toBe(0.8);
    expect(input.steps).toBe(28);
    expect(input.cfg_scale).toBe(7);
  });

  it("should accept all extend directions", () => {
    const input = outpaintSchema.parse({
      prompt: "extend",
      source_image: "img.png",
      extend_left: 100,
      extend_right: 200,
      extend_top: 150,
      extend_bottom: 50,
      output_path: "/tmp/out.png",
    });

    expect(input.extend_left).toBe(100);
    expect(input.extend_right).toBe(200);
    expect(input.extend_top).toBe(150);
    expect(input.extend_bottom).toBe(50);
  });

  it("should accept all optional parameters", () => {
    const input = outpaintSchema.parse({
      prompt: "extend landscape",
      negative_prompt: "bad quality",
      source_image: "img.png",
      extend_right: 256,
      feathering: 60,
      denoise_strength: 0.9,
      model: "sdxl.safetensors",
      steps: 40,
      cfg_scale: 6,
      sampler: "euler",
      scheduler: "normal",
      seed: 42,
      loras: [{ name: "style.safetensors" }],
      output_path: "/tmp/out.png",
    });

    expect(input.negative_prompt).toBe("bad quality");
    expect(input.feathering).toBe(60);
    expect(input.denoise_strength).toBe(0.9);
    expect(input.model).toBe("sdxl.safetensors");
    expect(input.steps).toBe(40);
    expect(input.loras).toHaveLength(1);
  });
});

// ============================================================================
// Inpaint Function Tests
// ============================================================================

describe("inpaint", () => {
  let mockClient: ComfyUIClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it("should throw if no model provided", async () => {
    const input = inpaintSchema.parse({
      prompt: "fix this",
      source_image: "img.png",
      mask_image: "mask.png",
      output_path: "/tmp/out.png",
    });

    await expect(inpaint(mockClient, input, "")).rejects.toThrow(
      "No model specified"
    );
  });

  it("should inpaint successfully with default model", async () => {
    const input = inpaintSchema.parse({
      prompt: "beautiful face",
      source_image: "portrait.png",
      mask_image: "face_mask.png",
      output_path: "/tmp/inpaint.png",
    });

    const result = await inpaint(mockClient, input, "sd15.safetensors");

    expect(result.success).toBe(true);
    expect(result.path).toBe("/tmp/inpaint.png");
    expect(result.message).toContain("Inpainted");
    expect(mockClient.queuePrompt).toHaveBeenCalled();
    expect(mockClient.waitForCompletion).toHaveBeenCalled();
  });

  it("should use provided model over default", async () => {
    const input = inpaintSchema.parse({
      prompt: "fix this",
      source_image: "img.png",
      mask_image: "mask.png",
      model: "custom.safetensors",
      output_path: "/tmp/out.png",
    });

    await inpaint(mockClient, input, "default.safetensors");

    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["4"].inputs.ckpt_name).toBe("custom.safetensors");
  });

  it("should use provided seed", async () => {
    const input = inpaintSchema.parse({
      prompt: "fix this",
      source_image: "img.png",
      mask_image: "mask.png",
      seed: 12345,
      output_path: "/tmp/out.png",
    });

    const result = await inpaint(mockClient, input, "sd15.safetensors");

    expect(result.seed).toBe(12345);
    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["5"].inputs.seed).toBe(12345);
  });

  it("should generate random seed if not provided", async () => {
    const input = inpaintSchema.parse({
      prompt: "fix this",
      source_image: "img.png",
      mask_image: "mask.png",
      output_path: "/tmp/out.png",
    });

    const result = await inpaint(mockClient, input, "sd15.safetensors");

    expect(result.seed).toBeGreaterThan(0);
  });

  it("should configure workflow with all parameters", async () => {
    const input = inpaintSchema.parse({
      prompt: "fix hands",
      negative_prompt: "bad anatomy",
      source_image: "img.png",
      mask_image: "mask.png",
      denoise_strength: 0.8,
      grow_mask_by: 10,
      steps: 35,
      cfg_scale: 6,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      output_path: "/tmp/out.png",
    });

    await inpaint(mockClient, input, "sd15.safetensors");

    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["1"].inputs.image).toBe("img.png");
    expect(workflow["2"].inputs.image).toBe("mask.png");
    expect(workflow["3"].inputs.grow_mask_by).toBe(10);
    expect(workflow["5"].inputs.denoise).toBe(0.8);
    expect(workflow["5"].inputs.steps).toBe(35);
    expect(workflow["5"].inputs.cfg).toBe(6);
    expect(workflow["5"].inputs.sampler_name).toBe("dpmpp_2m");
    expect(workflow["5"].inputs.scheduler).toBe("karras");
    expect(workflow["6"].inputs.text).toBe("fix hands");
    expect(workflow["7"].inputs.text).toBe("bad anatomy");
  });
});

// ============================================================================
// Outpaint Function Tests
// ============================================================================

describe("outpaint", () => {
  let mockClient: ComfyUIClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it("should throw if no model provided", async () => {
    const input = outpaintSchema.parse({
      prompt: "extend",
      source_image: "img.png",
      extend_right: 256,
      output_path: "/tmp/out.png",
    });

    await expect(outpaint(mockClient, input, "")).rejects.toThrow(
      "No model specified"
    );
  });

  it("should throw if no extend direction specified", async () => {
    const input = outpaintSchema.parse({
      prompt: "extend",
      source_image: "img.png",
      output_path: "/tmp/out.png",
    });

    await expect(outpaint(mockClient, input, "sd15.safetensors")).rejects.toThrow(
      "At least one extend direction"
    );
  });

  it("should outpaint successfully with extend_right", async () => {
    const input = outpaintSchema.parse({
      prompt: "more landscape",
      source_image: "landscape.png",
      extend_right: 256,
      output_path: "/tmp/outpaint.png",
    });

    const result = await outpaint(mockClient, input, "sd15.safetensors");

    expect(result.success).toBe(true);
    expect(result.path).toBe("/tmp/outpaint.png");
    expect(result.message).toContain("right: 256px");
    expect(mockClient.queuePrompt).toHaveBeenCalled();
  });

  it("should include all directions in message", async () => {
    const input = outpaintSchema.parse({
      prompt: "extend all",
      source_image: "img.png",
      extend_left: 100,
      extend_right: 200,
      extend_top: 50,
      extend_bottom: 150,
      output_path: "/tmp/out.png",
    });

    const result = await outpaint(mockClient, input, "sd15.safetensors");

    expect(result.message).toContain("left: 100px");
    expect(result.message).toContain("right: 200px");
    expect(result.message).toContain("top: 50px");
    expect(result.message).toContain("bottom: 150px");
  });

  it("should configure workflow with extend parameters", async () => {
    const input = outpaintSchema.parse({
      prompt: "extend",
      source_image: "img.png",
      extend_left: 100,
      extend_right: 200,
      extend_top: 50,
      extend_bottom: 150,
      feathering: 60,
      output_path: "/tmp/out.png",
    });

    await outpaint(mockClient, input, "sd15.safetensors");

    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["1"].inputs.image).toBe("img.png");
    expect(workflow["2"].inputs.left).toBe(100);
    expect(workflow["2"].inputs.right).toBe(200);
    expect(workflow["2"].inputs.top).toBe(50);
    expect(workflow["2"].inputs.bottom).toBe(150);
    expect(workflow["2"].inputs.feathering).toBe(60);
  });

  it("should use provided denoise_strength", async () => {
    const input = outpaintSchema.parse({
      prompt: "extend",
      source_image: "img.png",
      extend_right: 256,
      denoise_strength: 0.95,
      output_path: "/tmp/out.png",
    });

    await outpaint(mockClient, input, "sd15.safetensors");

    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["7"].inputs.denoise).toBe(0.95);
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

  it("should handle LoRAs in inpaint", async () => {
    const input = inpaintSchema.parse({
      prompt: "fix this",
      source_image: "img.png",
      mask_image: "mask.png",
      loras: [
        { name: "detail.safetensors", strength_model: 0.8, strength_clip: 0.7 },
        { name: "style.safetensors", strength_model: 0.6 },
      ],
      output_path: "/tmp/out.png",
    });

    const result = await inpaint(mockClient, input, "sd15.safetensors");

    expect(result.success).toBe(true);
    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["lora_0"]).toBeDefined();
    expect(workflow["lora_0"].inputs.lora_name).toBe("detail.safetensors");
    expect(workflow["lora_1"]).toBeDefined();
    expect(workflow["lora_1"].inputs.lora_name).toBe("style.safetensors");
  });

  it("should handle minimum valid outpaint", async () => {
    // Just 1 pixel of extension should work
    const input = outpaintSchema.parse({
      prompt: "extend",
      source_image: "img.png",
      extend_right: 1,
      output_path: "/tmp/out.png",
    });

    const result = await outpaint(mockClient, input, "sd15.safetensors");

    expect(result.success).toBe(true);
  });

  it("should handle large extension values", async () => {
    const input = outpaintSchema.parse({
      prompt: "extend",
      source_image: "img.png",
      extend_left: 512,
      extend_right: 512,
      extend_top: 512,
      extend_bottom: 512,
      output_path: "/tmp/out.png",
    });

    const result = await outpaint(mockClient, input, "sd15.safetensors");

    expect(result.success).toBe(true);
    expect(result.message).toContain("left: 512px");
  });

  it("should use default negative prompt in inpaint", async () => {
    const input = inpaintSchema.parse({
      prompt: "fix this",
      source_image: "img.png",
      mask_image: "mask.png",
      output_path: "/tmp/out.png",
    });

    await inpaint(mockClient, input, "sd15.safetensors");

    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["7"].inputs.text).toContain("bad quality");
  });

  it("should use default negative prompt in outpaint", async () => {
    const input = outpaintSchema.parse({
      prompt: "extend",
      source_image: "img.png",
      extend_right: 256,
      output_path: "/tmp/out.png",
    });

    await outpaint(mockClient, input, "sd15.safetensors");

    const workflow = (mockClient.queuePrompt as any).mock.calls[0][0];
    expect(workflow["6"].inputs.text).toContain("bad quality");
  });
});
