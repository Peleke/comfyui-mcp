#!/usr/bin/env node
/**
 * GPU E2E Pipeline Test
 *
 * Standalone script to test the full GPU pipeline:
 * 1. Health check (verify ComfyUI + GPU)
 * 2. Portrait generation
 * 3. TTS voice cloning
 * 4. Lip-sync video generation
 * 5. Cloud upload verification
 *
 * Usage:
 *   npx tsx src/e2e/gpu-pipeline.ts
 *
 * Environment:
 *   COMFYUI_URL - RunPod proxy URL (required)
 *   STORAGE_PROVIDER - supabase/gcp/local (optional)
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_BUCKET - for cloud upload
 */

import { ComfyUIClient } from "../comfyui-client.js";
import { checkConnection, pingComfyUI, HealthCheckResult } from "../tools/health.js";
import * as fs from "fs/promises";
import * as path from "path";

// Helper to convert MB to GB
const mbToGb = (mb: number) => (mb / 1024).toFixed(1);

// ANSI colors for output
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  output?: Record<string, unknown>;
}

const results: TestResult[] = [];

function log(message: string, color = RESET) {
  console.log(`${color}${message}${RESET}`);
}

function logStep(step: number, total: number, name: string) {
  log(`\n${BOLD}[${step}/${total}] ${name}${RESET}`, CYAN);
  log("─".repeat(50), CYAN);
}

async function runTest(
  name: string,
  fn: () => Promise<Record<string, unknown> | void>
): Promise<boolean> {
  const start = Date.now();
  try {
    const output = await fn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration, output: output || {} });
    log(`✓ ${name} (${duration}ms)`, GREEN);
    return true;
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, duration, error: errorMsg });
    log(`✗ ${name} (${duration}ms)`, RED);
    log(`  Error: ${errorMsg}`, RED);
    return false;
  }
}

