import { describe, it, expect } from "vitest";
import {
  buildTxt2ImgWorkflow,
  buildImg2ImgWorkflow,
  buildUpscaleWorkflow,
  LoraConfig,
} from "./builder.js";

describe("buildTxt2ImgWorkflow", () => {
  const baseParams = {
    prompt: "a beautiful landscape",
    model: "dreamshaper_8.safetensors",
  };

  it("should create workflow with required parameters", () => {
    const workflow = buildTxt2ImgWorkflow(baseParams);

    expect(workflow["4"].inputs.ckpt_name).toBe("dreamshaper_8.safetensors");
    expect(workflow["6"].inputs.text).toBe("a beautiful landscape");
  });

  it("should set default negative prompt", () => {
    const workflow = buildTxt2ImgWorkflow(baseParams);

    expect(workflow["7"].inputs.text).toBe(
      "bad quality, blurry, ugly, deformed"
    );
  });

  it("should use custom negative prompt", () => {
    const workflow = buildTxt2ImgWorkflow({
      ...baseParams,
      negativePrompt: "no people, no text",
    });

    expect(workflow["7"].inputs.text).toBe("no people, no text");
  });

  it("should set default dimensions", () => {
    const workflow = buildTxt2ImgWorkflow(baseParams);

    expect(workflow["5"].inputs.width).toBe(512);
    expect(workflow["5"].inputs.height).toBe(768);
  });

  it("should use custom dimensions", () => {
    const workflow = buildTxt2ImgWorkflow({
      ...baseParams,
      width: 1024,
      height: 1024,
    });

    expect(workflow["5"].inputs.width).toBe(1024);
    expect(workflow["5"].inputs.height).toBe(1024);
  });

  it("should set default sampler parameters", () => {
    const workflow = buildTxt2ImgWorkflow(baseParams);

    expect(workflow["3"].inputs.steps).toBe(28);
    expect(workflow["3"].inputs.cfg).toBe(7);
    expect(workflow["3"].inputs.sampler_name).toBe("euler_ancestral");
    expect(workflow["3"].inputs.scheduler).toBe("normal");
  });

  it("should use custom sampler parameters", () => {
    const workflow = buildTxt2ImgWorkflow({
      ...baseParams,
      steps: 50,
      cfgScale: 12,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    });

    expect(workflow["3"].inputs.steps).toBe(50);
    expect(workflow["3"].inputs.cfg).toBe(12);
    expect(workflow["3"].inputs.sampler_name).toBe("dpmpp_2m");
    expect(workflow["3"].inputs.scheduler).toBe("karras");
  });

  it("should use provided seed", () => {
    const workflow = buildTxt2ImgWorkflow({
      ...baseParams,
      seed: 12345,
    });

    expect(workflow["3"].inputs.seed).toBe(12345);
  });

  it("should generate random seed if not provided", () => {
    const workflow = buildTxt2ImgWorkflow(baseParams);

    expect(typeof workflow["3"].inputs.seed).toBe("number");
    expect(workflow["3"].inputs.seed).toBeGreaterThanOrEqual(0);
    expect(workflow["3"].inputs.seed).toBeLessThan(2147483647);
  });

  it("should set default filename prefix", () => {
    const workflow = buildTxt2ImgWorkflow(baseParams);

    expect(workflow["9"].inputs.filename_prefix).toBe("ComfyUI_MCP");
  });

  it("should use custom filename prefix", () => {
    const workflow = buildTxt2ImgWorkflow({
      ...baseParams,
      filenamePrefix: "MyProject",
    });

    expect(workflow["9"].inputs.filename_prefix).toBe("MyProject");
  });

  describe("LoRA injection", () => {
    it("should inject single LoRA", () => {
      const loras: LoraConfig[] = [
        { name: "style_lora.safetensors" },
      ];

      const workflow = buildTxt2ImgWorkflow({ ...baseParams, loras });

      // Check LoRA node was added
      expect(workflow["lora_0"]).toBeDefined();
      expect(workflow["lora_0"].class_type).toBe("LoraLoader");
      expect(workflow["lora_0"].inputs.lora_name).toBe("style_lora.safetensors");
      expect(workflow["lora_0"].inputs.strength_model).toBe(1.0);
      expect(workflow["lora_0"].inputs.strength_clip).toBe(1.0);

      // Check LoRA is connected to checkpoint
      expect(workflow["lora_0"].inputs.model).toEqual(["4", 0]);
      expect(workflow["lora_0"].inputs.clip).toEqual(["4", 1]);

      // Check KSampler is connected to LoRA
      expect(workflow["3"].inputs.model).toEqual(["lora_0", 0]);

      // Check text encoders are connected to LoRA
      expect(workflow["6"].inputs.clip).toEqual(["lora_0", 1]);
      expect(workflow["7"].inputs.clip).toEqual(["lora_0", 1]);
    });

    it("should inject LoRA with custom strengths", () => {
      const loras: LoraConfig[] = [
        {
          name: "style_lora.safetensors",
          strength_model: 0.8,
          strength_clip: 0.6,
        },
      ];

      const workflow = buildTxt2ImgWorkflow({ ...baseParams, loras });

      expect(workflow["lora_0"].inputs.strength_model).toBe(0.8);
      expect(workflow["lora_0"].inputs.strength_clip).toBe(0.6);
    });

    it("should chain multiple LoRAs", () => {
      const loras: LoraConfig[] = [
        { name: "style_lora.safetensors" },
        { name: "character_lora.safetensors" },
      ];

      const workflow = buildTxt2ImgWorkflow({ ...baseParams, loras });

      // First LoRA connected to checkpoint
      expect(workflow["lora_0"].inputs.model).toEqual(["4", 0]);
      expect(workflow["lora_0"].inputs.clip).toEqual(["4", 1]);

      // Second LoRA connected to first LoRA
      expect(workflow["lora_1"].inputs.model).toEqual(["lora_0", 0]);
      expect(workflow["lora_1"].inputs.clip).toEqual(["lora_0", 1]);

      // KSampler connected to last LoRA
      expect(workflow["3"].inputs.model).toEqual(["lora_1", 0]);

      // Text encoders connected to last LoRA
      expect(workflow["6"].inputs.clip).toEqual(["lora_1", 1]);
      expect(workflow["7"].inputs.clip).toEqual(["lora_1", 1]);
    });

    it("should not inject LoRAs if array is empty", () => {
      const workflow = buildTxt2ImgWorkflow({ ...baseParams, loras: [] });

      expect(workflow["lora_0"]).toBeUndefined();
      // KSampler should still be connected to checkpoint
      expect(workflow["3"].inputs.model).toEqual(["4", 0]);
    });
  });
});

