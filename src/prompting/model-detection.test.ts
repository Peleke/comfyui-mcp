import { describe, it, expect } from "vitest";
import { detectModelFamily, getStrategyName } from "./model-detection.js";

describe("detectModelFamily", () => {
  describe("Flux models", () => {
    it("should detect flux models", () => {
      expect(detectModelFamily("flux1-schnell-fp8.safetensors").family).toBe("flux");
      expect(detectModelFamily("flux-dev.safetensors").family).toBe("flux");
    });

    it("should have high confidence for flux detection", () => {
      const result = detectModelFamily("flux1-schnell-fp8.safetensors");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe("Pony models", () => {
    it("should detect pony models", () => {
      expect(detectModelFamily("ponyDiffusionV6XL.safetensors").family).toBe("pony");
      expect(detectModelFamily("pdxl_v1.safetensors").family).toBe("pony");
    });

    it("should detect furry models as pony family", () => {
      expect(detectModelFamily("furryDreams_v10.safetensors").family).toBe("pony");
      expect(detectModelFamily("yiffInHell.safetensors").family).toBe("pony");
    });
  });

  describe("Illustrious models", () => {
    it("should detect illustrious models", () => {
      expect(detectModelFamily("illustriousXL_v10.safetensors").family).toBe("illustrious");
      expect(detectModelFamily("waiIllustriousSDXL_v160.safetensors").family).toBe("illustrious");
    });

    it("should detect noob models as illustrious", () => {
      expect(detectModelFamily("noobaiXL_v1.safetensors").family).toBe("illustrious");
    });
  });

  describe("Realistic models", () => {
    it("should detect realistic photo models", () => {
      expect(detectModelFamily("cyberrealistic_v90.safetensors").family).toBe("realistic");
      expect(detectModelFamily("dreamshaper_8.safetensors").family).toBe("realistic");
      expect(detectModelFamily("photon_v1.safetensors").family).toBe("realistic");
    });
  });

  describe("SDXL models", () => {
    it("should detect SDXL models", () => {
      expect(detectModelFamily("sdXL_v10.safetensors").family).toBe("sdxl");
      expect(detectModelFamily("sd_xl_base_1.0.safetensors").family).toBe("sdxl");
    });
  });

  describe("SD 1.5 models", () => {
    it("should detect SD 1.5 models", () => {
      expect(detectModelFamily("v1-5-pruned-emaonly.ckpt").family).toBe("sd15");
      expect(detectModelFamily("sd15_model.safetensors").family).toBe("sd15");
    });
  });

  describe("Unknown models", () => {
    it("should default to SDXL for unknown models", () => {
      expect(detectModelFamily("totally_unknown_model.safetensors").family).toBe("sdxl");
    });

    it("should have low confidence for unknown models", () => {
      const result = detectModelFamily("totally_unknown_model.safetensors");
      expect(result.confidence).toBeLessThan(0.5);
    });

    it("should default to SDXL when no model name provided", () => {
      expect(detectModelFamily("").family).toBe("sdxl");
    });
  });
});

describe("getStrategyName", () => {
  it("should return correct names for each family", () => {
    expect(getStrategyName("flux")).toContain("Flux");
    expect(getStrategyName("pony")).toContain("Pony");
    expect(getStrategyName("illustrious")).toContain("Illustrious");
    expect(getStrategyName("sdxl")).toContain("SDXL");
    expect(getStrategyName("realistic")).toContain("Realistic");
    expect(getStrategyName("sd15")).toContain("SD 1.5");
  });
});
