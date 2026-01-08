import { z } from "zod";
import { ComfyUIClient } from "../comfyui-client.js";
import { buildUpscaleWorkflow } from "../workflows/builder.js";
import { mkdir } from "fs/promises";
import { dirname } from "path";

export const upscaleSchema = z.object({
  input_image: z.string().describe("Filename of image in ComfyUI input folder"),
  upscale_model: z
    .string()
    .default("RealESRGAN_x4plus.pth")
    .describe("Upscale model name (e.g., RealESRGAN_x4plus.pth, 4x-UltraSharp.pth)"),
  target_width: z.number().optional().describe("Target width after upscale (optional resize)"),
  target_height: z.number().optional().describe("Target height after upscale (optional resize)"),
  output_path: z.string().describe("Full path where the upscaled image should be saved"),
});

export type UpscaleInput = z.infer<typeof upscaleSchema>;

/**
 * Upscale an image using AI upscaling models
 */
export async function upscaleImage(
  client: ComfyUIClient,
  input: UpscaleInput
): Promise<{ success: boolean; path: string; message: string }> {
  const workflow = buildUpscaleWorkflow({
    inputImage: input.input_image,
    upscaleModel: input.upscale_model,
    targetWidth: input.target_width,
    targetHeight: input.target_height,
  });

  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  // Find the output - it's in node "5" (SaveImage)
  const saveImageOutput = history.outputs["5"];
  if (!saveImageOutput?.images?.[0]) {
    throw new Error("No image in output");
  }

  const imageInfo = saveImageOutput.images[0];
  const imageBuffer = await client.getImage(
    imageInfo.filename,
    imageInfo.subfolder,
    imageInfo.type
  );

  await mkdir(dirname(input.output_path), { recursive: true });
  const fs = await import("fs/promises");
  await fs.writeFile(input.output_path, imageBuffer);

  return {
    success: true,
    path: input.output_path,
    message: `Image upscaled and saved to ${input.output_path}`,
  };
}

/**
 * List available upscale models
 */
export async function listUpscaleModels(client: ComfyUIClient): Promise<string[]> {
  const objectInfo = await client.getObjectInfo();
  const upscaleLoader = objectInfo["UpscaleModelLoader"];
  if (upscaleLoader?.input?.required?.model_name?.[0]) {
    return upscaleLoader.input.required.model_name[0];
  }
  return [];
}
