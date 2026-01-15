import { z } from "zod";
import type { ComfyUIClient } from "../comfyui-client.js";
import {
  buildIPAdapterWorkflow,
  type LoraConfig,
  type IPAdapterWeightType,
} from "../workflows/builder.js";
import { mkdir } from "fs/promises";
import { dirname, basename } from "path";
import {
  getStorageProvider,
  isCloudStorageConfigured,
  generateRemotePath,
} from "../storage/index.js";

// Default IP-Adapter models for different architectures
const DEFAULT_IPADAPTER_MODELS = {
  sdxl: "ip-adapter_sdxl_vit-h.safetensors",
  sdxl_plus: "ip-adapter-plus_sdxl_vit-h.safetensors",
  sdxl_plus_face: "ip-adapter-plus-face_sdxl_vit-h.safetensors",
  sd15: "ip-adapter_sd15.safetensors",
  sd15_plus: "ip-adapter-plus_sd15.safetensors",
  sd15_plus_face: "ip-adapter-plus-face_sd15.safetensors",
};

// Default CLIP Vision models
const DEFAULT_CLIP_VISION_MODELS = {
  vit_h: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
  vit_g: "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors",
};

// Shared LoRA schema
const loraSchema = z.object({
  name: z.string().describe("LoRA filename"),
  strength_model: z.number().optional().default(1.0).describe("LoRA strength for model"),
  strength_clip: z.number().optional().default(1.0).describe("LoRA strength for CLIP"),
});

export const generateWithIPAdapterSchema = z.object({
  prompt: z.string().describe("The positive prompt for image generation"),
  negative_prompt: z.string().optional().describe("The negative prompt (things to avoid)"),
  reference_image: z.string().describe("Filename of reference image in ComfyUI input folder for identity preservation"),
  reference_images: z.array(z.string()).optional().describe("Additional reference images for multi-reference generation"),
  weight: z.number().min(0).max(2).optional().default(0.8).describe("IP-Adapter weight/strength (0.0-2.0, default 0.8)"),
  weight_type: z.enum([
    "linear",
    "ease in",
    "ease out",
    "ease in-out",
    "reverse in-out",
    "weak input",
    "weak output",
    "weak middle",
    "strong middle",
  ]).optional().default("linear").describe("Weight application curve"),
  start_at: z.number().min(0).max(1).optional().default(0).describe("When to start applying IP-Adapter (0.0-1.0)"),
  end_at: z.number().min(0).max(1).optional().default(1).describe("When to stop applying IP-Adapter (0.0-1.0)"),
  combine_embeds: z.enum(["concat", "add", "subtract", "average", "norm average"]).optional()
    .describe("How to combine multiple reference image embeddings"),
  ipadapter_model: z.string().optional().describe("IP-Adapter model file (auto-detected if not specified)"),
  clip_vision_model: z.string().optional().describe("CLIP Vision model for encoding reference images"),
  model: z.string().optional().describe("Checkpoint model name"),
  width: z.number().default(512).describe("Image width in pixels"),
  height: z.number().default(768).describe("Image height in pixels"),
  steps: z.number().default(28).describe("Number of sampling steps"),
  cfg_scale: z.number().default(7).describe("CFG scale"),
  sampler: z.string().default("euler_ancestral").describe("Sampler to use"),
  scheduler: z.string().default("normal").describe("Scheduler to use"),
  seed: z.number().optional().describe("Random seed (random if not specified)"),
  loras: z.array(loraSchema).optional().describe("Array of LoRAs to apply"),
  output_path: z.string().describe("Full path where the generated image should be saved"),
  upload_to_cloud: z.boolean().optional().default(true).describe("Upload result to cloud storage"),
});

export type GenerateWithIPAdapterInput = z.infer<typeof generateWithIPAdapterSchema>;

/**
 * Helper to extract image from workflow outputs
 */
async function extractAndSaveImage(
  client: ComfyUIClient,
  history: any,
  saveNodeId: string,
  outputPath: string
): Promise<void> {
  const saveImageOutput = history.outputs[saveNodeId];
  if (!saveImageOutput?.images?.[0]) {
    throw new Error("No image in output");
  }

  const imageInfo = saveImageOutput.images[0];
  const imageBuffer = await client.getImage(
    imageInfo.filename,
    imageInfo.subfolder,
    imageInfo.type
  );

  await mkdir(dirname(outputPath), { recursive: true });
  const fs = await import("fs/promises");
  await fs.writeFile(outputPath, imageBuffer);
}

/**
 * Generate an image with IP-Adapter for identity preservation.
 * Uses reference images to guide generation while maintaining identity/style.
 */
export async function generateWithIPAdapter(
  client: ComfyUIClient,
  input: GenerateWithIPAdapterInput,
  defaultModel: string
): Promise<{
  success: boolean;
  path: string;
  remote_url?: string;
  seed: number;
  message: string;
}> {
  const model = input.model || defaultModel;

  if (!model) {
    throw new Error("No model specified and COMFYUI_MODEL not set");
  }

  const seed = input.seed ?? Math.floor(Math.random() * 2147483647);

  // Transform LoRA input to internal format
  const loras: LoraConfig[] | undefined = input.loras?.map((l) => ({
    name: l.name,
    strength_model: l.strength_model,
    strength_clip: l.strength_clip,
  }));

  // Build workflow with IP-Adapter
  const workflow = buildIPAdapterWorkflow({
    prompt: input.prompt,
    negativePrompt: input.negative_prompt,
    width: input.width,
    height: input.height,
    steps: input.steps,
    cfgScale: input.cfg_scale,
    sampler: input.sampler,
    scheduler: input.scheduler,
    model: model,
    seed: seed,
    loras: loras,
    referenceImage: input.reference_image,
    referenceImages: input.reference_images,
    weight: input.weight,
    weightType: input.weight_type as IPAdapterWeightType,
    startAt: input.start_at,
    endAt: input.end_at,
    combineEmbeds: input.combine_embeds,
    ipAdapterModel: input.ipadapter_model,
    clipVisionModel: input.clip_vision_model,
    filenamePrefix: "ComfyUI_MCP_ipadapter",
  });

  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  await extractAndSaveImage(client, history, "9", input.output_path);

  // Upload to cloud storage if configured and requested
  let remote_url: string | undefined;
  const upload_to_cloud = input.upload_to_cloud ?? true;
  if (upload_to_cloud && isCloudStorageConfigured()) {
    try {
      const storage = getStorageProvider();
      const remotePath = generateRemotePath("images", basename(input.output_path));
      const uploadResult = await storage.upload(input.output_path, remotePath);
      remote_url = uploadResult.signedUrl || uploadResult.url || undefined;
    } catch (uploadErr) {
      console.error("Cloud upload failed:", uploadErr);
    }
  }

  return {
    success: true,
    path: input.output_path,
    remote_url,
    seed: seed,
    message: remote_url
      ? `Image generated with IP-Adapter and uploaded to cloud: ${remote_url}`
      : `Image generated with IP-Adapter and saved to ${input.output_path}`,
  };
}
