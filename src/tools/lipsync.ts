import { z } from "zod";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  buildLipSyncWorkflow,
  buildTalkingAvatarWorkflow,
  LipSyncParams,
} from "../workflows/builder.js";
import { mkdir } from "fs/promises";
import { dirname } from "path";

// ============================================================================
// Schemas
// ============================================================================

export const lipSyncGenerateSchema = z.object({
  portrait_image: z.string().describe("Filename of portrait image in ComfyUI input folder"),
  audio: z.string().describe("Filename of audio file in ComfyUI input folder"),
  model: z.enum(["sonic", "dice-talk", "hallo2", "sadtalker"]).optional().default("sonic")
    .describe("Lip-sync model to use"),
  // SONIC-specific parameters
  checkpoint: z.string().optional().describe("Base SD model checkpoint"),
  clip_vision: z.string().optional().describe("CLIP Vision model"),
  vae: z.string().optional().describe("VAE model"),
  sonic_unet: z.string().optional().default("unet.pth").describe("SONIC unet model file"),
  ip_audio_scale: z.number().optional().default(1.0).describe("Audio influence scale (0.5-2.0)"),
  use_interframe: z.boolean().optional().default(true).describe("Use interframe interpolation"),
  dtype: z.enum(["fp16", "fp32", "bf16"]).optional().default("fp16").describe("Model precision"),
  min_resolution: z.number().optional().default(512).describe("Minimum resolution"),
  duration: z.number().optional().default(10.0).describe("Maximum duration in seconds"),
  expand_ratio: z.number().optional().default(0.5).describe("Face crop expansion ratio"),
  inference_steps: z.number().optional().default(25).describe("Number of inference steps"),
  dynamic_scale: z.number().optional().default(1.0).describe("Dynamic scale factor"),
  fps: z.number().optional().default(25.0).describe("Output video FPS"),
  seed: z.number().optional().describe("Random seed for reproducibility"),
  output_path: z.string().describe("Full path to save the output video"),
});

export const talkSchema = z.object({
  text: z.string().describe("Text to speak"),
  voice_reference: z.string().describe("Voice reference audio file in ComfyUI input folder"),
  voice_reference_text: z.string().optional().describe("Transcript of the voice reference"),
  portrait_image: z.string().describe("Portrait image in ComfyUI input folder"),
  // TTS params
  speed: z.number().optional().default(1.0).describe("Speech speed multiplier"),
  tts_seed: z.number().optional().describe("TTS random seed"),
  // LipSync params
  checkpoint: z.string().optional().describe("Base SD model checkpoint"),
  clip_vision: z.string().optional().describe("CLIP Vision model"),
  vae: z.string().optional().describe("VAE model"),
  sonic_unet: z.string().optional().default("unet.pth"),
  inference_steps: z.number().optional().default(25),
  fps: z.number().optional().default(25.0),
  lipsync_seed: z.number().optional().describe("Lip-sync random seed"),
  output_path: z.string().describe("Full path to save the output video"),
});

export const listLipSyncModelsSchema = z.object({});

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Generate a lip-synced video from portrait + audio
 */
export async function lipSyncGenerate(
  args: z.infer<typeof lipSyncGenerateSchema>,
  client: ComfyUIClient
): Promise<{ video: string; duration?: number }> {
  const {
    portrait_image,
    audio,
    model = "sonic",
    checkpoint,
    clip_vision,
    vae,
    sonic_unet,
    ip_audio_scale,
    use_interframe,
    dtype,
    min_resolution,
    duration,
    expand_ratio,
    inference_steps,
    dynamic_scale,
    fps,
    seed,
    output_path,
  } = args;

  // Only SONIC is implemented for now
  if (model !== "sonic") {
    throw new Error(`Model '${model}' is not yet implemented. Only 'sonic' is currently supported.`);
  }

  // Build workflow
  const workflow = buildLipSyncWorkflow({
    portraitImage: portrait_image,
    audio,
    model,
    checkpoint,
    clipVision: clip_vision,
    vae,
    sonicUnet: sonic_unet,
    ipAudioScale: ip_audio_scale,
    useInterframe: use_interframe,
    dtype,
    minResolution: min_resolution,
    duration,
    expandRatio: expand_ratio,
    inferenceSteps: inference_steps,
    dynamicScale: dynamic_scale,
    fps,
    seed,
    filenamePrefix: "ComfyUI_LipSync",
  });

  // Execute workflow
  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  if (!history || !history.outputs) {
    throw new Error("No output from workflow");
  }

  // Find video output (node "9" is VHS_VideoCombine)
  const videoOutput = history.outputs["9"] as any;

  if (!videoOutput?.gifs?.[0] && !videoOutput?.videos?.[0]) {
    // Check for images (some nodes output as images)
    const imageOutput = Object.values(history.outputs).find(
      (output: any) => output.images && output.images.length > 0
    );
    if (!imageOutput) {
      throw new Error("No video or image output found in workflow result");
    }
  }

  // VHS_VideoCombine outputs to "gifs" array despite being video
  const video = videoOutput?.gifs?.[0] || videoOutput?.videos?.[0];
  if (video) {
    await mkdir(dirname(output_path), { recursive: true });
    const videoData = await client.getVideo(video.filename, video.subfolder || "", video.type || "output");
    const fs = await import("fs/promises");
    await fs.writeFile(output_path, videoData);
  }

  return {
    video: output_path,
    duration: duration,
  };
}

