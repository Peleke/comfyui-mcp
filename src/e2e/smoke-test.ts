#!/usr/bin/env node
/**
 * Quick Smoke Test
 *
 * Fast verification that ComfyUI is working:
 * 1. Ping ComfyUI
 * 2. Check GPU
 * 3. List models
 * 4. Generate a tiny test image (4 steps)
 *
 * Usage:
 *   npx tsx src/e2e/smoke-test.ts
 *
 * Takes ~30 seconds on a good GPU.
 */

import { ComfyUIClient } from "../comfyui-client.js";
import { checkConnection, pingComfyUI } from "../tools/health.js";

const mbToGb = (mb: number) => (mb / 1024).toFixed(1);

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

async function main() {
  const url = process.env.COMFYUI_URL;

  console.log("\n🔥 ComfyUI Smoke Test\n");

  if (!url) {
    console.log(`${RED}ERROR: COMFYUI_URL not set${RESET}`);
    console.log(`Set: export COMFYUI_URL=https://<pod-id>-8188.proxy.runpod.net`);
    process.exit(1);
  }

  console.log(`URL: ${CYAN}${url}${RESET}\n`);

  const client = new ComfyUIClient({ url, timeout: 60000 });

  // Test 1: Ping
  process.stdout.write("1. Ping ComfyUI... ");
  try {
    const ping = await pingComfyUI(client);
    if (ping.reachable) {
      console.log(`${GREEN}✓${RESET} (${ping.latency_ms}ms)`);
    } else {
      throw new Error(ping.error || "Not reachable");
    }
  } catch (e) {
    console.log(`${RED}✗${RESET}`);
    console.log(`   ${RED}${e instanceof Error ? e.message : e}${RESET}`);
    process.exit(1);
  }

  // Test 2: GPU Check
  process.stdout.write("2. Check GPU... ");
  try {
    const health = await checkConnection({}, client);
    if (health.gpu?.name) {
      console.log(`${GREEN}✓${RESET} ${health.gpu.name}`);
      console.log(`   VRAM: ${mbToGb(health.gpu.vram_free_mb)}GB free / ${mbToGb(health.gpu.vram_total_mb)}GB`);
    } else {
      console.log(`${YELLOW}⚠${RESET} No GPU detected (CPU mode)`);
    }
  } catch (e) {
    console.log(`${YELLOW}⚠${RESET} Could not get GPU info`);
  }

  // Test 3: List Models
  process.stdout.write("3. List models... ");
  try {
    const models = await client.getModels();
    console.log(`${GREEN}✓${RESET} Found ${models.length} models`);
    if (models.length > 0) {
      console.log(`   First: ${models[0]}`);
    }
  } catch (e) {
    console.log(`${RED}✗${RESET}`);
    console.log(`   ${RED}${e instanceof Error ? e.message : e}${RESET}`);
    process.exit(1);
  }

  // Test 4: Quick generation (if models available)
  process.stdout.write("4. Quick generation (4 steps)... ");
  try {
    const models = await client.getModels();
    if (models.length === 0) {
      console.log(`${YELLOW}⚠${RESET} Skipped (no models)`);
    } else {
      const { generateImage } = await import("../tools/generate.js");
      const start = Date.now();

      await generateImage(
        client,
        {
          prompt: "test image, simple",
          negative_prompt: "bad quality",
          model: models[0],
          steps: 4,
          cfg_scale: 1.0,
          sampler: "euler",
          scheduler: "normal",
          width: 512,
          height: 512,
          output_path: "/tmp/smoke-test.png",
        },
        models[0]
      );

      const duration = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`${GREEN}✓${RESET} Generated in ${duration}s`);
    }
  } catch (e) {
    console.log(`${RED}✗${RESET}`);
    console.log(`   ${RED}${e instanceof Error ? e.message : e}${RESET}`);
    process.exit(1);
  }

  console.log(`\n${GREEN}✓ All smoke tests passed!${RESET}\n`);
}

main().catch((e) => {
  console.error(`${RED}Fatal: ${e.message}${RESET}`);
  process.exit(1);
});
