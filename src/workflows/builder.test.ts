import { describe, it, expect } from "vitest";
import {
  buildTxt2ImgWorkflow,
  buildImg2ImgWorkflow,
  buildUpscaleWorkflow,
  buildIPAdapterWorkflow,
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

describe("buildIPAdapterWorkflow", () => {
  const baseParams = {
    prompt: "a portrait of the same character",
    model: "dreamshaper_8.safetensors",
    referenceImage: "character_ref.png",
  };

  describe("basic workflow structure", () => {
    it("should create workflow with required parameters", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["4"].inputs.ckpt_name).toBe("dreamshaper_8.safetensors");
      expect(workflow["6"].inputs.text).toBe("a portrait of the same character");
      expect(workflow["10"].inputs.image).toBe("character_ref.png");
    });

    it("should have all required nodes", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      // Essential nodes
      expect(workflow["3"]).toBeDefined(); // KSampler
      expect(workflow["4"]).toBeDefined(); // CheckpointLoaderSimple
      expect(workflow["5"]).toBeDefined(); // EmptyLatentImage
      expect(workflow["6"]).toBeDefined(); // CLIPTextEncode (positive)
      expect(workflow["7"]).toBeDefined(); // CLIPTextEncode (negative)
      expect(workflow["8"]).toBeDefined(); // VAEDecode
      expect(workflow["9"]).toBeDefined(); // SaveImage
      expect(workflow["10"]).toBeDefined(); // LoadImage (reference)
      expect(workflow["11"]).toBeDefined(); // IPAdapterModelLoader
      expect(workflow["12"]).toBeDefined(); // CLIPVisionLoader
      expect(workflow["15"]).toBeDefined(); // IPAdapterApply
    });

    it("should have correct node class types", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["3"].class_type).toBe("KSampler");
      expect(workflow["4"].class_type).toBe("CheckpointLoaderSimple");
      expect(workflow["5"].class_type).toBe("EmptyLatentImage");
      expect(workflow["6"].class_type).toBe("CLIPTextEncode");
      expect(workflow["7"].class_type).toBe("CLIPTextEncode");
      expect(workflow["8"].class_type).toBe("VAEDecode");
      expect(workflow["9"].class_type).toBe("SaveImage");
      expect(workflow["10"].class_type).toBe("LoadImage");
      expect(workflow["11"].class_type).toBe("IPAdapterModelLoader");
      expect(workflow["12"].class_type).toBe("CLIPVisionLoader");
      expect(workflow["15"].class_type).toBe("IPAdapterApply");
    });

    it("should wire KSampler to use IP-Adapter modified model", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      // KSampler should use output from IPAdapterApply (node 15)
      expect(workflow["3"].inputs.model).toEqual(["15", 0]);
    });
  });

  describe("prompts", () => {
    it("should set default negative prompt", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["7"].inputs.text).toBe(
        "bad quality, blurry, ugly, deformed"
      );
    });

    it("should use custom negative prompt", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        negativePrompt: "low resolution, artifacts",
      });

      expect(workflow["7"].inputs.text).toBe("low resolution, artifacts");
    });
  });

  describe("dimensions", () => {
    it("should set default dimensions", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["5"].inputs.width).toBe(512);
      expect(workflow["5"].inputs.height).toBe(768);
    });

    it("should use custom dimensions", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        width: 1024,
        height: 1024,
      });

      expect(workflow["5"].inputs.width).toBe(1024);
      expect(workflow["5"].inputs.height).toBe(1024);
    });
  });

  describe("sampler parameters", () => {
    it("should set default sampler parameters", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["3"].inputs.steps).toBe(28);
      expect(workflow["3"].inputs.cfg).toBe(7);
      expect(workflow["3"].inputs.sampler_name).toBe("euler_ancestral");
      expect(workflow["3"].inputs.scheduler).toBe("normal");
    });

    it("should use custom sampler parameters", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        steps: 40,
        cfgScale: 5,
        sampler: "dpmpp_2m_sde",
        scheduler: "karras",
      });

      expect(workflow["3"].inputs.steps).toBe(40);
      expect(workflow["3"].inputs.cfg).toBe(5);
      expect(workflow["3"].inputs.sampler_name).toBe("dpmpp_2m_sde");
      expect(workflow["3"].inputs.scheduler).toBe("karras");
    });

    it("should use provided seed", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        seed: 42,
      });

      expect(workflow["3"].inputs.seed).toBe(42);
    });

    it("should generate random seed if not provided", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(typeof workflow["3"].inputs.seed).toBe("number");
      expect(workflow["3"].inputs.seed).toBeGreaterThanOrEqual(0);
      expect(workflow["3"].inputs.seed).toBeLessThan(2147483647);
    });
  });

  describe("IP-Adapter configuration", () => {
    it("should set default IP-Adapter model", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["11"].inputs.ipadapter_file).toBe(
        "ip-adapter_sdxl_vit-h.safetensors"
      );
    });

    it("should use custom IP-Adapter model", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        ipAdapterModel: "ip-adapter-plus_sdxl_vit-h.safetensors",
      });

      expect(workflow["11"].inputs.ipadapter_file).toBe(
        "ip-adapter-plus_sdxl_vit-h.safetensors"
      );
    });

    it("should set default CLIP Vision model", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["12"].inputs.clip_name).toBe(
        "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"
      );
    });

    it("should use custom CLIP Vision model", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        clipVisionModel: "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors",
      });

      expect(workflow["12"].inputs.clip_name).toBe(
        "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors"
      );
    });

    it("should set default weight", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["15"].inputs.weight).toBe(0.8);
    });

    it("should use custom weight", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        weight: 0.5,
      });

      expect(workflow["15"].inputs.weight).toBe(0.5);
    });

    it("should set default weight_type", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["15"].inputs.weight_type).toBe("linear");
    });

    it("should use custom weight_type", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        weightType: "ease in-out",
      });

      expect(workflow["15"].inputs.weight_type).toBe("ease in-out");
    });

    it("should set default start_at", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["15"].inputs.start_at).toBe(0);
    });

    it("should use custom start_at", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        startAt: 0.2,
      });

      expect(workflow["15"].inputs.start_at).toBe(0.2);
    });

    it("should set default end_at", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["15"].inputs.end_at).toBe(1);
    });

    it("should use custom end_at", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        endAt: 0.8,
      });

      expect(workflow["15"].inputs.end_at).toBe(0.8);
    });
  });

  describe("IP-Adapter node wiring", () => {
    it("should wire IPAdapterApply to checkpoint model output", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["15"].inputs.model).toEqual(["4", 0]);
    });

    it("should wire IPAdapterApply to IP-Adapter model loader", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["15"].inputs.ipadapter).toEqual(["11", 0]);
    });

    it("should wire IPAdapterApply to CLIP Vision loader", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["15"].inputs.clip_vision).toEqual(["12", 0]);
    });

    it("should wire IPAdapterApply to reference image", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["15"].inputs.image).toEqual(["10", 0]);
    });
  });

  describe("multiple reference images", () => {
    it("should create multiple LoadImage nodes for multiple references", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        referenceImages: ["char_side.png", "char_back.png"],
      });

      expect(workflow["ref_image_0"]).toBeDefined();
      expect(workflow["ref_image_0"].class_type).toBe("LoadImage");
      expect(workflow["ref_image_0"].inputs.image).toBe("character_ref.png");

      expect(workflow["ref_image_1"]).toBeDefined();
      expect(workflow["ref_image_1"].class_type).toBe("LoadImage");
      expect(workflow["ref_image_1"].inputs.image).toBe("char_side.png");

      expect(workflow["ref_image_2"]).toBeDefined();
      expect(workflow["ref_image_2"].class_type).toBe("LoadImage");
      expect(workflow["ref_image_2"].inputs.image).toBe("char_back.png");
    });

    it("should create ImageBatch nodes for multiple references", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        referenceImages: ["char_side.png"],
      });

      expect(workflow["image_batch_1"]).toBeDefined();
      expect(workflow["image_batch_1"].class_type).toBe("ImageBatch");
    });

    it("should chain ImageBatch nodes for 3+ references", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        referenceImages: ["char_side.png", "char_back.png"],
      });

      // First batch combines ref_image_0 and ref_image_1
      expect(workflow["image_batch_1"]).toBeDefined();
      // Second batch combines that with ref_image_2
      expect(workflow["image_batch_2"]).toBeDefined();
      expect(workflow["image_batch_2"].inputs.image1).toEqual(["image_batch_1", 0]);
    });

    it("should wire final batch to IPAdapterApply", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        referenceImages: ["char_side.png", "char_back.png"],
      });

      // IPAdapterApply should use the final batch
      expect(workflow["15"].inputs.image).toEqual(["image_batch_2", 0]);
    });

    it("should not modify workflow for empty referenceImages array", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        referenceImages: [],
      });

      // Should still use single image mode
      expect(workflow["10"]).toBeDefined();
      expect(workflow["ref_image_0"]).toBeUndefined();
    });
  });

  describe("LoRA integration", () => {
    it("should inject single LoRA", () => {
      const loras: LoraConfig[] = [{ name: "style_lora.safetensors" }];

      const workflow = buildIPAdapterWorkflow({ ...baseParams, loras });

      expect(workflow["lora_0"]).toBeDefined();
      expect(workflow["lora_0"].class_type).toBe("LoraLoader");
      expect(workflow["lora_0"].inputs.lora_name).toBe("style_lora.safetensors");
    });

    it("should chain multiple LoRAs", () => {
      const loras: LoraConfig[] = [
        { name: "lora1.safetensors" },
        { name: "lora2.safetensors" },
      ];

      const workflow = buildIPAdapterWorkflow({ ...baseParams, loras });

      expect(workflow["lora_0"]).toBeDefined();
      expect(workflow["lora_1"]).toBeDefined();
      expect(workflow["lora_1"].inputs.model[0]).toBe("lora_0");
    });

    it("should wire IP-Adapter to use LoRA output", () => {
      const loras: LoraConfig[] = [{ name: "style_lora.safetensors" }];

      const workflow = buildIPAdapterWorkflow({ ...baseParams, loras });

      // IPAdapterApply should use LoRA output, not checkpoint directly
      expect(workflow["15"].inputs.model).toEqual(["lora_0", 0]);
    });

    it("should use default LoRA strengths", () => {
      const loras: LoraConfig[] = [{ name: "lora.safetensors" }];

      const workflow = buildIPAdapterWorkflow({ ...baseParams, loras });

      expect(workflow["lora_0"].inputs.strength_model).toBe(1.0);
      expect(workflow["lora_0"].inputs.strength_clip).toBe(1.0);
    });

    it("should use custom LoRA strengths", () => {
      const loras: LoraConfig[] = [
        { name: "lora.safetensors", strength_model: 0.7, strength_clip: 0.5 },
      ];

      const workflow = buildIPAdapterWorkflow({ ...baseParams, loras });

      expect(workflow["lora_0"].inputs.strength_model).toBe(0.7);
      expect(workflow["lora_0"].inputs.strength_clip).toBe(0.5);
    });

    it("should wire CLIP encoders to LoRA output", () => {
      const loras: LoraConfig[] = [{ name: "lora.safetensors" }];

      const workflow = buildIPAdapterWorkflow({ ...baseParams, loras });

      expect(workflow["6"].inputs.clip).toEqual(["lora_0", 1]);
      expect(workflow["7"].inputs.clip).toEqual(["lora_0", 1]);
    });
  });

  describe("filename prefix", () => {
    it("should set default filename prefix", () => {
      const workflow = buildIPAdapterWorkflow(baseParams);

      expect(workflow["9"].inputs.filename_prefix).toBe("ComfyUI_MCP_ipadapter");
    });

    it("should use custom filename prefix", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        filenamePrefix: "MyCharacter",
      });

      expect(workflow["9"].inputs.filename_prefix).toBe("MyCharacter");
    });
  });

  describe("weight types", () => {
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
      it(`should accept weight_type "${weightType}"`, () => {
        const workflow = buildIPAdapterWorkflow({
          ...baseParams,
          weightType: weightType as any,
        });

        expect(workflow["15"].inputs.weight_type).toBe(weightType);
      });
    });
  });

  describe("edge cases", () => {
    it("should handle weight of 0", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        weight: 0,
      });

      expect(workflow["15"].inputs.weight).toBe(0);
    });

    it("should handle weight of 2", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        weight: 2,
      });

      expect(workflow["15"].inputs.weight).toBe(2);
    });

    it("should handle start_at equal to end_at", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        startAt: 0.5,
        endAt: 0.5,
      });

      expect(workflow["15"].inputs.start_at).toBe(0.5);
      expect(workflow["15"].inputs.end_at).toBe(0.5);
    });

    it("should handle seed of 0", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        seed: 0,
      });

      expect(workflow["3"].inputs.seed).toBe(0);
    });

    it("should handle maximum valid seed", () => {
      const workflow = buildIPAdapterWorkflow({
        ...baseParams,
        seed: 2147483646,
      });

      expect(workflow["3"].inputs.seed).toBe(2147483646);
    });
  });
});