describe("buildImg2ImgWorkflow", () => {
  const baseParams = {
    prompt: "enhanced version",
    inputImage: "input.png",
    model: "dreamshaper_8.safetensors",
  };

  it("should create workflow with required parameters", () => {
    const workflow = buildImg2ImgWorkflow(baseParams);

    expect(workflow["1"].inputs.image).toBe("input.png");
    expect(workflow["4"].inputs.ckpt_name).toBe("dreamshaper_8.safetensors");
    expect(workflow["6"].inputs.text).toBe("enhanced version");
  });

  it("should set default denoise value", () => {
    const workflow = buildImg2ImgWorkflow(baseParams);

    expect(workflow["3"].inputs.denoise).toBe(0.75);
  });

  it("should use custom denoise value", () => {
    const workflow = buildImg2ImgWorkflow({
      ...baseParams,
      denoise: 0.5,
    });

    expect(workflow["3"].inputs.denoise).toBe(0.5);
  });

  it("should set default filename prefix for img2img", () => {
    const workflow = buildImg2ImgWorkflow(baseParams);

    expect(workflow["9"].inputs.filename_prefix).toBe("ComfyUI_MCP_img2img");
  });

  it("should inject LoRAs for img2img", () => {
    const loras: LoraConfig[] = [{ name: "style_lora.safetensors" }];

    const workflow = buildImg2ImgWorkflow({ ...baseParams, loras });

    expect(workflow["lora_0"]).toBeDefined();
    expect(workflow["3"].inputs.model).toEqual(["lora_0", 0]);
  });
});

describe("buildUpscaleWorkflow", () => {
  const baseParams = {
    inputImage: "input.png",
  };

  it("should create workflow with required parameters", () => {
    const workflow = buildUpscaleWorkflow(baseParams);

    expect(workflow["1"].inputs.image).toBe("input.png");
  });

  it("should set default upscale model", () => {
    const workflow = buildUpscaleWorkflow(baseParams);

    expect(workflow["2"].inputs.model_name).toBe("RealESRGAN_x4plus.pth");
  });

  it("should use custom upscale model", () => {
    const workflow = buildUpscaleWorkflow({
      ...baseParams,
      upscaleModel: "4x-UltraSharp.pth",
    });

    expect(workflow["2"].inputs.model_name).toBe("4x-UltraSharp.pth");
  });

  it("should set target dimensions when provided", () => {
    const workflow = buildUpscaleWorkflow({
      ...baseParams,
      targetWidth: 2048,
      targetHeight: 2048,
    });

    expect(workflow["4"].inputs.width).toBe(2048);
    expect(workflow["4"].inputs.height).toBe(2048);
  });

  it("should remove resize node when no target dimensions", () => {
    const workflow = buildUpscaleWorkflow(baseParams);

    expect(workflow["4"]).toBeUndefined();
    // SaveImage should connect directly to upscale output
    expect(workflow["5"].inputs.images).toEqual(["3", 0]);
  });

  it("should set default filename prefix for upscale", () => {
    const workflow = buildUpscaleWorkflow(baseParams);

    expect(workflow["5"].inputs.filename_prefix).toBe("ComfyUI_MCP_upscale");
  });

  it("should use custom filename prefix", () => {
    const workflow = buildUpscaleWorkflow({
      ...baseParams,
      filenamePrefix: "Upscaled",
    });

    expect(workflow["5"].inputs.filename_prefix).toBe("Upscaled");
  });
});
