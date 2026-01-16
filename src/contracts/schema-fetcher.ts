#!/usr/bin/env npx tsx
/**
 * Schema Fetcher Utility
 *
 * Fetches ComfyUI's /object_info endpoint and saves it as a JSON snapshot.
 * This snapshot is used for contract testing without requiring a live ComfyUI instance.
 *
 * Usage:
 *   npx tsx src/contracts/schema-fetcher.ts > src/contracts/comfyui-schema.json
 *   npx tsx src/contracts/schema-fetcher.ts --url http://192.168.1.100:8188
 *   npx tsx src/contracts/schema-fetcher.ts --output src/contracts/comfyui-schema.json
 *
 * Environment:
 *   COMFYUI_URL - ComfyUI server URL (default: http://localhost:8188)
 */

import type { ComfyUIObjectInfo } from "./types.js";

interface FetchOptions {
  url: string;
  output?: string;
  filter?: string[];
  minify?: boolean;
}

/**
 * Fetch object_info from ComfyUI.
 */
async function fetchObjectInfo(url: string): Promise<ComfyUIObjectInfo> {
  const response = await fetch(`${url}/object_info`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch object_info: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Filter schema to only include specified node types.
 */
function filterSchema(schema: ComfyUIObjectInfo, nodeTypes: string[]): ComfyUIObjectInfo {
  const filtered: ComfyUIObjectInfo = {};

  for (const nodeType of nodeTypes) {
    if (schema[nodeType]) {
      filtered[nodeType] = schema[nodeType];
    }
  }

  return filtered;
}

/**
 * Get commonly used node types for a minimal schema.
 */
function getCommonNodeTypes(): string[] {
  return [
    // Core nodes
    "CheckpointLoaderSimple",
    "CLIPTextEncode",
    "KSampler",
    "KSamplerAdvanced",
    "VAEDecode",
    "VAEEncode",
    "EmptyLatentImage",
    "SaveImage",
    "LoadImage",

    // LoRA
    "LoraLoader",
    "LoraLoaderModelOnly",

    // Upscale
    "UpscaleModelLoader",
    "ImageUpscaleWithModel",
    "ImageScale",
    "ImageScaleBy",

    // ControlNet
    "ControlNetLoader",
    "ControlNetApply",
    "ControlNetApplyAdvanced",

    // Preprocessors
    "CannyEdgePreprocessor",
    "DepthAnythingPreprocessor",
    "DWPreprocessor",
    "LineArtPreprocessor",
    "ScribblePreprocessor",
    "SemSegPreprocessor",

    // Inpainting
    "VAEEncodeForInpaint",
    "ImagePadForOutpaint",
    "GrowMask",
    "InvertMask",
    "MaskToImage",
    "ImageToMask",

    // IP-Adapter
    "IPAdapterModelLoader",
    "IPAdapterApply",
    "IPAdapterAdvanced",
    "CLIPVisionLoader",
    "CLIPVisionEncode",
    "IPAdapterUnifiedLoader",

    // Video/Audio
    "SaveAnimatedWEBP",
    "VHS_VideoCombine",

    // TTS (F5-TTS)
    "F5TTSAudio",
    "F5TTSAudioInputs",
    "DownloadAndLoadF5TTSModel",

    // LipSync (SONIC)
    "SONICRun",
    "SONICLoader",
    "DownloadAndLoadSonicModel",

    // Utilities
    "PreviewImage",
    "ImageBatch",
    "ImageComposite",
    "LatentComposite",
  ];
}

/**
 * Parse command line arguments.
 */
function parseArgs(args: string[]): FetchOptions {
  const options: FetchOptions = {
    url: process.env.COMFYUI_URL || "http://localhost:8188",
    minify: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--url" && args[i + 1]) {
      options.url = args[++i];
    } else if (arg === "--output" && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === "--filter" && args[i + 1]) {
      options.filter = args[++i].split(",");
    } else if (arg === "--common") {
      options.filter = getCommonNodeTypes();
    } else if (arg === "--minify") {
      options.minify = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Schema Fetcher - Fetch ComfyUI's /object_info as JSON

Usage:
  npx tsx src/contracts/schema-fetcher.ts [options]

Options:
  --url <url>      ComfyUI server URL (default: $COMFYUI_URL or http://localhost:8188)
  --output <path>  Write to file instead of stdout
  --filter <list>  Comma-separated list of node types to include
  --common         Only include commonly used nodes (smaller file)
  --minify         Output minified JSON
  --help, -h       Show this help message

Examples:
  npx tsx src/contracts/schema-fetcher.ts > comfyui-schema.json
  npx tsx src/contracts/schema-fetcher.ts --common --output src/contracts/comfyui-schema.json
  npx tsx src/contracts/schema-fetcher.ts --url http://192.168.1.100:8188
`);
      process.exit(0);
    }
  }

  return options;
}

/**
 * Add metadata to the schema.
 */
function addMetadata(schema: ComfyUIObjectInfo, url: string): Record<string, unknown> {
  return {
    _meta: {
      fetchedAt: new Date().toISOString(),
      sourceUrl: url,
      nodeCount: Object.keys(schema).length,
      generator: "comfyui-mcp/schema-fetcher",
    },
    ...schema,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    console.error(`Fetching object_info from ${options.url}...`);

    let schema = await fetchObjectInfo(options.url);
    console.error(`Fetched ${Object.keys(schema).length} node types`);

    if (options.filter) {
      schema = filterSchema(schema, options.filter);
      console.error(`Filtered to ${Object.keys(schema).length} node types`);
    }

    const output = addMetadata(schema, options.url);
    const json = JSON.stringify(output, null, options.minify ? 0 : 2);

    if (options.output) {
      const fs = await import("fs/promises");
      await fs.writeFile(options.output, json, "utf-8");
      console.error(`Written to ${options.output}`);
    } else {
      console.log(json);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();
