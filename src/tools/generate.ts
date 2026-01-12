import { z } from "zod";
import { ComfyUIClient } from "../comfyui-client.js";
import { buildTxt2ImgWorkflow, buildImg2ImgWorkflow, LoraConfig } from "../workflows/builder.js";
import { mkdir } from "fs/promises";
import { dirname, basename } from "path";
import {
  getStorageProvider,
  isCloudStorageConfigured,
  generateRemotePath,
} from "../storage/index.js";

// Shared LoRA schema
const loraSchema = z.object({
  name: z.string().describe("LoRA filename (e.g., 'my_lora.safetensors')"),
  strength_model: z.number().optional().default(1.0).describe("LoRA strength for model (0.0-2.0)"),
  strength_clip: z.number().optional().default(1.0).describe("LoRA strength for CLIP (0.0-2.0)"),
});

export const generateImageSchema = z.object({
  prompt: z.string().describe("The positive prompt for image generation"),
  negative_prompt: z.string().optional().describe("The negative prompt (things to avoid)"),
  width: z.number().default(512).describe("Image width in pixels"),
  height: z.number().default(768).describe("Image height in pixels"),
  steps: z.number().default(28).describe("Number of sampling steps"),
  cfg_scale: z.number().default(7).describe("CFG scale (classifier-free guidance)"),
  sampler: z.string().default("euler_ancestral").describe("Sampler to use"),
  scheduler: z.string().default("normal").describe("Scheduler to use"),
  model: z.string().optional().describe("Checkpoint model name (uses default if not specified)"),
  seed: z.number().optional().describe("Random seed (random if not specified)"),
  loras: z.array(loraSchema).optional().describe("Array of LoRAs to apply"),
  output_path: z.string().describe("Full path where the generated image should be saved"),
  upload_to_cloud: z.boolean().optional().default(true).describe("Upload result to cloud storage"),
});

export const img2imgSchema = z.object({
  prompt: z.string().describe("The positive prompt for image generation"),
  negative_prompt: z.string().optional().describe("The negative prompt (things to avoid)"),
  input_image: z.string().describe("Filename of image in ComfyUI input folder, or base64 data"),
  denoise: z.number().default(0.75).describe("Denoise strength (0.0 = no change, 1.0 = full regeneration)"),
  steps: z.number().default(28).describe("Number of sampling steps"),
  cfg_scale: z.number().default(7).describe("CFG scale (classifier-free guidance)"),
  sampler: z.string().default("euler_ancestral").describe("Sampler to use"),
  scheduler: z.string().default("normal").describe("Scheduler to use"),
  model: z.string().optional().describe("Checkpoint model name (uses default if not specified)"),
  seed: z.number().optional().describe("Random seed (random if not specified)"),
  loras: z.array(loraSchema).optional().describe("Array of LoRAs to apply"),
  output_path: z.string().describe("Full path where the generated image should be saved"),
});

export type GenerateImageInput = z.infer<typeof generateImageSchema>;
export type Img2ImgInput = z.infer<typeof img2imgSchema>;

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
 * Generate an image from a text prompt (txt2img)
 */
export async function generateImage(
  client: ComfyUIClient,
  input: GenerateImageInput,
  defaultModel: string
): Promise<{ success: boolean; path: string; remote_url?: string; seed: number; message: string }> {
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

  const workflow = buildTxt2ImgWorkflow({
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
      ? `Image generated and uploaded to cloud: ${remote_url}`
      : `Image generated and saved to ${input.output_path}`,
  };
}

/**
 * Generate an image from an input image (img2img)
 */
export async function img2img(
  client: ComfyUIClient,
  input: Img2ImgInput,
  defaultModel: string
): Promise<{ success: boolean; path: string; seed: number; message: string }> {
  const model = input.model || defaultModel;

  if (!model) {
    throw new Error("No model specified and COMFYUI_MODEL not set");
  }

  const seed = input.seed ?? Math.floor(Math.random() * 2147483647);

  const loras: LoraConfig[] | undefined = input.loras?.map((l) => ({
    name: l.name,
    strength_model: l.strength_model,
    strength_clip: l.strength_clip,
  }));

  const workflow = buildImg2ImgWorkflow({
    prompt: input.prompt,
    negativePrompt: input.negative_prompt,
    inputImage: input.input_image,
    denoise: input.denoise,
    steps: input.steps,
    cfgScale: input.cfg_scale,
    sampler: input.sampler,
    scheduler: input.scheduler,
    model: model,
    seed: seed,
    loras: loras,
  });

  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  await extractAndSaveImage(client, history, "9", input.output_path);

  return {
    success: true,
    path: input.output_path,
    seed: seed,
    message: `Image generated via img2img and saved to ${input.output_path}`,
  };
}
