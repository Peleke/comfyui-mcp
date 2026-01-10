/**
 * Quick test script for lip-sync generation
 * Run with: npx tsx test-lipsync.ts
 */

import { ComfyUIClient } from "./src/comfyui-client.js";
import { lipSyncGenerate } from "./src/tools/lipsync.js";

async function main() {
  console.log("Creating ComfyUI client...");
  const client = new ComfyUIClient({
    url: "http://localhost:8188",
    outputDir: "/tmp/comfyui-test",
    timeout: 10 * 60 * 1000, // 10 minutes
  });

  console.log("Starting lip-sync generation...");
  console.log("  Portrait: avatars/odin_cyberrealistic.png");
  console.log("  Audio: voices/reference_male.wav");

  try {
    const result = await lipSyncGenerate(
      {
        portrait_image: "avatars/odin_cyberrealistic.png",
        audio: "voices/reference_male.wav",
        output_path: "/tmp/comfyui-test/odin_speaking.mp4",
        // Uses defaults: model=sonic, svd_checkpoint=video/svd_xt_1_1.safetensors
        inference_steps: 25,
        fps: 25.0,
        min_resolution: 512,
        seed: 42,
      },
      client
    );

    console.log("\nSuccess!");
    console.log("Video saved to:", result.video);
    if (result.duration) {
      console.log("Duration:", result.duration, "seconds");
    }
  } catch (error) {
    console.error("\nError:", error);
    process.exit(1);
  }
}

main();
