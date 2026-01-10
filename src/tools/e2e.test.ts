/**
 * End-to-End Integration Tests for Talking Avatar Pipeline
 *
 * These tests run against a live ComfyUI instance and verify the full pipeline:
 * 1. Portrait Generation (create_portrait)
 * 2. TTS Generation (tts_generate with F5-TTS)
 * 3. Lip-Sync Video (lipsync_generate)
 * 4. Full Pipeline (talk)
 *
 * Prerequisites:
 * - ComfyUI running at http://localhost:8188
 * - F5-TTS custom nodes installed
 * - SONIC or compatible lip-sync nodes installed
 * - Required models downloaded
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, beforeAll } from "vitest";
import { ComfyUIClient } from "../comfyui-client.js";
import { createPortrait, createPortraitSchema } from "./avatar.js";
import { ttsGenerate, ttsGenerateSchema, listTTSModels } from "./tts.js";
import { lipSyncGenerate, lipSyncGenerateSchema, listLipSyncModels } from "./lipsync.js";
import { talk, talkSchema } from "./lipsync.js";
import * as fs from "fs/promises";
import * as path from "path";

// Skip E2E tests unless explicitly enabled
const RUN_E2E = process.env.RUN_E2E === "true";
const describeE2E = RUN_E2E ? describe : describe.skip;

// Test output directory
const E2E_OUTPUT_DIR = "/tmp/comfyui-mcp-e2e";

// Test fixtures
const ODIN_DESCRIPTION = "Odin, the All-Father, Norse god, wise ancient being with one eye, long white beard";
const HAVAMAL_138 = "Veit ek, at ek hekk vindga meiði á, nætr allar níu";
const LATIN_SPEECH = "Veni, vidi, vici";

let client: ComfyUIClient;

describeE2E("E2E: Talking Avatar Pipeline", () => {
  beforeAll(async () => {
    // Verify ComfyUI is running
    client = new ComfyUIClient({
      url: process.env.COMFYUI_URL || "http://localhost:8188",
      outputDir: E2E_OUTPUT_DIR,
      timeout: 10 * 60 * 1000, // 10 minute timeout for E2E
    });

    // Create output directory
    await fs.mkdir(E2E_OUTPUT_DIR, { recursive: true });

    // Verify connection
    try {
      const info = await client.getObjectInfo();
      console.log("ComfyUI connected. Available nodes:", Object.keys(info).length);
    } catch (error) {
      throw new Error(`ComfyUI not available at ${process.env.COMFYUI_URL || "http://localhost:8188"}`);
    }
  });

  describe("Step 1: Portrait Generation", () => {
    it("generates a realistic portrait with SDXL backend", async () => {
      const outputPath = path.join(E2E_OUTPUT_DIR, "odin_realistic.png");

      const result = await createPortrait(
        {
          description: ODIN_DESCRIPTION,
          style: "realistic",
          gender: "male",
          age: "elderly",
          expression: "serious",
          backend: "sdxl",
          model: "cyberrealistic_v90.safetensors",
          guidance: 7.0,
          steps: 28,
          width: 768,
          height: 1024,
          seed: 42,
          output_path: outputPath,
        },
        client
      );

      // Verify output
      expect(result.image).toBe(outputPath);
      expect(result.prompt).toContain("Odin");

      // Verify file exists
      const stats = await fs.stat(outputPath);
      expect(stats.size).toBeGreaterThan(100000); // At least 100KB

      console.log("Portrait generated:", result.image);
      console.log("Prompt used:", result.prompt.substring(0, 100) + "...");
    }, 5 * 60 * 1000); // 5 minute timeout

    it("generates a furry portrait with novaFurryXL", async () => {
      const outputPath = path.join(E2E_OUTPUT_DIR, "wolf_furry.png");

      const result = await createPortrait(
        {
          description: "Wolf warrior, battle-scarred, silver fur, amber eyes",
          style: "furry",
          gender: "androgynous",
          expression: "serious",
          backend: "sdxl",
          model: "novaFurryXL_ilV130.safetensors",
          guidance: 7.0,
          steps: 28,
          width: 768,
          height: 1024,
          seed: 123,
          output_path: outputPath,
        },
        client
      );

      expect(result.image).toBe(outputPath);
      expect(result.prompt).toContain("anthro");

      const stats = await fs.stat(outputPath);
      expect(stats.size).toBeGreaterThan(100000);

      console.log("Furry portrait generated:", result.image);
    }, 5 * 60 * 1000);
  });

  describe("Step 2: TTS Generation", () => {
    it("lists available TTS models", async () => {
      const result = await listTTSModels({}, client);

      console.log("TTS Models available:");
      console.log("  F5-TTS:", result.f5tts.available ? result.f5tts.models : "not installed");
      console.log("  XTTS:", result.xtts.available ? result.xtts.models : "not installed");

      // At least one TTS system should be available
      expect(result.f5tts.available || result.xtts.available).toBe(true);
    });

    it("generates speech with F5-TTS", async () => {
      const outputPath = path.join(E2E_OUTPUT_DIR, "speech_latin.wav");

      // First check if F5-TTS is available
      const models = await listTTSModels({}, client);
      if (!models.f5tts.available) {
        console.log("Skipping: F5-TTS not installed");
        return;
      }

      const result = await ttsGenerate(
        {
          text: LATIN_SPEECH,
          voice_reference: "icelandic_male.wav", // Use a voice reference file
          output_path: outputPath,
          speed: 1.0,
          seed: -1,
          model: "F5TTS_v1_Base",
          vocoder: "vocos",
        },
        client
      );

      expect(result.audio).toBe(outputPath);
      expect(result.text).toBe(LATIN_SPEECH);

      const stats = await fs.stat(outputPath);
      expect(stats.size).toBeGreaterThan(10000); // At least 10KB

      console.log("TTS generated:", result.audio);
      console.log("Duration estimate:", Math.round(stats.size / 32000), "seconds");
    }, 3 * 60 * 1000);
  });

  describe("Step 3: Lip-Sync Generation", () => {
    it("lists available lip-sync models", async () => {
      const result = await listLipSyncModels({}, client);

      console.log("Lip-Sync Models available:");
      console.log("  SONIC:", result.sonic.available);
      console.log("  Hallo2:", result.hallo2.available);
      console.log("  SadTalker:", result.sadtalker.available);

      // At least one lip-sync system should be available
      const anyAvailable = result.sonic.available || result.hallo2.available || result.sadtalker.available;
      expect(anyAvailable).toBe(true);
    });

    it("generates lip-sync video from portrait and audio", async () => {
      const portraitPath = path.join(E2E_OUTPUT_DIR, "odin_realistic.png");
      const audioPath = path.join(E2E_OUTPUT_DIR, "speech_latin.wav");
      const outputPath = path.join(E2E_OUTPUT_DIR, "odin_speaking.mp4");

      // Check prerequisites exist
      try {
        await fs.access(portraitPath);
        await fs.access(audioPath);
      } catch {
        console.log("Skipping: Prerequisites not generated (run portrait and TTS tests first)");
        return;
      }

      const result = await lipSyncGenerate(
        {
          portrait_image: portraitPath,
          audio: audioPath,
          output_path: outputPath,
          model: "sonic", // or "hallo2" if available
          min_resolution: 512,
        },
        client
      );

      expect(result.video).toBe(outputPath);

      const stats = await fs.stat(outputPath);
      expect(stats.size).toBeGreaterThan(100000); // At least 100KB

      console.log("Lip-sync video generated:", result.video);
      console.log("File size:", Math.round(stats.size / 1024), "KB");
    }, 10 * 60 * 1000); // 10 minute timeout for video generation
  });

  describe("Step 4: Full Pipeline (talk)", () => {
    it("generates talking head video from text and description", async () => {
      const outputPath = path.join(E2E_OUTPUT_DIR, "odin_havamal.mp4");

      const result = await talk(
        {
          text: HAVAMAL_138,
          portrait_image: path.join(E2E_OUTPUT_DIR, "odin_realistic.png"),
          voice_reference: "icelandic_male.wav",
          output_path: outputPath,
        },
        client
      );

      expect(result.video).toBe(outputPath);
      expect(result.text).toBe(HAVAMAL_138);

      const stats = await fs.stat(outputPath);
      expect(stats.size).toBeGreaterThan(100000);

      console.log("Full pipeline complete!");
      console.log("Video:", result.video);
      console.log("Text:", result.text);
    }, 15 * 60 * 1000); // 15 minute timeout for full pipeline
  });
});

describeE2E("E2E: Error Handling", () => {
  beforeAll(async () => {
    client = new ComfyUIClient({
      url: process.env.COMFYUI_URL || "http://localhost:8188",
      outputDir: E2E_OUTPUT_DIR,
    });
  });

  it("handles missing model gracefully", async () => {
    await expect(
      createPortrait(
        {
          description: "Test",
          style: "realistic",
          expression: "neutral",
          backend: "sdxl",
          model: "nonexistent_model_12345.safetensors",
          guidance: 7.0,
          steps: 4,
          width: 512,
          height: 512,
          output_path: "/tmp/test.png",
        },
        client
      )
    ).rejects.toThrow();
  });

  it("handles invalid audio file for TTS", async () => {
    await expect(
      ttsGenerate(
        {
          text: "Test",
          voice_reference: "nonexistent_audio.wav",
          output_path: "/tmp/test.wav",
          speed: 1.0,
          seed: -1,
          model: "F5TTS_v1_Base",
          vocoder: "vocos",
        },
        client
      )
    ).rejects.toThrow();
  });
});
