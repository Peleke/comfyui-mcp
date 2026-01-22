/**
 * Workflow Contract Tests
 *
 * These tests validate that our workflow builders produce valid ComfyUI workflows
 * by checking against the /object_info schema - WITHOUT requiring a GPU or live
 * ComfyUI instance.
 *
 * This is the key insight: we can catch workflow bugs at build time, not runtime.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  validateWorkflow,
  loadBundledSchema,
  formatValidationErrors,
} from "./workflow-validator.js";
import type { ComfyUIObjectInfo, ValidationResult } from "./types.js";
import {
  buildTxt2ImgWorkflow,
  buildImg2ImgWorkflow,
  buildControlNetWorkflow,
  buildInpaintWorkflow,
  buildOutpaintWorkflow,
  buildUpscaleWorkflow,
  buildIPAdapterWorkflow,
  buildTTSWorkflow,
  buildLipSyncWorkflow,
  buildZTurboTxt2ImgWorkflow,
  buildZTurboImg2ImgWorkflow,
  isZImageTurboModel,
} from "../workflows/builder.js";

let schema: ComfyUIObjectInfo;

beforeAll(async () => {
  schema = await loadBundledSchema();
});

// Helper to assert workflow validity
function expectValid(result: ValidationResult) {
  if (!result.valid) {
    console.error(formatValidationErrors(result));
  }
  expect(result.valid, formatValidationErrors(result)).toBe(true);
}

// ============================================================================
// Txt2Img Workflow Contract Tests
// ============================================================================

describe("Contract: buildTxt2ImgWorkflow", () => {
  it("produces valid workflow with minimal params", () => {
    const workflow = buildTxt2ImgWorkflow({
      model: "sd15.safetensors",
      prompt: "a beautiful landscape",
      width: 512,
      height: 768,
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);
  });

  it("produces valid workflow with all params", () => {
    const workflow = buildTxt2ImgWorkflow({
      model: "sdxl.safetensors",
      prompt: "a cyberpunk city at night",
      negativePrompt: "blurry, ugly, deformed",
      width: 1024,
      height: 1024,
      steps: 30,
      cfgScale: 7.5,
      sampler: "dpmpp_2m",
      scheduler: "karras",
      seed: 42,
      filenamePrefix: "test_output",
      loras: [
        { name: "detail.safetensors", strength_model: 0.8, strength_clip: 0.8 },
      ],
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);
  });

  it("has correct node types", () => {
    const workflow = buildTxt2ImgWorkflow({
      model: "model.safetensors",
      prompt: "test",
      width: 512,
      height: 512,
    });

    // Verify expected node types exist
    const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);
    expect(nodeTypes).toContain("CheckpointLoaderSimple");
    expect(nodeTypes).toContain("KSampler");
    expect(nodeTypes).toContain("CLIPTextEncode");
    expect(nodeTypes).toContain("VAEDecode");
    expect(nodeTypes).toContain("SaveImage");
    expect(nodeTypes).toContain("EmptyLatentImage");
  });

  it("validates sampler_name enum values", () => {
    const workflow = buildTxt2ImgWorkflow({
      model: "model.safetensors",
      prompt: "test",
      width: 512,
      height: 512,
      sampler: "euler_ancestral",
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);

    // All supported samplers should be valid
    const samplers = ["euler", "euler_ancestral", "dpmpp_2m", "ddim"];
    for (const sampler of samplers) {
      const w = buildTxt2ImgWorkflow({
        model: "model.safetensors",
        prompt: "test",
        width: 512,
        height: 512,
        sampler,
      });
      const r = validateWorkflow(w, schema);
      expectValid(r);
    }
  });

  it("validates scheduler enum values", () => {
    const schedulers = ["normal", "karras", "exponential", "sgm_uniform"];
    for (const scheduler of schedulers) {
      const workflow = buildTxt2ImgWorkflow({
        model: "model.safetensors",
        prompt: "test",
        width: 512,
        height: 512,
        scheduler,
      });
      const result = validateWorkflow(workflow, schema);
      expectValid(result);
    }
  });

  it("validates dimension constraints", () => {
    // Valid dimensions
    const workflow = buildTxt2ImgWorkflow({
      model: "model.safetensors",
      prompt: "test",
      width: 512,
      height: 768,
    });
    const result = validateWorkflow(workflow, schema);
    expectValid(result);
    expect(result.stats.nodeCount).toBeGreaterThan(0);
  });

  it("correctly wires LoRAs into workflow", () => {
    const workflow = buildTxt2ImgWorkflow({
      model: "model.safetensors",
      prompt: "test",
      width: 512,
      height: 512,
      loras: [
        { name: "lora1.safetensors", strength_model: 0.7, strength_clip: 0.7 },
        { name: "lora2.safetensors", strength_model: 0.5, strength_clip: 0.5 },
      ],
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);

    // Should have LoRA nodes
    const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);
    expect(nodeTypes.filter((t) => t === "LoraLoader").length).toBe(2);
  });
});

// ============================================================================
// Img2Img Workflow Contract Tests
// ============================================================================

describe("Contract: buildImg2ImgWorkflow", () => {
  it("produces valid workflow with minimal params", () => {
    const workflow = buildImg2ImgWorkflow({
      model: "sd15.safetensors",
      prompt: "enhanced version",
      inputImage: "input.png",
      denoise: 0.7,
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);
  });

  it("produces valid workflow with all params", () => {
    const workflow = buildImg2ImgWorkflow({
      model: "sdxl.safetensors",
      prompt: "a fantasy scene",
      negativePrompt: "ugly",
      inputImage: "source.png",
      denoise: 0.5,
      steps: 25,
      cfgScale: 6,
      sampler: "dpmpp_sde",
      scheduler: "karras",
      seed: 12345,
      filenamePrefix: "img2img_test",
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);
  });

  it("has correct node types for img2img", () => {
    const workflow = buildImg2ImgWorkflow({
      model: "model.safetensors",
      prompt: "test",
      inputImage: "input.png",
      denoise: 0.7,
    });

    const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);
    expect(nodeTypes).toContain("LoadImage");
    expect(nodeTypes).toContain("VAEEncode");
    expect(nodeTypes).toContain("KSampler");
  });

  it("validates denoise is within range", () => {
    // Test valid denoise values
    for (const denoise of [0.0, 0.5, 0.7, 1.0]) {
      const workflow = buildImg2ImgWorkflow({
        model: "model.safetensors",
        prompt: "test",
        inputImage: "input.png",
        denoise,
      });
      const result = validateWorkflow(workflow, schema);
      expectValid(result);
    }
  });
});

// ============================================================================
// ControlNet Workflow Contract Tests
// ============================================================================

describe("Contract: buildControlNetWorkflow", () => {
  it("produces valid workflow with canny control", () => {
    const workflow = buildControlNetWorkflow({
      model: "sd15.safetensors",
      prompt: "a portrait",
      width: 512,
      height: 768,
      controlNet: {
        type: "canny",
        image: "control.png",
        controlNetModel: "control_canny.safetensors",
        strength: 1.0,
        startPercent: 0.0,
        endPercent: 1.0,
      },
      preprocess: false,
    });

    const result = validateWorkflow(workflow, schema, { allowUnknownNodes: true });
    expectValid(result);
  });

  it("validates strength constraints", () => {
    const workflow = buildControlNetWorkflow({
      model: "model.safetensors",
      prompt: "test",
      width: 512,
      height: 512,
      controlNet: {
        type: "depth",
        image: "depth.png",
        controlNetModel: "control_depth.safetensors",
        strength: 1.5, // Above 1.0 but should be valid (max is 10.0)
        startPercent: 0.0,
        endPercent: 1.0,
      },
      preprocess: false,
    });

    const result = validateWorkflow(workflow, schema, { allowUnknownNodes: true });
    expectValid(result);
  });

  it("has ControlNet-specific nodes", () => {
    const workflow = buildControlNetWorkflow({
      model: "model.safetensors",
      prompt: "test",
      width: 512,
      height: 512,
      controlNet: {
        type: "canny",
        image: "edge.png",
        controlNetModel: "controlnet.safetensors",
        strength: 1.0,
        startPercent: 0.0,
        endPercent: 1.0,
      },
      preprocess: false,
    });

    const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);
    expect(nodeTypes).toContain("ControlNetLoader");
    expect(nodeTypes).toContain("ControlNetApplyAdvanced");
    expect(nodeTypes).toContain("LoadImage");
  });
});

// ============================================================================
// Inpaint Workflow Contract Tests
// ============================================================================

describe("Contract: buildInpaintWorkflow", () => {
  it("produces valid workflow", () => {
    const workflow = buildInpaintWorkflow({
      model: "sd15_inpaint.safetensors",
      prompt: "a red apple",
      sourceImage: "photo.png",
      maskImage: "mask.png",
      denoise: 0.85,
      growMaskBy: 8,
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);
  });

  it("has inpaint-specific nodes", () => {
    const workflow = buildInpaintWorkflow({
      model: "model.safetensors",
      prompt: "test",
      sourceImage: "source.png",
      maskImage: "mask.png",
      denoise: 0.8,
      growMaskBy: 6,
    });

    const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);
    expect(nodeTypes).toContain("VAEEncodeForInpaint");
    expect(nodeTypes).toContain("LoadImage");
  });

  it("validates grow_mask_by constraints", () => {
    const workflow = buildInpaintWorkflow({
      model: "model.safetensors",
      prompt: "test",
      sourceImage: "source.png",
      maskImage: "mask.png",
      denoise: 0.8,
      growMaskBy: 32, // Within valid range (0-64)
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);
  });
});

// ============================================================================
// Outpaint Workflow Contract Tests
// ============================================================================

describe("Contract: buildOutpaintWorkflow", () => {
  it("produces valid workflow with padding", () => {
    const workflow = buildOutpaintWorkflow({
      model: "sd15.safetensors",
      prompt: "extended landscape",
      sourceImage: "original.png",
      extendLeft: 128,
      extendRight: 128,
      extendTop: 0,
      extendBottom: 64,
      feathering: 40,
      denoise: 0.9,
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);
  });

  it("has outpaint-specific nodes", () => {
    const workflow = buildOutpaintWorkflow({
      model: "model.safetensors",
      prompt: "test",
      sourceImage: "source.png",
      extendLeft: 64,
      extendRight: 64,
      extendTop: 0,
      extendBottom: 0,
      feathering: 40,
      denoise: 0.9,
    });

    const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);
    expect(nodeTypes).toContain("ImagePadForOutpaint");
    // Uses VAEEncodeForInpaint instead of SetLatentNoiseMask for outpainting
    expect(nodeTypes).toContain("VAEEncodeForInpaint");
  });
});

// ============================================================================
// Upscale Workflow Contract Tests
// ============================================================================

describe("Contract: buildUpscaleWorkflow", () => {
  it("produces valid workflow", () => {
    const workflow = buildUpscaleWorkflow({
      inputImage: "lowres.png",
      upscaleModel: "RealESRGAN_x4plus.pth",
      targetWidth: 2048,
      targetHeight: 2048,
      filenamePrefix: "upscaled",
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);
  });

  it("has upscale-specific nodes", () => {
    const workflow = buildUpscaleWorkflow({
      inputImage: "input.png",
      upscaleModel: "4x-UltraSharp.pth",
      targetWidth: 2048,
      targetHeight: 2048,
    });

    const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);
    expect(nodeTypes).toContain("UpscaleModelLoader");
    expect(nodeTypes).toContain("ImageUpscaleWithModel");
    expect(nodeTypes).toContain("ImageScale"); // Only present when target dimensions provided
    expect(nodeTypes).toContain("SaveImage");
  });

  it("removes ImageScale when no target dimensions", () => {
    const workflow = buildUpscaleWorkflow({
      inputImage: "input.png",
      upscaleModel: "4x-UltraSharp.pth",
    });

    const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);
    expect(nodeTypes).toContain("UpscaleModelLoader");
    expect(nodeTypes).toContain("ImageUpscaleWithModel");
    expect(nodeTypes).not.toContain("ImageScale"); // Removed without target dimensions
    expect(nodeTypes).toContain("SaveImage");
  });
});

// ============================================================================
// IP-Adapter Workflow Contract Tests
// ============================================================================

describe("Contract: buildIPAdapterWorkflow", () => {
  it("produces valid workflow with minimal params", () => {
    const workflow = buildIPAdapterWorkflow({
      model: "sd15.safetensors",
      prompt: "a character",
      referenceImage: "reference.png",
      width: 512,
      height: 768,
      weight: 0.8,
      weightType: "linear",
      startAt: 0.0,
      endAt: 1.0,
      combineEmbeds: "concat",
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);
  });

  it("validates weight_type enum values", () => {
    const weightTypes = [
      "linear",
      "ease in",
      "ease out",
      "style transfer",
      "composition",
    ];

    for (const weightType of weightTypes) {
      const workflow = buildIPAdapterWorkflow({
        model: "model.safetensors",
        prompt: "test",
        referenceImage: "ref.png",
        width: 512,
        height: 512,
        weight: 0.8,
        weightType: weightType as any,
        startAt: 0.0,
        endAt: 1.0,
        combineEmbeds: "concat",
      });

      const result = validateWorkflow(workflow, schema);
      expectValid(result);
    }
  });

  it("validates combine_embeds enum values", () => {
    const combineOptions = ["concat", "add", "subtract", "average", "norm average"];

    for (const combineEmbeds of combineOptions) {
      const workflow = buildIPAdapterWorkflow({
        model: "model.safetensors",
        prompt: "test",
        referenceImage: "ref.png",
        width: 512,
        height: 512,
        weight: 0.8,
        weightType: "linear",
        startAt: 0.0,
        endAt: 1.0,
        combineEmbeds: combineEmbeds as any,
      });

      const result = validateWorkflow(workflow, schema);
      expectValid(result);
    }
  });

  it("has IP-Adapter specific nodes", () => {
    const workflow = buildIPAdapterWorkflow({
      model: "model.safetensors",
      prompt: "test",
      referenceImage: "ref.png",
      width: 512,
      height: 512,
      weight: 0.8,
      weightType: "linear",
      startAt: 0.0,
      endAt: 1.0,
      combineEmbeds: "concat",
    });

    const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);
    expect(nodeTypes).toContain("IPAdapterModelLoader");
    expect(nodeTypes).toContain("IPAdapterAdvanced");
    expect(nodeTypes).toContain("CLIPVisionLoader");
  });
});

// ============================================================================
// TTS Workflow Contract Tests
// ============================================================================

describe("Contract: buildTTSWorkflow", () => {
  it("produces valid workflow", () => {
    const workflow = buildTTSWorkflow({
      text: "Hello, this is a test.",
      voiceReference: "voice_sample.wav",
      voiceReferenceText: "This is my voice sample.",
      model: "F5TTS_v1_Base",
      speed: 1.0,
      seed: 42,
      filenamePrefix: "tts_output",
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);
  });

  it("has TTS-specific nodes", () => {
    const workflow = buildTTSWorkflow({
      text: "Test speech",
      voiceReference: "voice.wav",
      voiceReferenceText: "Reference text",
      model: "F5TTS_v1_Base",
      speed: 1.0,
      seed: 0,
      filenamePrefix: "tts",
    });

    const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);
    expect(nodeTypes).toContain("LoadAudio");
    expect(nodeTypes).toContain("F5TTSAudioInputs");
  });

  it("validates speed constraints", () => {
    const workflow = buildTTSWorkflow({
      text: "Test",
      voiceReference: "voice.wav",
      voiceReferenceText: "Ref",
      model: "F5TTS_v1_Base",
      speed: 1.5, // Within 0.1-10.0 range
      seed: 0,
      filenamePrefix: "tts",
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);
  });
});

// ============================================================================
// LipSync Workflow Contract Tests
// ============================================================================

describe("Contract: buildLipSyncWorkflow", () => {
  it("produces valid workflow", () => {
    const workflow = buildLipSyncWorkflow({
      portraitImage: "portrait.png",
      audio: "speech.wav",
      svdCheckpoint: "svd_xt_1_1.safetensors",
      sonicUnet: "unet.pth",
      fps: 25,
      duration: 10,
      minResolution: 512,
      expandRatio: 1.0,
      inferenceSteps: 25,
      seed: 42,
      filenamePrefix: "lipsync_output",
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);
  });

  it("has LipSync-specific nodes", () => {
    const workflow = buildLipSyncWorkflow({
      portraitImage: "face.png",
      audio: "audio.wav",
      svdCheckpoint: "svd.safetensors",
      sonicUnet: "unet.pth",
      fps: 25,
      duration: 5,
      minResolution: 512,
      expandRatio: 1.0,
      inferenceSteps: 25,
      seed: 0,
      filenamePrefix: "lipsync",
    });

    const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);
    expect(nodeTypes).toContain("ImageOnlyCheckpointLoader");
    expect(nodeTypes).toContain("SONICTLoader");
    expect(nodeTypes).toContain("SONIC_PreData");
    expect(nodeTypes).toContain("SONICSampler");
    expect(nodeTypes).toContain("VHS_VideoCombine");
  });

  it("validates FPS constraints", () => {
    const workflow = buildLipSyncWorkflow({
      portraitImage: "face.png",
      audio: "audio.wav",
      svdCheckpoint: "svd.safetensors",
      sonicUnet: "unet.pth",
      fps: 30, // Within 1-60 range
      duration: 5,
      minResolution: 512,
      expandRatio: 1.0,
      inferenceSteps: 25,
      seed: 0,
      filenamePrefix: "test",
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);
  });
});

// ============================================================================
// Cross-Cutting Validation Tests
// ============================================================================

describe("Contract: Cross-cutting validation", () => {
  it("all workflows have at least one output node", () => {
    const workflows = [
      buildTxt2ImgWorkflow({ model: "m", prompt: "p", width: 512, height: 512 }),
      buildImg2ImgWorkflow({ model: "m", prompt: "p", inputImage: "i", denoise: 0.7 }),
      buildUpscaleWorkflow({ inputImage: "i", upscaleModel: "m" }),
      buildTTSWorkflow({
        text: "t",
        voiceReference: "v",
        voiceReferenceText: "r",
        model: "m",
        speed: 1,
        seed: 0,
        filenamePrefix: "p",
      }),
    ];

    for (const workflow of workflows) {
      const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);
      const hasOutputNode = nodeTypes.some((t) =>
        ["SaveImage", "SaveAudioTensor", "VHS_VideoCombine"].includes(t)
      );
      expect(hasOutputNode).toBe(true);
    }
  });

  it("node connections reference valid nodes", () => {
    const workflow = buildTxt2ImgWorkflow({
      model: "model.safetensors",
      prompt: "test",
      width: 512,
      height: 512,
    });

    const result = validateWorkflow(workflow, schema);
    expectValid(result);
    expect(result.stats.connectionCount).toBeGreaterThan(0);
  });

  it("validates all connection indices are within bounds", () => {
    const workflow = buildTxt2ImgWorkflow({
      model: "model.safetensors",
      prompt: "test",
      width: 512,
      height: 512,
    });

    const result = validateWorkflow(workflow, schema);

    // No errors about output index out of range
    const indexErrors = result.errors.filter((e) =>
      e.message.includes("Output index")
    );
    expect(indexErrors).toHaveLength(0);
  });
});

// ============================================================================
// Schema Validation Edge Cases
// ============================================================================

describe("Contract: Schema edge cases", () => {
  it("reports unknown node types", () => {
    const workflow = {
      "1": {
        class_type: "NonExistentNode",
        inputs: {},
      },
    };

    const result = validateWorkflow(workflow, schema);
    expect(result.valid).toBe(false);
    expect(result.stats.unknownNodeTypes).toContain("NonExistentNode");
  });

  it("allows unknown nodes with option", () => {
    const workflow = {
      "1": {
        class_type: "CustomNode",
        inputs: {},
      },
    };

    const result = validateWorkflow(workflow, schema, { allowUnknownNodes: true });
    expect(result.valid).toBe(true);
  });

  it("reports missing required inputs", () => {
    const workflow = {
      "1": {
        class_type: "KSampler",
        inputs: {
          // Missing all required inputs
        },
      },
    };

    const result = validateWorkflow(workflow, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.message.includes("Missing required"))).toBe(true);
  });

  it("reports invalid connection references", () => {
    const workflow = {
      "1": {
        class_type: "SaveImage",
        inputs: {
          images: ["99", 0], // Node 99 doesn't exist
          filename_prefix: "test",
        },
      },
    };

    const result = validateWorkflow(workflow, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("non-existent node"))).toBe(true);
  });

  it("reports type mismatches", () => {
    const workflow = {
      "1": {
        class_type: "EmptyLatentImage",
        inputs: {
          width: "not a number", // Should be INT
          height: 512,
          batch_size: 1,
        },
      },
    };

    const result = validateWorkflow(workflow, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("Expected integer"))).toBe(true);
  });

  it("reports values out of range", () => {
    const workflow = {
      "1": {
        class_type: "KSampler",
        inputs: {
          model: ["2", 0],
          seed: 0,
          steps: 999999, // Way above max (10000)
          cfg: 7,
          sampler_name: "euler",
          scheduler: "normal",
          positive: ["3", 0],
          negative: ["4", 0],
          latent_image: ["5", 0],
          denoise: 1.0,
        },
      },
      "2": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "m" } },
      "3": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 1], text: "p" } },
      "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 1], text: "n" } },
      "5": { class_type: "EmptyLatentImage", inputs: { width: 512, height: 512, batch_size: 1 } },
    };

    const result = validateWorkflow(workflow, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("above maximum"))).toBe(true);
  });
});

// ============================================================================
// Z-Image Turbo Workflow Contract Tests
// ============================================================================

describe("Contract: buildZTurboTxt2ImgWorkflow", () => {
  // Note: Z-Image Turbo uses newer nodes (UNETLoader, CLIPLoader, VAELoader, EmptySD3LatentImage)
  // that may not be in the bundled schema. We use allowUnknownNodes: true for these tests.

  it("produces valid workflow with minimal params", () => {
    const workflow = buildZTurboTxt2ImgWorkflow({
      model: "z_image_turbo_bf16.safetensors",
      prompt: "A professional headshot photograph of an adult woman in her early thirties.",
      width: 768,
      height: 1024,
    });

    const result = validateWorkflow(workflow, schema, { allowUnknownNodes: true });
    expectValid(result);
  });

  it("produces valid workflow with all params", () => {
    const workflow = buildZTurboTxt2ImgWorkflow({
      model: "z_image_turbo_bf16.safetensors",
      prompt: "A mystical forest at twilight with glowing mushrooms and ethereal lighting.",
      width: 1024,
      height: 768,
      steps: 8,
      cfgScale: 1.0,
      sampler: "euler",
      scheduler: "simple",
      seed: 42,
      filenamePrefix: "zturbo_test",
      unetModel: "z_image_turbo_bf16.safetensors",
      clipModel: "qwen_3_4b.safetensors",
      vaeModel: "ae.safetensors",
      loras: [
        { name: "RetroPop01a_CE_ZIMGT_AIT5k.safetensors", strength_model: 0.5, strength_clip: 0.5 },
      ],
    });

    const result = validateWorkflow(workflow, schema, { allowUnknownNodes: true });
    expectValid(result);
  });

  it("has correct Z-Image Turbo node types (NOT CheckpointLoaderSimple)", () => {
    const workflow = buildZTurboTxt2ImgWorkflow({
      model: "z_image_turbo_bf16.safetensors",
      prompt: "test",
      width: 768,
      height: 1024,
    });

    const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);

    // Z-Image Turbo uses separate loaders (NOT CheckpointLoaderSimple)
    expect(nodeTypes).toContain("UNETLoader");
    expect(nodeTypes).toContain("CLIPLoader");
    expect(nodeTypes).toContain("VAELoader");
    expect(nodeTypes).not.toContain("CheckpointLoaderSimple");

    // Uses SD3 latent format
    expect(nodeTypes).toContain("EmptySD3LatentImage");
    expect(nodeTypes).not.toContain("EmptyLatentImage");

    // Standard nodes still present
    expect(nodeTypes).toContain("KSampler");
    expect(nodeTypes).toContain("CLIPTextEncode");
    expect(nodeTypes).toContain("VAEDecode");
    expect(nodeTypes).toContain("SaveImage");
  });

  it("uses lumina2 CLIP type", () => {
    const workflow = buildZTurboTxt2ImgWorkflow({
      model: "z_image_turbo_bf16.safetensors",
      prompt: "test",
      width: 768,
      height: 1024,
    });

    // Find CLIPLoader node and verify lumina2 type
    const clipNode = Object.values(workflow).find(
      (n: any) => n.class_type === "CLIPLoader"
    );
    expect(clipNode).toBeDefined();
    expect((clipNode as any).inputs.type).toBe("lumina2");
  });

  it("forces CFG to 1.0 regardless of input", () => {
    const workflow = buildZTurboTxt2ImgWorkflow({
      model: "z_image_turbo_bf16.safetensors",
      prompt: "test",
      width: 768,
      height: 1024,
      cfgScale: 7.5, // User tries to set CFG
    });

    // Find KSampler and verify CFG is 1.0
    const ksampler = Object.values(workflow).find(
      (n: any) => n.class_type === "KSampler"
    );
    expect(ksampler).toBeDefined();
    expect((ksampler as any).inputs.cfg).toBe(1.0);
  });

  it("uses empty negative prompt", () => {
    const workflow = buildZTurboTxt2ImgWorkflow({
      model: "z_image_turbo_bf16.safetensors",
      prompt: "test",
      negativePrompt: "bad quality, blurry", // User tries to set negative
      width: 768,
      height: 1024,
    });

    // Find negative text encoder (node 6) and verify empty text
    expect(workflow["6"]).toBeDefined();
    expect(workflow["6"].inputs.text).toBe("");
  });

  it("defaults to 8 steps for turbo distillation", () => {
    const workflow = buildZTurboTxt2ImgWorkflow({
      model: "z_image_turbo_bf16.safetensors",
      prompt: "test",
      width: 768,
      height: 1024,
    });

    const ksampler = Object.values(workflow).find(
      (n: any) => n.class_type === "KSampler"
    );
    expect((ksampler as any).inputs.steps).toBe(8);
  });

  it("correctly wires LoRAs into Z-Turbo workflow", () => {
    const workflow = buildZTurboTxt2ImgWorkflow({
      model: "z_image_turbo_bf16.safetensors",
      prompt: "test",
      width: 768,
      height: 1024,
      loras: [
        { name: "lora1.safetensors", strength_model: 0.5, strength_clip: 0.5 },
        { name: "lora2.safetensors", strength_model: 0.3, strength_clip: 0.3 },
      ],
    });

    const result = validateWorkflow(workflow, schema, { allowUnknownNodes: true });
    expectValid(result);

    // Should have LoRA nodes
    const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);
    expect(nodeTypes.filter((t) => t === "LoraLoader").length).toBe(2);

    // First LoRA should connect to UNETLoader and CLIPLoader outputs
    const firstLora = workflow["lora_0"];
    expect(firstLora).toBeDefined();
    expect(firstLora.inputs.model[0]).toBe("1"); // UNETLoader
    expect(firstLora.inputs.clip[0]).toBe("2"); // CLIPLoader
  });
});

describe("Contract: buildZTurboImg2ImgWorkflow", () => {
  // Note: Z-Image Turbo uses newer nodes that may not be in the bundled schema

  it("produces valid workflow with minimal params", () => {
    const workflow = buildZTurboImg2ImgWorkflow({
      model: "z_image_turbo_bf16.safetensors",
      prompt: "enhanced version with more detail",
      inputImage: "input.png",
      denoise: 0.5,
    });

    const result = validateWorkflow(workflow, schema, { allowUnknownNodes: true });
    expectValid(result);
  });

  it("has correct Z-Image Turbo img2img node types", () => {
    const workflow = buildZTurboImg2ImgWorkflow({
      model: "z_image_turbo_bf16.safetensors",
      prompt: "test",
      inputImage: "input.png",
      denoise: 0.5,
    });

    const nodeTypes = Object.values(workflow).map((n: any) => n.class_type);

    // Z-Image Turbo uses separate loaders
    expect(nodeTypes).toContain("UNETLoader");
    expect(nodeTypes).toContain("CLIPLoader");
    expect(nodeTypes).toContain("VAELoader");
    expect(nodeTypes).not.toContain("CheckpointLoaderSimple");

    // Img2img specific
    expect(nodeTypes).toContain("LoadImage");
    expect(nodeTypes).toContain("VAEEncode");
    expect(nodeTypes).toContain("KSampler");
    expect(nodeTypes).toContain("VAEDecode");
    expect(nodeTypes).toContain("SaveImage");
  });

  it("uses lumina2 CLIP type in img2img", () => {
    const workflow = buildZTurboImg2ImgWorkflow({
      model: "z_image_turbo_bf16.safetensors",
      prompt: "test",
      inputImage: "input.png",
      denoise: 0.5,
    });

    const clipNode = Object.values(workflow).find(
      (n: any) => n.class_type === "CLIPLoader"
    );
    expect(clipNode).toBeDefined();
    expect((clipNode as any).inputs.type).toBe("lumina2");
  });

  it("validates denoise range", () => {
    for (const denoise of [0.1, 0.3, 0.5, 0.7]) {
      const workflow = buildZTurboImg2ImgWorkflow({
        model: "z_image_turbo_bf16.safetensors",
        prompt: "test",
        inputImage: "input.png",
        denoise,
      });
      const result = validateWorkflow(workflow, schema, { allowUnknownNodes: true });
      expectValid(result);
    }
  });
});

describe("Contract: isZImageTurboModel", () => {
  it("detects z_image pattern", () => {
    expect(isZImageTurboModel("z_image_turbo_bf16.safetensors")).toBe(true);
    expect(isZImageTurboModel("z_image_turbo.safetensors")).toBe(true);
    expect(isZImageTurboModel("z_image.gguf")).toBe(true);
  });

  it("detects z-image pattern (hyphenated)", () => {
    expect(isZImageTurboModel("z-image-turbo.safetensors")).toBe(true);
    expect(isZImageTurboModel("z-image_v2.safetensors")).toBe(true);
  });

  it("detects zimage pattern (no separator)", () => {
    expect(isZImageTurboModel("zImageTurbo.safetensors")).toBe(true);
    expect(isZImageTurboModel("zimageturbo_bf16.safetensors")).toBe(true);
  });

  it("detects zimgt LoRA naming convention", () => {
    expect(isZImageTurboModel("RetroPop01a_CE_ZIMGT_AIT5k.safetensors")).toBe(true);
    expect(isZImageTurboModel("ClayArt01a_CE_ZIMGT_AIT4k.safetensors")).toBe(true);
  });

  it("detects lumina turbo pattern", () => {
    expect(isZImageTurboModel("lumina2_turbo.safetensors")).toBe(true);
    expect(isZImageTurboModel("lumina_turbo_v3.safetensors")).toBe(true);
  });

  it("detects Copax TimeLess Z variant", () => {
    expect(isZImageTurboModel("copax_timeless_z.safetensors")).toBe(true);
    expect(isZImageTurboModel("Copax_TimeLess_XPlus-Z.safetensors")).toBe(true);
  });

  it("does NOT detect non-Z-Image models", () => {
    expect(isZImageTurboModel("sdxl_base.safetensors")).toBe(false);
    expect(isZImageTurboModel("flux1-schnell-fp8.safetensors")).toBe(false);
    expect(isZImageTurboModel("novaFurryXL_v13.safetensors")).toBe(false);
    expect(isZImageTurboModel("illustrious_v1.safetensors")).toBe(false);
    expect(isZImageTurboModel("ponyDiffusion_v6.safetensors")).toBe(false);
    expect(isZImageTurboModel("cyberrealistic_v40.safetensors")).toBe(false);
  });
});
