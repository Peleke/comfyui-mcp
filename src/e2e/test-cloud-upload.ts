#!/usr/bin/env node
/**
 * Test MCP Tool Cloud Upload
 *
 * Validates that the imagine() function (same as MCP imagine tool)
 * properly uploads to Supabase and returns a signed URL.
 *
 * Usage:
 *   npx tsx src/e2e/test-cloud-upload.ts
 *
 * Required env vars:
 *   COMFYUI_URL - RunPod proxy URL
 *   COMFYUI_MODEL - Model to use (e.g., novaFurryXL.safetensors)
 *   STORAGE_PROVIDER=supabase
 *   SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 *   SUPABASE_BUCKET
 */

import { ComfyUIClient } from "../comfyui-client.js";
import { imagine, imagineSchema } from "../tools/imagine.js";
import { isCloudStorageConfigured } from "../storage/index.js";
import { openInBrowser } from "../viewer.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

async function main() {
  console.log("\n🧪 Testing MCP Tool Cloud Upload\n");

  // Check environment
  const url = process.env.COMFYUI_URL;
  const model = process.env.COMFYUI_MODEL;

  if (!url) {
    console.log(`${RED}ERROR: COMFYUI_URL not set${RESET}`);
    console.log(`Set: export COMFYUI_URL=https://<pod-id>-8188.proxy.runpod.net`);
    process.exit(1);
  }

  if (!model) {
    console.log(`${RED}ERROR: COMFYUI_MODEL not set${RESET}`);
    process.exit(1);
  }

  console.log(`ComfyUI URL: ${CYAN}${url}${RESET}`);
  console.log(`Model: ${CYAN}${model}${RESET}`);
  console.log(`Cloud Storage: ${isCloudStorageConfigured() ? GREEN + "✓ configured" : RED + "✗ not configured"}${RESET}`);

  if (!isCloudStorageConfigured()) {
    console.log(`\n${RED}Cloud storage not configured. Set:${RESET}`);
    console.log(`  STORAGE_PROVIDER=supabase`);
    console.log(`  SUPABASE_URL=https://xxx.supabase.co`);
    console.log(`  SUPABASE_SECRET_KEY=sb_secret_xxx`);
    console.log(`  SUPABASE_BUCKET=generated-assets`);
    process.exit(1);
  }

  const client = new ComfyUIClient({ url, timeout: 120000 });

  // Test imagine() with cloud upload
  console.log("\n📸 Running imagine() with cloud upload...\n");

  const start = Date.now();
  const input = imagineSchema.parse({
    description: "An anthro fox DJ at a cyberpunk rave, neon lights, detailed fluffy fur, headphones, crowd in background, dramatic lighting",
    output_path: `/tmp/mcp-cloud-test-${Date.now()}.png`,
    model: model,
    style: "digital_art",
    quality: "standard",
    upload_to_cloud: true,  // This is the key parameter
  });
  const result = await imagine(client, input, model);

  const duration = ((Date.now() - start) / 1000).toFixed(1);

  console.log("\n📊 Results:\n");
  console.log(`Success: ${result.success ? GREEN + "✓ yes" : RED + "✗ no"}${RESET}`);
  console.log(`Duration: ${duration}s`);
  console.log(`Local path: ${result.imagePath}`);
  console.log(`Seed: ${result.seed}`);
  console.log(`Model family: ${result.modelFamily}`);
  console.log(`Pipeline: ${result.pipelineSteps.join(" → ")}`);

  // The key test: does remote_url exist?
  if (result.remote_url) {
    console.log(`\n${GREEN}✓ Cloud upload succeeded!${RESET}`);
    console.log(`Signed URL: ${CYAN}${result.remote_url}${RESET}`);

    // Try to open in browser
    console.log("\nOpening in browser...");
    const opened = await openInBrowser(result.remote_url);
    if (opened) {
      console.log(`${GREEN}✓ Opened in browser${RESET}`);
    } else {
      console.log(`Manual URL: ${result.remote_url}`);
    }
  } else {
    console.log(`\n${RED}✗ Cloud upload failed - no remote_url returned${RESET}`);
    console.log(`Check the logs above for upload errors`);
    process.exit(1);
  }

  console.log(`\n${GREEN}✓ MCP tool cloud upload test passed!${RESET}\n`);
}

main().catch((e) => {
  console.error(`${RED}Fatal: ${e.message}${RESET}`);
  console.error(e.stack);
  process.exit(1);
});
