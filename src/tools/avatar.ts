import { z } from "zod";
import { ComfyUIClient } from "../comfyui-client.js";
import { mkdir } from "fs/promises";
import { dirname } from "path";

// ============================================================================
// Conventions
// ============================================================================

/**
 * Conventional locations in ComfyUI input folder:
 * - avatars/  -> Portrait images for lip-sync
 * - voices/   -> Voice reference audio for TTS cloning
 */
export const AVATAR_SUBFOLDER = "avatars";
export const VOICE_SUBFOLDER = "voices";

// ============================================================================
// Schemas
// ============================================================================

export const listAvatarsSchema = z.object({});

export const listVoicesCatalogSchema = z.object({});

export const createPortraitSchema = z.object({
  description: z.string().describe("Description of the person/character to generate"),
  style: z.enum(["realistic", "artistic", "anime"]).optional().default("realistic")
    .describe("Visual style for the portrait"),
  gender: z.enum(["male", "female", "androgynous"]).optional()
    .describe("Gender presentation (helps with prompting)"),
  age: z.string().optional().describe("Approximate age (e.g., '30s', 'elderly', 'young')"),
  expression: z.enum(["neutral", "slight_smile", "serious", "friendly"]).optional().default("neutral")
    .describe("Facial expression"),
  // Flux-specific
  model: z.string().optional().describe("Flux GGUF model to use (defaults to schnell)"),
  guidance: z.number().optional().default(2.0).describe("Flux guidance scale (1-4 for realism)"),
  steps: z.number().optional().default(4).describe("Sampling steps (4 for schnell, 20+ for dev)"),
  seed: z.number().optional().describe("Random seed for reproducibility"),
  output_path: z.string().describe("Full path to save the portrait image"),
});

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * List available avatar portraits from ComfyUI input/avatars folder
 */
export async function listAvatars(
  _args: z.infer<typeof listAvatarsSchema>,
  client: ComfyUIClient
): Promise<{
  avatars: Array<{
    filename: string;
    subfolder: string;
  }>;
  convention: string;
}> {
  const objectInfo = await client.getObjectInfo();

  // Get images from LoadImage node
  let avatars: Array<{ filename: string; subfolder: string }> = [];

  if (objectInfo.LoadImage?.input?.required?.image) {
    const imageOptions = objectInfo.LoadImage.input.required.image;
    if (Array.isArray(imageOptions) && Array.isArray(imageOptions[0])) {
      // Filter for images in avatars subfolder or common portrait formats
      const allImages = imageOptions[0] as string[];
      avatars = allImages
        .filter((img: string) => {
          const lower = img.toLowerCase();
          // Include if in avatars folder OR is an image file
          return (
            img.startsWith(`${AVATAR_SUBFOLDER}/`) ||
            lower.endsWith(".png") ||
            lower.endsWith(".jpg") ||
            lower.endsWith(".jpeg") ||
            lower.endsWith(".webp")
          );
        })
        .map((img: string) => ({
          filename: img.includes("/") ? img.split("/").pop()! : img,
          subfolder: img.includes("/") ? img.split("/").slice(0, -1).join("/") : "",
        }));
    }
  }

  return {
    avatars,
    convention: `Place portrait images in ComfyUI/input/${AVATAR_SUBFOLDER}/ for organization`,
  };
}

/**
 * List available voice references from ComfyUI input/voices folder
 * More structured than list_voices - shows catalog with metadata
 */
export async function listVoicesCatalog(
  _args: z.infer<typeof listVoicesCatalogSchema>,
  client: ComfyUIClient
): Promise<{
  voices: Array<{
    filename: string;
    subfolder: string;
    format: string;
  }>;
  convention: string;
}> {
  const objectInfo = await client.getObjectInfo();

  let voices: Array<{ filename: string; subfolder: string; format: string }> = [];

  // Check LoadAudio for audio files
  if (objectInfo.LoadAudio?.input?.required?.audio) {
    const audioOptions = objectInfo.LoadAudio.input.required.audio;
    if (Array.isArray(audioOptions) && Array.isArray(audioOptions[0])) {
      const allAudio = audioOptions[0] as string[];
      voices = allAudio
        .filter((audio: string) => {
          const lower = audio.toLowerCase();
          return (
            lower.endsWith(".wav") ||
            lower.endsWith(".mp3") ||
            lower.endsWith(".flac") ||
            lower.endsWith(".ogg")
          );
        })
        .map((audio: string) => {
          const ext = audio.split(".").pop()?.toLowerCase() || "unknown";
          return {
            filename: audio.includes("/") ? audio.split("/").pop()! : audio,
            subfolder: audio.includes("/") ? audio.split("/").slice(0, -1).join("/") : "",
            format: ext,
          };
        });
    }
  }

  return {
    voices,
    convention: `Place voice reference audio (10-30s samples) in ComfyUI/input/${VOICE_SUBFOLDER}/ for organization`,
  };
}

/**
 * Generate a portrait image optimized for lip-sync using Flux
 */
