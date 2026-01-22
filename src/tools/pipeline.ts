import { z } from "zod";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  buildTxt2ImgWorkflow,
  buildImg2ImgWorkflow,
  buildUpscaleWorkflow,
  buildZTurboTxt2ImgWorkflow,
  buildZTurboImg2ImgWorkflow,
  isZImageTurboModel,
  LoraConfig,
} from "../workflows/builder.js";
import { mkdir } from "fs/promises";
import { dirname, basename } from "path";

// Schema for LoRA configuration
const loraSchema = z.object({
  name: z.string(),
  strength_model: z.number().optional().default(1.0),
  strength_clip: z.number().optional().default(1.0),
});

// Schema for pipeline execution
export const executePipelineSchema = z.object({
  prompt: z.string().describe("The positive prompt"),
  negative_prompt: z.string().optional().describe("The negative prompt"),
  model: z.string().describe("Checkpoint model to use"),
  output_path: z.string().describe("Final output path for the image"),

  // Generation settings
  width: z.number().optional().default(768),
  height: z.number().optional().default(1024),
  steps: z.number().optional().default(28),
  cfg_scale: z.number().optional().default(7),
  sampler: z.string().optional().default("euler_ancestral"),
  scheduler: z.string().optional().default("normal"),
  seed: z.number().optional(),
  loras: z.array(loraSchema).optional(),

  // Pipeline options
  enable_hires_fix: z.boolean().optional().default(false).describe("Enable hi-res fix (img2img pass)"),
  hires_scale: z.number().optional().default(1.5).describe("Scale factor for hi-res fix"),
  hires_denoise: z.number().optional().default(0.4).describe("Denoise strength for hi-res fix (lower = preserve more)"),
  hires_steps: z.number().optional().default(20).describe("Steps for hi-res fix pass"),

  enable_upscale: z.boolean().optional().default(false).describe("Enable AI upscaling"),
  upscale_model: z.string().optional().default("RealESRGAN_x4plus.pth"),
});

export type ExecutePipelineInput = z.infer<typeof executePipelineSchema>;

interface PipelineResult {
  success: boolean;
  finalPath: string;
  seed: number;
  steps: {
    name: string;
    success: boolean;
    outputPath?: string;
    error?: string;
  }[];
  message: string;
}

/**
 * Upload an image to ComfyUI's input folder
 */