async function main() {
  const comfyuiUrl = process.env.COMFYUI_URL;
  const outputDir = process.env.E2E_OUTPUT_DIR || "/tmp/comfyui-e2e";

  log(`\n${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  log(`${BOLD}║           GPU E2E Pipeline Test                          ║${RESET}`);
  log(`${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}\n`);

  if (!comfyuiUrl) {
    log("ERROR: COMFYUI_URL environment variable not set", RED);
    log("Set it to your RunPod proxy URL:", YELLOW);
    log("  export COMFYUI_URL=https://<pod-id>-8188.proxy.runpod.net", YELLOW);
    process.exit(1);
  }

  log(`ComfyUI URL: ${comfyuiUrl}`, CYAN);
  log(`Output Dir:  ${outputDir}`, CYAN);
  log(`Storage:     ${process.env.STORAGE_PROVIDER || "local"}`, CYAN);

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  const client = new ComfyUIClient({
    url: comfyuiUrl,
    outputDir: outputDir,
    timeout: 10 * 60 * 1000, // 10 min timeout
  });

  const totalSteps = 6;
  let currentStep = 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // Step 1: Health Check
  // ═══════════════════════════════════════════════════════════════════════════
  logStep(++currentStep, totalSteps, "Health Check");

  let gpuInfo: Record<string, unknown> = {};

  const healthPassed = await runTest("Ping ComfyUI", async () => {
    const result = await pingComfyUI(client);
    if (!result.reachable) {
      throw new Error(`ComfyUI not reachable: ${result.error}`);
    }
    return { latency: result.latency_ms };
  });

  if (!healthPassed) {
    log("\n⚠ ComfyUI not reachable. Aborting tests.", RED);
    printSummary();
    process.exit(1);
  }

  await runTest("Check GPU & System", async () => {
    const result = await checkConnection({}, client);
    gpuInfo = result.gpu || {};
    if (!result.gpu?.name) {
      log("  Warning: No GPU detected", YELLOW);
    } else {
      log(`  GPU: ${result.gpu.name}`, GREEN);
      log(`  VRAM: ${mbToGb(result.gpu.vram_free_mb)}GB free / ${mbToGb(result.gpu.vram_total_mb)}GB total`, GREEN);
    }
    return { ...result } as Record<string, unknown>;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Step 2: List Available Models
  // ═══════════════════════════════════════════════════════════════════════════
  logStep(++currentStep, totalSteps, "Check Available Models");

  let availableModels: string[] = [];

  await runTest("List checkpoint models", async () => {
    availableModels = await client.getModels();
    log(`  Found ${availableModels.length} models:`, CYAN);
    availableModels.slice(0, 5).forEach((m) => log(`    • ${m}`, CYAN));
    if (availableModels.length > 5) {
      log(`    ... and ${availableModels.length - 5} more`, CYAN);
    }
    return { count: availableModels.length, models: availableModels.slice(0, 10) };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Step 3: Portrait Generation
  // ═══════════════════════════════════════════════════════════════════════════
  logStep(++currentStep, totalSteps, "Portrait Generation");

  const portraitPath = path.join(outputDir, "e2e_portrait.png");
  let portraitGenerated = false;

  // Find a suitable model
  const sdxlModels = availableModels.filter(
    (m) =>
      m.includes("xl") ||
      m.includes("sdxl") ||
      m.includes("deliberate") ||
      m.includes("realistic") ||
      m.includes("flux")
  );

  if (sdxlModels.length === 0 && availableModels.length > 0) {
    sdxlModels.push(availableModels[0]); // Use first available
  }

  if (sdxlModels.length > 0) {
    const modelToUse = sdxlModels[0];
    log(`  Using model: ${modelToUse}`, CYAN);

    portraitGenerated = await runTest("Generate portrait", async () => {
      // Import dynamically to avoid circular deps
      const { createPortrait } = await import("../tools/avatar.js");

      const result = await createPortrait(
        {
          description: "Viking warrior, battle-worn, weathered face, long braided beard",
          style: "realistic",
          expression: "serious",
          gender: "male",
          backend: modelToUse.includes("flux") ? "flux_fp8" : "sdxl",
          model: modelToUse,
          guidance: 7.0,
          steps: 20,
          width: 768,
          height: 1024,
          seed: 42,
          output_path: portraitPath,
          upload_to_cloud: false,
        },
        client
      );

      const stats = await fs.stat(portraitPath);
      log(`  Output: ${portraitPath} (${Math.round(stats.size / 1024)}KB)`, GREEN);

      return { image: result.image, size: stats.size };
    });
  } else {
    log("  Skipping: No suitable models found", YELLOW);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Step 4: TTS Generation
  // ═══════════════════════════════════════════════════════════════════════════
  logStep(++currentStep, totalSteps, "TTS Voice Cloning");

  const audioPath = path.join(outputDir, "e2e_speech.wav");
  let ttsGenerated = false;

  await runTest("Check TTS availability", async () => {
    const { listTTSModels } = await import("../tools/tts.js");
    const models = await listTTSModels({}, client);

    if (models.f5tts.available) {
      log("  F5-TTS: Available", GREEN);
      return { f5tts: true, models: models.f5tts.models };
    } else if (models.xtts.available) {
      log("  XTTS: Available", GREEN);
      return { xtts: true, models: models.xtts.models };
    } else {
      log("  No TTS models available", YELLOW);
      return { available: false };
    }
  });

  // Skip TTS if no voice reference available
  const voiceRefPath = process.env.VOICE_REFERENCE || "/workspace/ComfyUI/input/voices/reference.wav";
  try {
    await fs.access(voiceRefPath);

    ttsGenerated = await runTest("Generate speech", async () => {
      const { ttsGenerate } = await import("../tools/tts.js");

      const result = await ttsGenerate(
        {
          text: "Veni, vidi, vici. I came, I saw, I conquered.",
          voice_reference: voiceRefPath,
          output_path: audioPath,
          speed: 1.0,
          seed: -1,
          model: "F5TTS_v1_Base",
          vocoder: "vocos",
        },
        client
      );

      const stats = await fs.stat(audioPath);
      log(`  Output: ${audioPath} (${Math.round(stats.size / 1024)}KB)`, GREEN);

      return { audio: result.audio, size: stats.size };
    });
  } catch {
    log(`  Skipping TTS: No voice reference at ${voiceRefPath}`, YELLOW);
    log("  Set VOICE_REFERENCE env var to a .wav file", YELLOW);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Step 5: Lip-Sync Video
  // ═══════════════════════════════════════════════════════════════════════════
  logStep(++currentStep, totalSteps, "Lip-Sync Video Generation");

  const videoPath = path.join(outputDir, "e2e_talking.mp4");

  if (portraitGenerated && ttsGenerated) {
    await runTest("Generate lip-sync video", async () => {
      const { lipSyncGenerate } = await import("../tools/lipsync.js");

      const result = await lipSyncGenerate(
        {
          portrait_image: portraitPath,
          audio: audioPath,
          output_path: videoPath,
          model: "sonic",
          min_resolution: 512,
        },
        client
      );

      const stats = await fs.stat(videoPath);
      log(`  Output: ${videoPath} (${Math.round(stats.size / 1024)}KB)`, GREEN);

      return { video: result.video, size: stats.size };
    });
  } else {
    log("  Skipping: Prerequisites not met (need portrait + audio)", YELLOW);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Step 6: Cloud Upload (if configured)
  // ═══════════════════════════════════════════════════════════════════════════
  logStep(++currentStep, totalSteps, "Cloud Upload Verification");

  const storageProvider = process.env.STORAGE_PROVIDER;

  if (storageProvider && storageProvider !== "local") {
    await runTest(`Upload to ${storageProvider}`, async () => {
      const { getStorageProvider } = await import("../storage/index.js");

      const provider = getStorageProvider();
      const testFile = portraitGenerated ? portraitPath : path.join(outputDir, "test.txt");

      // Create test file if portrait wasn't generated
      if (!portraitGenerated) {
        await fs.writeFile(testFile, "E2E test file");
      }

      const remotePath = `e2e-tests/e2e-test-${Date.now()}.png`;
      const result = await provider.upload(testFile, remotePath);

      log(`  Uploaded to: ${result.url}`, GREEN);
      return { url: result.url };
    });
  } else {
    log("  Skipping: STORAGE_PROVIDER not set or is 'local'", YELLOW);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════════
  printSummary();
}

function printSummary() {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;

  log(`\n${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  log(`${BOLD}║                      Test Summary                        ║${RESET}`);
  log(`${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}\n`);

  results.forEach((r) => {
    const status = r.passed ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const duration = `${r.duration}ms`;
    log(`${status} ${r.name} (${duration})`);
    if (r.error) {
      log(`   ${RED}└─ ${r.error}${RESET}`);
    }
  });

  log(`\n${BOLD}Results: ${passed}/${total} passed${RESET}`);

  if (failed > 0) {
    log(`${RED}${failed} test(s) failed${RESET}`);
    process.exit(1);
  } else {
    log(`${GREEN}All tests passed!${RESET}`);
    process.exit(0);
  }
}

main().catch((error) => {
  log(`\n${RED}Fatal error: ${error.message}${RESET}`, RED);
  console.error(error);
  process.exit(1);
});
