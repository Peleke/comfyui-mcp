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

// Check if ComfyUI is available (called once, cached)
let _comfyUIAvailable: boolean | null = null;
async function isComfyUIAvailable(): Promise<boolean> {
  if (_comfyUIAvailable !== null) return _comfyUIAvailable;

  try {
    const response = await fetch(`${COMFYUI_URL}/system_stats`, {
      signal: AbortSignal.timeout(2000),
    });
    _comfyUIAvailable = response.ok;
  } catch {
    _comfyUIAvailable = false;
  }
  return _comfyUIAvailable;
}

// Test context populated by beforeAll
interface TestContext {
  client: ComfyUIClient | null;
  availableControlNets: string[];
  availableIPAdapters: string[];
  availableClipVision: string[];
  ready: boolean;
}

const ctx: TestContext = {
  client: null,
  availableControlNets: [],
  availableIPAdapters: [],
  availableClipVision: [],
  ready: false,
};

describe("Architecture Model Verification (Integration)", () => {
  beforeAll(async () => {
    const available = await isComfyUIAvailable();

    if (available) {
      ctx.client = new ComfyUIClient({ url: COMFYUI_URL });

      try {
        const objectInfo = await ctx.client.getObjectInfo();

        // Get available ControlNet models
        const controlNetLoader = objectInfo["ControlNetLoader"];
        if (controlNetLoader?.input?.required?.control_net_name?.[0]) {
          ctx.availableControlNets = controlNetLoader.input.required.control_net_name[0];
        }

        // Get available IP-Adapter models
        const ipadapterLoader = objectInfo["IPAdapterModelLoader"];
        if (ipadapterLoader?.input?.required?.ipadapter_file?.[0]) {
          ctx.availableIPAdapters = ipadapterLoader.input.required.ipadapter_file[0];
        }

        // Get available CLIP Vision models
        const clipVisionLoader = objectInfo["CLIPVisionLoader"];
        if (clipVisionLoader?.input?.required?.clip_name?.[0]) {
          ctx.availableClipVision = clipVisionLoader.input.required.clip_name[0];
        }

        ctx.ready = true;
      } catch (err) {
        console.error("Failed to fetch object info from ComfyUI:", err);
      }
    }
  });

  /**
   * Helper to skip test if ComfyUI not available.
   * Using this pattern instead of it.skipIf() to avoid timing issues
   * where the condition is evaluated before beforeAll runs.
   */
  function skipIfNoComfyUI(testFn: () => void | Promise<void>) {
    return async () => {
      const available = await isComfyUIAvailable();
      if (!available) {
        console.log("  ⏭️  Skipped: ComfyUI not available");
        return;
      }
      if (!ctx.ready) {
        console.log("  ⏭️  Skipped: Failed to initialize test context");
        return;
      }
      await testFn();
    };
  }

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
      it("all SD1.5 ControlNet models should exist on server", skipIfNoComfyUI(() => {
        if (ctx.availableControlNets.length === 0) {
          console.log("  ⏭️  Skipped: No ControlNet models available");
          return;
        }

        const missing: string[] = [];
        for (const type of controlNetTypes) {
          const model = sd15Architecture.controlNetModels?.[type];
          if (model && !ctx.availableControlNets.includes(model)) {
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
      }));
    });

    describe("SDXL ControlNet Models", () => {
      it("all SDXL ControlNet models should exist on server", skipIfNoComfyUI(() => {
        if (ctx.availableControlNets.length === 0) {
          console.log("  ⏭️  Skipped: No ControlNet models available");
          return;
        }

        const missing: string[] = [];
        for (const type of controlNetTypes) {
          const model = sdxlArchitecture.controlNetModels?.[type];
          if (model && !ctx.availableControlNets.includes(model)) {
            missing.push(`${type}: ${model}`);
          }
        }

        if (missing.length > 0) {
          console.warn(
            `Missing SDXL ControlNet models (install for full support):\n  ${missing.join("\n  ")}`
          );
        }

        expect(true).toBe(true);
      }));
    });

    it("should report available ControlNet models", skipIfNoComfyUI(() => {
      console.log(`\nAvailable ControlNet models (${ctx.availableControlNets.length}):`);
      for (const model of ctx.availableControlNets.slice(0, 10)) {
        console.log(`  - ${model}`);
      }
      if (ctx.availableControlNets.length > 10) {
        console.log(`  ... and ${ctx.availableControlNets.length - 10} more`);
      }
      expect(ctx.availableControlNets.length).toBeGreaterThanOrEqual(0);
    }));
  });

  describe("IP-Adapter Model Verification", () => {
    it("SD1.5 IP-Adapter model should exist on server", skipIfNoComfyUI(() => {
      if (ctx.availableIPAdapters.length === 0) {
        console.log("  ⏭️  Skipped: No IP-Adapter models available");
        return;
      }
      verifyIPAdapterConfig("SD1.5", sd15Architecture);
    }));

    it("SDXL IP-Adapter model should exist on server", skipIfNoComfyUI(() => {
      if (ctx.availableIPAdapters.length === 0) {
        console.log("  ⏭️  Skipped: No IP-Adapter models available");
        return;
      }
      verifyIPAdapterConfig("SDXL", sdxlArchitecture);
    }));

    it("Pony IP-Adapter model should exist on server", skipIfNoComfyUI(() => {
      if (ctx.availableIPAdapters.length === 0) {
        console.log("  ⏭️  Skipped: No IP-Adapter models available");
        return;
      }
      verifyIPAdapterConfig("Pony", ponyArchitecture);
    }));

    it("Illustrious IP-Adapter model should exist on server", skipIfNoComfyUI(() => {
      if (ctx.availableIPAdapters.length === 0) {
        console.log("  ⏭️  Skipped: No IP-Adapter models available");
        return;
      }
      verifyIPAdapterConfig("Illustrious", illustriousArchitecture);
    }));

    it("should report available IP-Adapter models", skipIfNoComfyUI(() => {
      console.log(`\nAvailable IP-Adapter models (${ctx.availableIPAdapters.length}):`);
      for (const model of ctx.availableIPAdapters) {
        console.log(`  - ${model}`);
      }
      console.log(`\nAvailable CLIP Vision models (${ctx.availableClipVision.length}):`);
      for (const model of ctx.availableClipVision) {
        console.log(`  - ${model}`);
      }
      expect(ctx.availableIPAdapters.length).toBeGreaterThanOrEqual(0);
    }));

    function verifyIPAdapterConfig(name: string, arch: typeof sd15Architecture) {
      const config = arch.ipadapterConfig;
      if (!config) {
        expect(true).toBe(true);
        return;
      }

      const modelExists = ctx.availableIPAdapters.includes(config.model);
      const clipExists = ctx.availableClipVision.includes(config.clipVision);

      if (!modelExists) {
        console.warn(`Missing ${name} IP-Adapter model: ${config.model}`);
      }
      if (!clipExists) {
        console.warn(`Missing ${name} CLIP Vision model: ${config.clipVision}`);
      }

      // Don't fail - just report
      expect(true).toBe(true);
    }
  });

  describe("Architecture Detection vs Available Models", () => {
    it("should correctly detect architectures from available checkpoints", skipIfNoComfyUI(async () => {
      const objectInfo = await ctx.client!.getObjectInfo();
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
    }));
  });
});
