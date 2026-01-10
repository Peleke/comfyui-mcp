import { z } from "zod";
import { ComfyUIClient } from "../comfyui-client.js";
import { buildTTSWorkflow, TTSParams } from "../workflows/builder.js";
import { mkdir } from "fs/promises";
import { dirname } from "path";

// ============================================================================
// Schemas
// ============================================================================

export const ttsGenerateSchema = z.object({
  text: z.string().describe("Text to convert to speech"),
  voice_reference: z.string().describe("Reference audio file in ComfyUI input folder for voice cloning"),
  voice_reference_text: z.string().optional().describe("Transcript of the reference audio"),
  speed: z.number().optional().default(1.0).describe("Speech speed multiplier (0.5-2.0)"),
  seed: z.number().optional().default(-1).describe("Random seed (-1 for random)"),
  model: z.string().optional().default("F5TTS_v1_Base").describe("TTS model to use"),
  vocoder: z.enum(["auto", "vocos", "bigvgan"]).optional().default("vocos").describe("Vocoder for audio synthesis"),
  output_path: z.string().describe("Full path to save the output audio"),
});

export const listTTSModelsSchema = z.object({});

export const listVoicesSchema = z.object({});

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Generate speech from text using F5-TTS with voice cloning
 */
export async function ttsGenerate(
  args: z.infer<typeof ttsGenerateSchema>,
  client: ComfyUIClient
): Promise<{ audio: string; text: string }> {
  const {
    text,
    voice_reference,
    voice_reference_text,
    speed,
    seed,
    model,
    vocoder,
    output_path,
  } = args;

  // Build workflow
  const workflow = buildTTSWorkflow({
    text,
    voiceReference: voice_reference,
    voiceReferenceText: voice_reference_text,
    speed,
    seed,
    model,
    vocoder,
    filenamePrefix: "ComfyUI_TTS",
  });

  // Execute workflow
  const { prompt_id } = await client.queuePrompt(workflow);
  const history = await client.waitForCompletion(prompt_id);

  if (!history || !history.outputs) {
    throw new Error("No output from workflow");
  }

  // Find audio output (node "3" is SaveAudioTensor)
  const audioOutput = history.outputs["3"] as any;

  if (!audioOutput) {
    throw new Error("No audio output found in workflow result");
  }

  // Download and save audio
  const audio = audioOutput?.audio?.[0] || audioOutput?.audios?.[0];
  if (audio) {
    await mkdir(dirname(output_path), { recursive: true });
    const audioData = await client.getAudio(audio.filename, audio.subfolder || "", audio.type || "output");
    const fs = await import("fs/promises");
    await fs.writeFile(output_path, audioData);
  }

  return {
    audio: output_path,
    text,
  };
}

/**
 * List available TTS models
 */
export async function listTTSModels(
  _args: z.infer<typeof listTTSModelsSchema>,
  client: ComfyUIClient
): Promise<{
  f5tts: { available: boolean; models: string[] };
  xtts: { available: boolean; models: string[] };
}> {
  const objectInfo = await client.getObjectInfo();

  // Check which TTS systems are available
  const f5ttsAvailable = "F5TTSAudioInputs" in objectInfo || "F5TTSAudio" in objectInfo;
  const xttsAvailable = "XTTS_INFER" in objectInfo;

  // Get F5-TTS models if available
  let f5ttsModels: string[] = [];
  if (f5ttsAvailable) {
    const node = objectInfo.F5TTSAudioInputs || objectInfo.F5TTSAudio;
    if (node?.input?.required?.model) {
      const modelOptions = node.input.required.model;
      if (Array.isArray(modelOptions) && Array.isArray(modelOptions[0])) {
        f5ttsModels = modelOptions[0];
      }
    }
  }

  // Get XTTS languages if available
  let xttsModels: string[] = [];
  if (xttsAvailable && objectInfo.XTTS_INFER?.input?.required?.language) {
    const langOptions = objectInfo.XTTS_INFER.input.required.language;
    if (Array.isArray(langOptions) && Array.isArray(langOptions[0])) {
      xttsModels = langOptions[0];
    }
  }

  return {
    f5tts: {
      available: f5ttsAvailable,
      models: f5ttsModels,
    },
    xtts: {
      available: xttsAvailable,
      models: xttsModels,
    },
  };
}

/**
 * List available voice samples in ComfyUI input folder
 */
export async function listVoices(
  _args: z.infer<typeof listVoicesSchema>,
  client: ComfyUIClient
): Promise<{ voices: string[] }> {
  const objectInfo = await client.getObjectInfo();

  // Check F5-TTS for voice samples
  let voices: string[] = [];

  if (objectInfo.F5TTSAudio?.input?.required?.sample) {
    const sampleOptions = objectInfo.F5TTSAudio.input.required.sample;
    if (Array.isArray(sampleOptions) && Array.isArray(sampleOptions[0])) {
      voices = sampleOptions[0];
    }
  }

  // Also check LoadAudio for general audio files
  if (objectInfo.LoadAudio?.input?.required?.audio) {
    const audioOptions = objectInfo.LoadAudio.input.required.audio;
    if (Array.isArray(audioOptions) && Array.isArray(audioOptions[0])) {
      const audioFiles = audioOptions[0].filter(
        (f: string) => f.endsWith(".wav") || f.endsWith(".mp3") || f.endsWith(".flac")
      );
      voices = [...new Set([...voices, ...audioFiles])];
    }
  }

  return { voices };
}
