/**
 * RunPod Backend
 *
 * Implements ComfyBackend using RunPod serverless.
 */

import {
  ComfyBackend,
  GenerationResult,
  PortraitParams,
  TTSParams,
  LipSyncParams,
  ImagineParams,
  RunPodBackendConfig,
} from "./types.js";
import { RunPodServerlessClient } from "../runpod-serverless-client.js";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";

export class RunPodBackend implements ComfyBackend {
  readonly name = "runpod" as const;
  private client: RunPodServerlessClient;

  constructor(config: RunPodBackendConfig) {
    this.client = new RunPodServerlessClient({
      endpointId: config.endpointId,
      apiKey: config.apiKey,
      timeout: config.timeout,
    });
  }

  async healthCheck() {
    try {
      const health = await this.client.health();
      return {
        healthy: health.status === "healthy",
        version: (health as any).version,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async portrait(params: PortraitParams): Promise<GenerationResult> {
    try {
      const response = await this.client.runSync({
        action: "portrait",
        prompt: params.prompt,
        negative_prompt: params.negativePrompt,
        model: params.model,
        width: params.width,
        height: params.height,
        steps: params.steps,
        cfg_scale: params.cfgScale,
        seed: params.seed,
        save_to_avatars: params.saveToAvatars,
        avatar_name: params.avatarName,
      });

      if (response.status !== "success") {
        return {
          success: false,
          files: [],
          error: response.error || "Portrait generation failed",
          backend: "runpod",
        };
      }

      // Download files if we have URLs
      const files = await this.processFiles(response.files || [], params.outputPath);

      return {
        success: true,
        files,
        seed: (response as any).seed,
        promptId: response.prompt_id,
        backend: "runpod",
      };
    } catch (error) {
      return {
        success: false,
        files: [],
        error: error instanceof Error ? error.message : "Unknown error",
        backend: "runpod",
      };
    }
  }

  async tts(params: TTSParams): Promise<GenerationResult> {
    try {
      const response = await this.client.tts({
        text: params.text,
        voice_reference: params.voiceReference,
        voice_reference_text: params.voiceReferenceText,
        speed: params.speed,
        seed: params.seed,
      });

      if (response.status !== "success") {
        return {
          success: false,
          files: [],
          error: response.error || "TTS generation failed",
          backend: "runpod",
        };
      }

      const files = await this.processFiles(response.files || [], params.outputPath);

      return {
        success: true,
        files,
        backend: "runpod",
      };
    } catch (error) {
      return {
        success: false,
        files: [],
        error: error instanceof Error ? error.message : "Unknown error",
        backend: "runpod",
      };
    }
  }

  async lipsync(params: LipSyncParams): Promise<GenerationResult> {
    try {
      const response = await this.client.lipsync({
        portrait_image: params.portraitImage,
        audio: params.audio,
        inference_steps: params.inferenceSteps,
        fps: params.fps,
      });

      if (response.status !== "success") {
        return {
          success: false,
          files: [],
          error: response.error || "Lipsync generation failed",
          backend: "runpod",
        };
      }

      const files = await this.processFiles(response.files || [], params.outputPath);

      return {
        success: true,
        files,
        promptId: response.prompt_id,
        backend: "runpod",
      };
    } catch (error) {
      return {
        success: false,
        files: [],
        error: error instanceof Error ? error.message : "Unknown error",
        backend: "runpod",
      };
    }
  }

  async imagine(params: ImagineParams): Promise<GenerationResult> {
    // Map imagine to portrait with appropriate defaults
    return this.portrait({
      prompt: params.description,
      model: params.model,
      width: params.width || 1024,
      height: params.height || 1024,
      steps: params.quality === "draft" ? 15 : params.quality === "ultra" ? 40 : 25,
      seed: params.seed,
      outputPath: params.outputPath,
    });
  }

  /**
   * Process RunPod response files - download if base64, return URLs otherwise
   */
  private async processFiles(
    runpodFiles: any[],
    outputPath: string
  ): Promise<GenerationResult["files"]> {
    const files: GenerationResult["files"] = [];

    for (const file of runpodFiles) {
      const result: GenerationResult["files"][0] = {
        type: file.type,
        filename: file.filename,
        remoteUrl: file.url,
        signedUrl: file.signed_url,
        sizeBytes: file.size,
      };

      // If we have base64 data, save it locally
      if (file.data && file.encoding === "base64") {
        await mkdir(dirname(outputPath), { recursive: true });
        const buffer = Buffer.from(file.data, "base64");
        await writeFile(outputPath, buffer);
        result.localPath = outputPath;
      }

      files.push(result);
    }

    return files;
  }
}