export async function createPortrait(
  args: z.infer<typeof createPortraitSchema>,
  client: ComfyUIClient
): Promise<{ image: string; prompt: string }> {
  const {
    description,
    style,
    gender,
    age,
    expression,
    model,
    guidance,
    steps,
    seed,
    output_path,
  } = args;

  // Build optimized portrait prompt
  const promptParts: string[] = [];

  // Style prefix
  if (style === "realistic") {
    promptParts.push("Professional portrait photograph, high resolution, 85mm lens, f/1.8");
  } else if (style === "artistic") {
    promptParts.push("Artistic portrait, painterly style, dramatic lighting");
  } else if (style === "anime") {
    promptParts.push("Anime style portrait, detailed face, clean linework");
  }

  // Core description
  promptParts.push(description);

  // Demographics if specified
  if (gender) {
    promptParts.push(gender === "androgynous" ? "androgynous features" : `${gender} presenting`);
  }
  if (age) {
    promptParts.push(`${age} years old`);
  }

  // Expression
  const expressionMap: Record<string, string> = {
    neutral: "neutral expression, relaxed face",
    slight_smile: "subtle smile, warm expression",
    serious: "serious expression, composed",
    friendly: "friendly expression, approachable",
  };
  promptParts.push(expressionMap[expression || "neutral"]);

  // Lip-sync optimized framing
  promptParts.push("front-facing portrait, looking directly at camera, clear view of face and lips");
  promptParts.push("head and shoulders framing, centered composition");
  promptParts.push("even lighting on face, no harsh shadows");

  const prompt = promptParts.join(", ");

  // Build Flux workflow
  const workflow = buildFluxPortraitWorkflow({
    prompt,
    model: model || "flux1-schnell-Q8_0.gguf",
    guidance: guidance ?? 2.0,
    steps: steps ?? 4,
    seed: seed ?? Math.floor(Math.random() * 2147483647),
    width: 768,
    height: 1024, // Portrait orientation
    filenamePrefix: "ComfyUI_Portrait",
  });

  // Execute workflow
  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  if (!history || !history.outputs) {
    throw new Error("No output from workflow");
  }

  // Find image output
  const imageOutput = history.outputs["save"] as any;

  if (!imageOutput?.images?.[0]) {
    throw new Error("No image output found in workflow result");
  }

  // Download and save image
  const image = imageOutput.images[0];
  await mkdir(dirname(output_path), { recursive: true });
  const imageData = await client.getImage(image.filename, image.subfolder || "", image.type || "output");
  const fs = await import("fs/promises");
  await fs.writeFile(output_path, imageData);

  return {
    image: output_path,
    prompt,
  };
}

// ============================================================================
// Flux Workflow Builder
// ============================================================================

interface FluxPortraitParams {
  prompt: string;
  model: string;
  guidance: number;
  steps: number;
  seed: number;
  width: number;
  height: number;
  filenamePrefix: string;
}

function buildFluxPortraitWorkflow(params: FluxPortraitParams): Record<string, any> {
  return {
    // Load GGUF Flux model
    "unet": {
      class_type: "UnetLoaderGGUF",
      inputs: {
        unet_name: params.model,
      },
    },

    // Load CLIP models (T5 + CLIP-L)
    "clip": {
      class_type: "DualCLIPLoader",
      inputs: {
        clip_name1: "t5xxl_fp16.safetensors",
        clip_name2: "clip_l.safetensors",
        type: "flux",
      },
    },

    // Load VAE
    "vae": {
      class_type: "VAELoader",
      inputs: {
        vae_name: "ae.safetensors",
      },
    },

    // Encode prompt
    "prompt": {
      class_type: "CLIPTextEncode",
      inputs: {
        clip: ["clip", 0],
        text: params.prompt,
      },
    },

    // Flux guidance
    "guidance": {
      class_type: "FluxGuidance",
      inputs: {
        conditioning: ["prompt", 0],
        guidance: params.guidance,
      },
    },

    // Create empty latent
    "latent": {
      class_type: "EmptySD3LatentImage",
      inputs: {
        width: params.width,
        height: params.height,
        batch_size: 1,
      },
    },

    // Random noise
    "noise": {
      class_type: "RandomNoise",
      inputs: {
        noise_seed: params.seed,
      },
    },

    // Sampler selection
    "sampler_select": {
      class_type: "KSamplerSelect",
      inputs: {
        sampler_name: "euler",
      },
    },

    // Scheduler
    "scheduler": {
      class_type: "BasicScheduler",
      inputs: {
        model: ["unet", 0],
        scheduler: "simple",
        steps: params.steps,
        denoise: 1.0,
      },
    },

    // Guider
    "guider": {
      class_type: "BasicGuider",
      inputs: {
        model: ["unet", 0],
        conditioning: ["guidance", 0],
      },
    },

    // Advanced sampler
    "sampler": {
      class_type: "SamplerCustomAdvanced",
      inputs: {
        noise: ["noise", 0],
        guider: ["guider", 0],
        sampler: ["sampler_select", 0],
        sigmas: ["scheduler", 0],
        latent_image: ["latent", 0],
      },
    },

    // Decode latent
    "decode": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["sampler", 0],
        vae: ["vae", 0],
      },
    },

    // Save image
    "save": {
      class_type: "SaveImage",
      inputs: {
        images: ["decode", 0],
        filename_prefix: params.filenamePrefix,
      },
    },
  };
}
