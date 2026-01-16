import { describe, it, expect, beforeEach } from "vitest";
import {
  architectures,
  ArchitectureRegistry,
  sd15Architecture,
  sdxlArchitecture,
  ponyArchitecture,
  illustriousArchitecture,
  fluxArchitecture,
} from "./index.js";

describe("Architecture Plugin System", () => {
  describe("ArchitectureRegistry", () => {
    describe("detection", () => {
      it("should detect Flux models with highest priority", () => {
        const result = architectures.detect("flux1-schnell-Q8_0.gguf");
        expect(result.architecture.id).toBe("flux");
        expect(result.confidence).toBe(1.0);
      });

      it("should detect schnell as Flux", () => {
        const result = architectures.detect("schnell.safetensors");
        expect(result.architecture.id).toBe("flux");
      });

      it("should detect Pony models", () => {
        const testCases = [
          "ponyDiffusionV6XL.safetensors",
          "novaFurryXL_v1.safetensors",  // furry -> pony
          "yiffinhell_v13.safetensors",   // yiff -> pony
          "score_9_model.safetensors",    // score_ -> pony
        ];

        for (const model of testCases) {
          const result = architectures.detect(model);
          expect(result.architecture.id).toBe("pony", `Expected ${model} to be detected as pony`);
        }
      });

      it("should detect Illustrious models", () => {
        const testCases = [
          "illustriousXL_v1.safetensors",
          "noobai_v1.safetensors",
          "waiANIMEXL.safetensors",
        ];

        for (const model of testCases) {
          const result = architectures.detect(model);
          expect(result.architecture.id).toBe("illustrious", `Expected ${model} to be detected as illustrious`);
        }
      });

      it("should detect generic SDXL models", () => {
        const testCases = [
          "sdxl_base_1.0.safetensors",
          "sdXL_v10.safetensors",
          "xl_base_model.safetensors",
        ];

        for (const model of testCases) {
          const result = architectures.detect(model);
          expect(result.architecture.id).toBe("sdxl", `Expected ${model} to be detected as sdxl`);
        }
      });

      it("should detect SD1.5 models", () => {
        const testCases = [
          "v1-5-pruned.safetensors",
          "sd15_model.ckpt",
          "stable-diffusion-1.5.safetensors",
        ];

        for (const model of testCases) {
          const result = architectures.detect(model);
          expect(result.architecture.id).toBe("sd15", `Expected ${model} to be detected as sd15`);
        }
      });

      it("should fall back to SDXL for unknown models", () => {
        const result = architectures.detect("some_random_model.safetensors");
        expect(result.architecture.id).toBe("sdxl");
        expect(result.confidence).toBe(0.3);
      });

      it("should fall back to SDXL for empty model name", () => {
        const result = architectures.detect("");
        expect(result.architecture.id).toBe("sdxl");
        expect(result.confidence).toBe(0.3);
      });

      it("should detect XL suffix as SDXL", () => {
        const result = architectures.detect("someModelXL.safetensors");
        expect(result.architecture.id).toBe("sdxl");
        expect(result.confidence).toBe(0.5);
      });
    });

    describe("ControlNet model selection", () => {
      it("should return SD1.5 ControlNet models for SD1.5 checkpoints", () => {
        const model = architectures.getControlNetModel("v1-5-pruned.safetensors", "canny");
        expect(model).toBe("control_v11p_sd15_canny_fp16.safetensors");
      });

      it("should return SDXL ControlNet models for SDXL checkpoints", () => {
        const model = architectures.getControlNetModel("sdxl_base.safetensors", "canny");
        expect(model).toBe("controlnet-canny-sdxl-1.0.safetensors");
      });

      it("should return SDXL ControlNet models for Pony checkpoints", () => {
        const model = architectures.getControlNetModel("ponyDiffusionV6XL.safetensors", "depth");
        expect(model).toBe("controlnet-depth-sdxl-1.0.safetensors");
      });

      it("should return SDXL ControlNet models for Illustrious checkpoints", () => {
        const model = architectures.getControlNetModel("illustriousXL_v1.safetensors", "openpose");
        expect(model).toBe("controlnet-openpose-sdxl-1.0.safetensors");
      });

      it("should return null for Flux checkpoints (no ControlNet support)", () => {
        const model = architectures.getControlNetModel("flux1-schnell.safetensors", "canny");
        expect(model).toBeNull();
      });

      it("should return correct models for all ControlNet types", () => {
        const controlTypes = ["canny", "depth", "openpose", "qrcode", "scribble", "lineart", "semantic_seg"] as const;

        for (const type of controlTypes) {
          const sd15Model = architectures.getControlNetModel("v1-5-pruned.safetensors", type);
          const sdxlModel = architectures.getControlNetModel("sdxl_base.safetensors", type);

          expect(sd15Model).not.toBeNull();
          expect(sdxlModel).not.toBeNull();
          expect(sd15Model).toContain("sd15");
          expect(sdxlModel).toContain("sdxl");
        }
      });
    });

    describe("IP-Adapter config selection", () => {
      it("should return SD1.5 IP-Adapter config for SD1.5 checkpoints", () => {
        const config = architectures.getIPAdapterConfig("v1-5-pruned.safetensors");
        expect(config).not.toBeNull();
        expect(config!.model).toBe("ip-adapter-plus_sd15.safetensors");
        expect(config!.clipVision).toBe("CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors");
      });

      it("should return SDXL IP-Adapter config for SDXL checkpoints", () => {
        const config = architectures.getIPAdapterConfig("sdxl_base.safetensors");
        expect(config).not.toBeNull();
        expect(config!.model).toBe("ip-adapter-plus_sdxl_vit-h.safetensors");
        expect(config!.clipVision).toBe("CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors");
      });

      it("should return SDXL IP-Adapter config for Pony checkpoints", () => {
        const config = architectures.getIPAdapterConfig("novaFurryXL_v1.safetensors");
        expect(config).not.toBeNull();
        expect(config!.model).toContain("sdxl");
      });

      it("should return null for Flux checkpoints (no IP-Adapter support)", () => {
        const config = architectures.getIPAdapterConfig("flux1-schnell.safetensors");
        expect(config).toBeNull();
      });
    });

    describe("architecture defaults", () => {
      it("should return correct defaults for SD1.5", () => {
        const defaults = architectures.getDefaults("v1-5-pruned.safetensors");
        expect(defaults.width).toBe(512);
        expect(defaults.height).toBe(768);
        expect(defaults.steps).toBe(20);
        expect(defaults.cfgScale).toBe(7);
      });

      it("should return correct defaults for SDXL", () => {
        const defaults = architectures.getDefaults("sdxl_base.safetensors");
        expect(defaults.width).toBe(1024);
        expect(defaults.height).toBe(1024);
        expect(defaults.steps).toBe(28);
        expect(defaults.cfgScale).toBe(7);
      });

      it("should return correct defaults for Flux", () => {
        const defaults = architectures.getDefaults("flux1-schnell.safetensors");
        expect(defaults.width).toBe(1024);
        expect(defaults.height).toBe(1024);
        expect(defaults.steps).toBe(4);
        expect(defaults.cfgScale).toBe(1);
      });
    });

    describe("capability checks", () => {
      it("should report negative prompt support correctly", () => {
        expect(architectures.supportsNegativePrompt("sdxl_base.safetensors")).toBe(true);
        expect(architectures.supportsNegativePrompt("v1-5-pruned.safetensors")).toBe(true);
        expect(architectures.supportsNegativePrompt("flux1-schnell.safetensors")).toBe(false);
      });

      it("should report weight syntax support correctly", () => {
        expect(architectures.supportsWeightSyntax("sdxl_base.safetensors")).toBe(true);
        expect(architectures.supportsWeightSyntax("v1-5-pruned.safetensors")).toBe(true);
        expect(architectures.supportsWeightSyntax("flux1-schnell.safetensors")).toBe(false);
      });
    });

    describe("registry listing", () => {
      it("should list all registered architectures", () => {
        const list = architectures.list();
        expect(list.length).toBeGreaterThanOrEqual(5);

        const ids = list.map(a => a.id);
        expect(ids).toContain("sd15");
        expect(ids).toContain("sdxl");
        expect(ids).toContain("flux");
        expect(ids).toContain("pony");
        expect(ids).toContain("illustrious");
      });

      it("should get architecture by ID", () => {
        const sdxl = architectures.get("sdxl");
        expect(sdxl).toBeDefined();
        expect(sdxl!.displayName).toBe("Stable Diffusion XL");
      });

      it("should check if architecture exists", () => {
        expect(architectures.has("sdxl")).toBe(true);
        expect(architectures.has("sd3" as any)).toBe(false);
      });
    });
  });

  describe("Individual Architecture Plugins", () => {
    describe("SD1.5 Plugin", () => {
      it("should have correct configuration", () => {
        expect(sd15Architecture.id).toBe("sd15");
        expect(sd15Architecture.supportsNegativePrompt).toBe(true);
        expect(sd15Architecture.supportsControlNet).toBe(true);
        expect(sd15Architecture.supportsIPAdapter).toBe(true);
        expect(sd15Architecture.defaults.width).toBe(512);
      });
    });

    describe("SDXL Plugin", () => {
      it("should have correct configuration", () => {
        expect(sdxlArchitecture.id).toBe("sdxl");
        expect(sdxlArchitecture.supportsNegativePrompt).toBe(true);
        expect(sdxlArchitecture.supportsControlNet).toBe(true);
        expect(sdxlArchitecture.supportsIPAdapter).toBe(true);
        expect(sdxlArchitecture.defaults.width).toBe(1024);
      });
    });

    describe("Pony Plugin", () => {
      it("should have correct configuration", () => {
        expect(ponyArchitecture.id).toBe("pony");
        expect(ponyArchitecture.priority).toBeGreaterThan(sdxlArchitecture.priority);
        expect(ponyArchitecture.controlNetModels).toBeDefined();
      });
    });

    describe("Illustrious Plugin", () => {
      it("should have correct configuration", () => {
        expect(illustriousArchitecture.id).toBe("illustrious");
        expect(illustriousArchitecture.priority).toBeGreaterThan(sdxlArchitecture.priority);
      });
    });

    describe("Flux Plugin", () => {
      it("should have correct configuration", () => {
        expect(fluxArchitecture.id).toBe("flux");
        expect(fluxArchitecture.supportsNegativePrompt).toBe(false);
        expect(fluxArchitecture.supportsWeightSyntax).toBe(false);
        expect(fluxArchitecture.supportsControlNet).toBe(false);
        expect(fluxArchitecture.supportsIPAdapter).toBe(false);
        expect(fluxArchitecture.defaults.cfgScale).toBe(1);
        expect(fluxArchitecture.defaults.steps).toBe(4);
      });
    });
  });

  describe("Priority-based detection", () => {
    it("should prefer higher priority patterns", () => {
      // Flux has highest priority (100), should win over generic XL detection
      const fluxResult = architectures.detect("flux_xl.safetensors");
      expect(fluxResult.architecture.id).toBe("flux");

      // Pony (90) should win over generic SDXL (50)
      const ponyResult = architectures.detect("pony_sdxl.safetensors");
      expect(ponyResult.architecture.id).toBe("pony");

      // Illustrious (85) should win over generic SDXL (50)
      const illusResult = architectures.detect("illustrious_sdxl.safetensors");
      expect(illusResult.architecture.id).toBe("illustrious");
    });
  });
});
