import { describe, it, expect, beforeEach } from "vitest";
import { PromptGenerator } from "./generator.js";

describe("PromptGenerator", () => {
  let generator: PromptGenerator;

  beforeEach(() => {
    generator = new PromptGenerator();
  });

  describe("generate", () => {
    it("should generate prompt with explicit model family", () => {
      const result = generator.generate({
        description: "a beautiful sunset over mountains",
        modelFamily: "sdxl",
      });

      expect(result.positive).toContain("sunset");
      expect(result.modelFamily).toBe("sdxl");
      expect(result.recommendedSettings).toBeDefined();
    });

    it("should auto-detect model family from model name", () => {
      const result = generator.generate({
        description: "a portrait",
        modelName: "flux1-schnell-fp8.safetensors",
      });

      expect(result.modelFamily).toBe("flux");
      expect(result.explanation).toContain("detected");
    });

    it("should default to SDXL when no model specified", () => {
      const result = generator.generate({
        description: "a cat",
      });

      expect(result.modelFamily).toBe("sdxl");
    });

    it("should include style keywords when style preset is specified", () => {
      const result = generator.generate({
        description: "a landscape",
        modelFamily: "sdxl",
        style: "cinematic",
      });

      expect(result.positive.toLowerCase()).toContain("cinematic");
    });

    it("should apply correct settings for each model family", () => {
      // Flux uses lower CFG
      const fluxResult = generator.generate({
        description: "test",
        modelFamily: "flux",
      });
      expect(fluxResult.recommendedSettings.cfgScale).toBeLessThanOrEqual(4);
      expect(fluxResult.negative).toBe(""); // Flux doesn't use negative prompts

      // Pony uses score tags
      const ponyResult = generator.generate({
        description: "test",
        modelFamily: "pony",
      });
      expect(ponyResult.positive).toContain("score_9");
    });
  });

  describe("Illustrious strategy", () => {
    it("should include quality tags", () => {
      const result = generator.generate({
        description: "a girl with blue hair",
        modelFamily: "illustrious",
      });

      expect(result.positive).toContain("masterpiece");
      expect(result.positive).toContain("best quality");
    });

    it("should have extensive negative prompt", () => {
      const result = generator.generate({
        description: "a portrait",
        modelFamily: "illustrious",
      });

      expect(result.negative.length).toBeGreaterThan(50);
      expect(result.negative).toContain("lowres");
    });

    it("should recommend Euler A sampler", () => {
      const result = generator.generate({
        description: "test",
        modelFamily: "illustrious",
      });

      expect(result.recommendedSettings.sampler).toBe("euler_ancestral");
    });
  });

  describe("Pony strategy", () => {
    it("should include score tags at the beginning", () => {
      const result = generator.generate({
        description: "a character",
        modelFamily: "pony",
      });

      expect(result.positive.startsWith("score_9")).toBe(true);
      expect(result.positive).toContain("score_8_up");
    });

    it("should include source tags", () => {
      const result = generator.generate({
        description: "an anime character",
        modelFamily: "pony",
        style: "anime",
      });

      expect(result.positive).toContain("source_anime");
    });

    it("should include rating tags", () => {
      const result = generator.generate({
        description: "a portrait",
        modelFamily: "pony",
        rating: "safe",
      });

      expect(result.positive).toContain("rating_safe");
    });
  });

  describe("Flux strategy", () => {
    it("should use natural language prompts", () => {
      const result = generator.generate({
        description: "A woman walking through a forest",
        modelFamily: "flux",
        style: "cinematic",
      });

      // Flux prompts should be sentence-like, not tag-based
      expect(result.positive).not.toContain("1girl");
      // Should contain natural language descriptions
      expect(result.positive.toLowerCase()).toContain("woman");
      expect(result.positive.toLowerCase()).toContain("forest");
    });

    it("should NOT have negative prompt", () => {
      const result = generator.generate({
        description: "a landscape",
        modelFamily: "flux",
      });

      expect(result.negative).toBe("");
    });

    it("should recommend low CFG", () => {
      const result = generator.generate({
        description: "test",
        modelFamily: "flux",
      });

      expect(result.recommendedSettings.cfgScale).toBeLessThanOrEqual(4);
    });
  });

  describe("Realistic strategy", () => {
    it("should include camera terminology", () => {
      const result = generator.generate({
        description: "a portrait photo",
        modelFamily: "realistic",
        camera: {
          focalLength: "85mm",
          aperture: "f/1.4",
        },
      });

      expect(result.positive).toContain("85mm");
      expect(result.positive).toContain("f/1.4");
    });

    it("should include photo quality markers", () => {
      const result = generator.generate({
        description: "a person",
        modelFamily: "realistic",
      });

      expect(result.positive).toContain("RAW photo");
    });
  });

  describe("LoRA recommendations", () => {
    it("should provide LoRA recommendations when available", () => {
      generator.setAvailableLoras([
        "detail_enhancer.safetensors",
        "anime_style.safetensors",
        "film_grain.safetensors",
      ]);

      const result = generator.generate({
        description: "a portrait",
        modelFamily: "realistic",
        style: "cinematic",
      });

      expect(result.recommendedLoras).toBeDefined();
      expect(result.recommendedLoras!.length).toBeGreaterThan(0);
    });

    it("should not recommend LoRAs when none available", () => {
      // Don't set available LoRAs
      const result = generator.generate({
        description: "a portrait",
        modelFamily: "sdxl",
      });

      expect(result.recommendedLoras).toBeUndefined();
    });
  });

  describe("Pipeline suggestions", () => {
    it("should suggest hi-res pipeline for portrait style", () => {
      const result = generator.generate({
        description: "a portrait",
        modelFamily: "sdxl",
        style: "portrait",
      });

      expect(result.suggestedPipeline).toBeDefined();
      expect(result.suggestedPipeline!.name).toContain("Hi-Res");
    });

    it("should suggest hi-res pipeline for realistic photos", () => {
      const result = generator.generate({
        description: "a photo",
        modelFamily: "sdxl",
        style: "realistic_photo",
      });

      expect(result.suggestedPipeline).toBeDefined();
    });
  });

  describe("getSupportedFamilies", () => {
    it("should return all supported model families", () => {
      const families = generator.getSupportedFamilies();

      expect(families).toContain("illustrious");
      expect(families).toContain("pony");
      expect(families).toContain("flux");
      expect(families).toContain("sdxl");
      expect(families).toContain("realistic");
      expect(families).toContain("sd15");
    });
  });

  describe("getStrategyInfo", () => {
    it("should return tips and example for each family", () => {
      const info = generator.getStrategyInfo("pony");

      expect(info.name).toContain("Pony");
      expect(info.tips.length).toBeGreaterThan(0);
      expect(info.examplePrompt).toContain("score_9");
    });
  });
});