/**
 * Full pipeline: Text → TTS → LipSync → Video
 */
export async function talk(
  args: z.infer<typeof talkSchema>,
  client: ComfyUIClient
): Promise<{ video: string; text: string }> {
  const {
    text,
    voice_reference,
    voice_reference_text,
    portrait_image,
    speed,
    tts_seed,
    checkpoint,
    clip_vision,
    vae,
    sonic_unet,
    inference_steps,
    fps,
    lipsync_seed,
    output_path,
  } = args;

  // Build combined workflow
  const workflow = buildTalkingAvatarWorkflow({
    text,
    voiceReference: voice_reference,
    voiceReferenceText: voice_reference_text,
    portraitImage: portrait_image,
    speed,
    ttsSeed: tts_seed,
    checkpoint,
    clipVision: clip_vision,
    vae,
    sonicUnet: sonic_unet,
    inferenceSteps: inference_steps,
    fps,
    lipSyncSeed: lipsync_seed,
    filenamePrefix: "ComfyUI_TalkingAvatar",
  });

  // Execute workflow
  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  if (!history || !history.outputs) {
    throw new Error("No output from workflow");
  }

  // Find video output (node "output" is VHS_VideoCombine)
  const videoOutput = history.outputs["output"] as any;

  if (!videoOutput?.gifs?.[0] && !videoOutput?.videos?.[0]) {
    throw new Error("No video output found in workflow result");
  }

  // VHS_VideoCombine outputs to "gifs" array despite being video
  const video = videoOutput?.gifs?.[0] || videoOutput?.videos?.[0];
  await mkdir(dirname(output_path), { recursive: true });
  const videoData = await client.getVideo(video.filename, video.subfolder || "", video.type || "output");
  const fs = await import("fs/promises");
  await fs.writeFile(output_path, videoData);

  return {
    video: output_path,
    text,
  };
}

/**
 * List available lip-sync models
 */
export async function listLipSyncModels(
  _args: z.infer<typeof listLipSyncModelsSchema>,
  client: ComfyUIClient
): Promise<{
  sonic: { available: boolean; models: string[] };
  "dice-talk": { available: boolean; models: string[] };
  hallo2: { available: boolean; models: string[] };
  sadtalker: { available: boolean; models: string[] };
}> {
  const objectInfo = await client.getObjectInfo();

  // Check which models are available based on node presence
  const sonicAvailable = "SONICTLoader" in objectInfo;
  const diceTalkAvailable = "DICETalkLoader" in objectInfo;
  const hallo2Available = "Hallo2Loader" in objectInfo;
  const sadtalkerAvailable = "SadTalkerLoader" in objectInfo;

  // Get SONIC models from folder_paths if available
  let sonicModels: string[] = [];
  if (sonicAvailable && objectInfo.SONICTLoader?.input?.required?.sonic_unet) {
    const unetOptions = objectInfo.SONICTLoader.input.required.sonic_unet;
    if (Array.isArray(unetOptions) && Array.isArray(unetOptions[0])) {
      sonicModels = unetOptions[0].filter((m: string) => m !== "none");
    }
  }

  return {
    sonic: {
      available: sonicAvailable,
      models: sonicModels,
    },
    "dice-talk": {
      available: diceTalkAvailable,
      models: [],
    },
    hallo2: {
      available: hallo2Available,
      models: [],
    },
    sadtalker: {
      available: sadtalkerAvailable,
      models: [],
    },
  };
}
