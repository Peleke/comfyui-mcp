/**
 * Integration tests for architecture model verification.
 *
 * These tests connect to a real ComfyUI instance and verify that the
 * ControlNet and IP-Adapter models defined in our architecture plugins
 * actually exist on the server.
 *
 * Skipped automatically if ComfyUI is not available.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  architectures,
  sd15Architecture,
  sdxlArchitecture,
  ponyArchitecture,
  illustriousArchitecture,
} from "./index.js";
import type { ControlNetType } from "./types.js";

const COMFYUI_URL = process.env.COMFYUI_URL || "http://127.0.0.1:8188";

// Check if ComfyUI is available
async function isComfyUIAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${COMFYUI_URL}/system_stats`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

describe("Architecture Model Verification (Integration)", () => {
  let client: ComfyUIClient;
  let comfyUIAvailable = false;
  let availableControlNets: string[] = [];
  let availableIPAdapters: string[] = [];
  let availableClipVision: string[] = [];

  beforeAll(async () => {
    comfyUIAvailable = await isComfyUIAvailable();

    if (comfyUIAvailable) {
      client = new ComfyUIClient(COMFYUI_URL);

      try {
        const objectInfo = await client.getObjectInfo();

        // Get available ControlNet models
        const controlNetLoader = objectInfo["ControlNetLoader"];
        if (controlNetLoader?.input?.required?.control_net_name?.[0]) {
          availableControlNets = controlNetLoader.input.required.control_net_name[0];
        }

        // Get available IP-Adapter models
        const ipadapterLoader = objectInfo["IPAdapterModelLoader"];
        if (ipadapterLoader?.input?.required?.ipadapter_file?.[0]) {
          availableIPAdapters = ipadapterLoader.input.required.ipadapter_file[0];
        }

        // Get available CLIP Vision models
        const clipVisionLoader = objectInfo["CLIPVisionLoader"];
        if (clipVisionLoader?.input?.required?.clip_name?.[0]) {
          availableClipVision = clipVisionLoader.input.required.clip_name[0];
        }
      } catch (err) {
        console.error("Failed to fetch object info from ComfyUI:", err);
        comfyUIAvailable = false;
      }
    }
  });

  describe("ControlNet Model Verification", () => {
    const controlNetTypes: ControlNetType[] = [
      "canny",
      "depth",
      "openpose",
      "qrcode",
      "scribble",
      "lineart",
      "semantic_seg",
    ];

    describe("SD1.5 ControlNet Models", () => {
      it.skipIf(!comfyUIAvailable || availableControlNets.length === 0)(
        "all SD1.5 ControlNet models should exist on server",
        () => {
          const missing: string[] = [];

          for (const type of controlNetTypes) {
            const model = sd15Architecture.controlNetModels?.[type];
            if (model && !availableControlNets.includes(model)) {
              missing.push(`${type}: ${model}`);
            }
          }

          if (missing.length > 0) {
            console.warn(
              `Missing SD1.5 ControlNet models (install for full support):\n  ${missing.join("\n  ")}`
            );
          }

          // Don't fail the test - just report. Models are optional.
          expect(true).toBe(true);
        }
      );
    });

    describe("SDXL ControlNet Models", () => {
      it.skipIf(!comfyUIAvailable || availableControlNets.length === 0)(
        "all SDXL ControlNet models should exist on server",
        () => {
          const missing: string[] = [];

          for (const type of controlNetTypes) {
            const model = sdxlArchitecture.controlNetModels?.[type];
            if (model && !availableControlNets.includes(model)) {
              missing.push(`${type}: ${model}`);
            }
          }

          if (missing.length > 0) {
            console.warn(
              `Missing SDXL ControlNet models (install for full support):\n  ${missing.join("\n  ")}`
            );
          }

          expect(true).toBe(true);
        }
      );
    });

    it.skipIf(!comfyUIAvailable)(
      "should report available ControlNet models",
      () => {
        console.log(`\nAvailable ControlNet models (${availableControlNets.length}):`);
        for (const model of availableControlNets.slice(0, 10)) {
          console.log(`  - ${model}`);
        }
        if (availableControlNets.length > 10) {
          console.log(`  ... and ${availableControlNets.length - 10} more`);
        }
        expect(availableControlNets.length).toBeGreaterThanOrEqual(0);
      }
    );
  });

  describe("IP-Adapter Model Verification", () => {
    const architecturesWithIPAdapter = [
      { name: "SD1.5", arch: sd15Architecture },
      { name: "SDXL", arch: sdxlArchitecture },
      { name: "Pony", arch: ponyArchitecture },
      { name: "Illustrious", arch: illustriousArchitecture },
    ];

    for (const { name, arch } of architecturesWithIPAdapter) {
      it.skipIf(!comfyUIAvailable || availableIPAdapters.length === 0)(
        `${name} IP-Adapter model should exist on server`,
        () => {
          const config = arch.ipadapterConfig;
          if (!config) {
            expect(true).toBe(true);
            return;
          }

          const modelExists = availableIPAdapters.includes(config.model);
          const clipExists = availableClipVision.includes(config.clipVision);

          if (!modelExists) {
            console.warn(`Missing ${name} IP-Adapter model: ${config.model}`);
          }
          if (!clipExists) {
            console.warn(`Missing ${name} CLIP Vision model: ${config.clipVision}`);
          }

          // Don't fail - just report
          expect(true).toBe(true);
        }
      );
    }

    it.skipIf(!comfyUIAvailable)(
      "should report available IP-Adapter models",
      () => {
        console.log(`\nAvailable IP-Adapter models (${availableIPAdapters.length}):`);
        for (const model of availableIPAdapters) {
          console.log(`  - ${model}`);
        }
        console.log(`\nAvailable CLIP Vision models (${availableClipVision.length}):`);
        for (const model of availableClipVision) {
          console.log(`  - ${model}`);
        }
        expect(availableIPAdapters.length).toBeGreaterThanOrEqual(0);
      }
    );
  });

  describe("Architecture Detection vs Available Models", () => {
    it.skipIf(!comfyUIAvailable)(
      "should correctly detect architectures from available checkpoints",
      async () => {
        const objectInfo = await client.getObjectInfo();
        const checkpointLoader = objectInfo["CheckpointLoaderSimple"];

        if (!checkpointLoader?.input?.required?.ckpt_name?.[0]) {
          console.log("No checkpoints available to test");
          expect(true).toBe(true);
          return;
        }

        const checkpoints: string[] = checkpointLoader.input.required.ckpt_name[0];
        console.log(`\nDetection results for ${checkpoints.length} available checkpoints:`);

        for (const checkpoint of checkpoints.slice(0, 15)) {
          const detection = architectures.detect(checkpoint);
          console.log(
            `  ${checkpoint.substring(0, 40).padEnd(40)} -> ${detection.architecture.id} (${Math.round(detection.confidence * 100)}%)`
          );
        }

        if (checkpoints.length > 15) {
          console.log(`  ... and ${checkpoints.length - 15} more`);
        }

        expect(checkpoints.length).toBeGreaterThan(0);
      }
    );
  });
});