async function uploadToComfyUI(
  client: ComfyUIClient,
  imageBuffer: Buffer,
  filename: string
): Promise<string> {
  const baseUrl = (client as any).baseUrl;

  // Create form data - convert Buffer to Uint8Array for Blob compatibility
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(imageBuffer)], { type: "image/png" });
  formData.append("image", blob, filename);
  formData.append("overwrite", "true");

  const response = await fetch(`${baseUrl}/upload/image`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload image: ${response.status}`);
  }

  const result = await response.json();
  return result.name; // Returns the filename in ComfyUI's input folder
}

/**
 * Execute a full generation pipeline: txt2img → (optional) hi-res fix → (optional) upscale
 */
export async function executePipeline(
  client: ComfyUIClient,
  input: ExecutePipelineInput,
  defaultModel: string
): Promise<PipelineResult> {
  const model = input.model || defaultModel;
  if (!model) {
    throw new Error("No model specified and COMFYUI_MODEL not set");
  }

  const seed = input.seed ?? Math.floor(Math.random() * 2147483647);
  const steps: PipelineResult["steps"] = [];

  // Prepare LoRAs
  const loras: LoraConfig[] | undefined = input.loras?.map((l) => ({
    name: l.name,
    strength_model: l.strength_model,
    strength_clip: l.strength_clip,
  }));

  // Determine output paths for intermediate steps
  const finalDir = dirname(input.output_path);
  const finalName = basename(input.output_path, ".png");

  let currentImageBuffer: Buffer | null = null;
  let currentImageFilename: string | null = null;

  // ============================================================
  // STEP 1: Text-to-Image
  // ============================================================
  const isZTurbo = isZImageTurboModel(model);

  try {
    console.error(`Pipeline: Starting txt2img${isZTurbo ? " (Z-Image Turbo mode)" : ""}...`);

    // Use Z-Image Turbo workflow if detected
    const txt2imgWorkflow = isZTurbo
      ? buildZTurboTxt2ImgWorkflow({
          prompt: input.prompt,
          // Z-Image ignores negative prompts
          width: input.width,
          height: input.height,
          steps: input.steps || 8, // Z-Image default
          cfgScale: 1.0, // Fixed for Z-Image
          sampler: input.sampler || "euler",
          scheduler: input.scheduler || "simple",
          model: model,
          seed: seed,
          loras: loras,
        })
      : buildTxt2ImgWorkflow({
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

    const { prompt_id } = await client.queuePrompt(txt2imgWorkflow);
    const history = await client.waitForCompletion(prompt_id, (value, max) => {
      console.error(`  txt2img progress: ${value}/${max}`);
    });

    // Get the output image
    const saveImageOutput = history.outputs["9"];
    if (!saveImageOutput?.images?.[0]) {
      throw new Error("No image in txt2img output");
    }

    const imageInfo = saveImageOutput.images[0];
    currentImageBuffer = await client.getImage(
      imageInfo.filename,
      imageInfo.subfolder,
      imageInfo.type
    );
    currentImageFilename = imageInfo.filename;

    // If no further steps, save here
    if (!input.enable_hires_fix && !input.enable_upscale) {
      await mkdir(finalDir, { recursive: true });
      const fs = await import("fs/promises");
      await fs.writeFile(input.output_path, currentImageBuffer);
    }

    steps.push({
      name: "txt2img",
      success: true,
      outputPath: !input.enable_hires_fix && !input.enable_upscale ? input.output_path : undefined,
    });

    console.error("Pipeline: txt2img complete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push({ name: "txt2img", success: false, error: message });
    return {
      success: false,
      finalPath: "",
      seed,
      steps,
      message: `Pipeline failed at txt2img: ${message}`,
    };
  }

  // ============================================================
  // STEP 2: Hi-Res Fix (img2img)
  // ============================================================
  if (input.enable_hires_fix && currentImageBuffer) {
    try {
      console.error("Pipeline: Starting hi-res fix...");

      // Upload the txt2img result to ComfyUI input folder
      const uploadedFilename = await uploadToComfyUI(
        client,
        currentImageBuffer,
        `hires_input_${Date.now()}.png`
      );

      // Calculate hi-res dimensions
      const hiresWidth = Math.round(input.width! * input.hires_scale!);
      const hiresHeight = Math.round(input.height! * input.hires_scale!);

      // Use Z-Image Turbo img2img workflow if detected
      const img2imgWorkflow = isZTurbo
        ? buildZTurboImg2ImgWorkflow({
            prompt: input.prompt,
            // Z-Image ignores negative prompts
            inputImage: uploadedFilename,
            denoise: input.hires_denoise,
            steps: input.hires_steps || 8,
            cfgScale: 1.0, // Fixed for Z-Image
            sampler: input.sampler || "euler",
            scheduler: input.scheduler || "simple",
            model: model,
            seed: seed,
            loras: loras,
          })
        : buildImg2ImgWorkflow({
            prompt: input.prompt,
            negativePrompt: input.negative_prompt,
            inputImage: uploadedFilename,
            denoise: input.hires_denoise,
            steps: input.hires_steps,
            cfgScale: input.cfg_scale,
            sampler: input.sampler,
            scheduler: input.scheduler,
            model: model,
            seed: seed,
            loras: loras,
          });

      // Manually set the scaled dimensions in the VAE Encode's source
      // This requires modifying the workflow to resize
      // For now, we'll rely on the img2img workflow handling it

      const { prompt_id } = await client.queuePrompt(img2imgWorkflow);
      const history = await client.waitForCompletion(prompt_id, (value, max) => {
        console.error(`  hi-res fix progress: ${value}/${max}`);
      });

      // Z-Image img2img uses node "10" for SaveImage, standard uses "9"
      const saveImageNodeId = isZTurbo ? "10" : "9";
      const saveImageOutput = history.outputs[saveImageNodeId];
      if (!saveImageOutput?.images?.[0]) {
        throw new Error("No image in hi-res fix output");
      }

      const imageInfo = saveImageOutput.images[0];
      currentImageBuffer = await client.getImage(
        imageInfo.filename,
        imageInfo.subfolder,
        imageInfo.type
      );
      currentImageFilename = imageInfo.filename;

      // If no upscale, save here
      if (!input.enable_upscale) {
        await mkdir(finalDir, { recursive: true });
        const fs = await import("fs/promises");
        await fs.writeFile(input.output_path, currentImageBuffer);
      }

      steps.push({
        name: "hires_fix",
        success: true,
        outputPath: !input.enable_upscale ? input.output_path : undefined,
      });

      console.error("Pipeline: hi-res fix complete");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({ name: "hires_fix", success: false, error: message });

      // Save what we have so far
      if (currentImageBuffer) {
        await mkdir(finalDir, { recursive: true });
        const fs = await import("fs/promises");
        await fs.writeFile(input.output_path, currentImageBuffer);
      }

      return {
        success: false,
        finalPath: input.output_path,
        seed,
        steps,
        message: `Pipeline failed at hi-res fix: ${message}. Saved txt2img result.`,
      };
    }
  }

  // ============================================================
  // STEP 3: Upscale
  // ============================================================
  if (input.enable_upscale && currentImageBuffer) {
    try {
      console.error("Pipeline: Starting upscale...");

      // Upload current result to ComfyUI input folder
      const uploadedFilename = await uploadToComfyUI(
        client,
        currentImageBuffer,
        `upscale_input_${Date.now()}.png`
      );

      const upscaleWorkflow = buildUpscaleWorkflow({
        inputImage: uploadedFilename,
        upscaleModel: input.upscale_model,
      });

      const { prompt_id } = await client.queuePrompt(upscaleWorkflow);
      const history = await client.waitForCompletion(prompt_id, (value, max) => {
        console.error(`  upscale progress: ${value}/${max}`);
      });

      const saveImageOutput = history.outputs["5"];
      if (!saveImageOutput?.images?.[0]) {
        throw new Error("No image in upscale output");
      }

      const imageInfo = saveImageOutput.images[0];
      currentImageBuffer = await client.getImage(
        imageInfo.filename,
        imageInfo.subfolder,
        imageInfo.type
      );

      // Save final result
      await mkdir(finalDir, { recursive: true });
      const fs = await import("fs/promises");
      await fs.writeFile(input.output_path, currentImageBuffer);

      steps.push({
        name: "upscale",
        success: true,
        outputPath: input.output_path,
      });

      console.error("Pipeline: upscale complete");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({ name: "upscale", success: false, error: message });

      // Save what we have so far
      if (currentImageBuffer) {
        await mkdir(finalDir, { recursive: true });
        const fs = await import("fs/promises");
        await fs.writeFile(input.output_path, currentImageBuffer);
      }

      return {
        success: false,
        finalPath: input.output_path,
        seed,
        steps,
        message: `Pipeline failed at upscale: ${message}. Saved previous step result.`,
      };
    }
  }

  // Build success message
  const stepsCompleted = steps.filter((s) => s.success).map((s) => s.name);
  const pipelineDesc = stepsCompleted.join(" → ");

  return {
    success: true,
    finalPath: input.output_path,
    seed,
    steps,
    message: `Pipeline complete (${pipelineDesc}). Image saved to ${input.output_path}`,
  };
}
