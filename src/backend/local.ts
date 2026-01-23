/**
 * Local Backend
 *
 * Implements ComfyBackend using local ComfyUI.
 * This is the DEFAULT backend for most operations.
 */

import {
  ComfyBackend,
  GenerationResult,
  PortraitParams,
  TTSParams,
  LipSyncParams,
  ImagineParams,
  LocalBackendConfig,
} from "./types.js";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  buildTxt2ImgWorkflow,
  buildTTSWorkflow,
  buildLipSyncWorkflow,
} from "../workflows/builder.js";
import { mkdir, writeFile } from "fs/promises";
import { dirname, basename } from "path";

export class LocalBackend implements ComfyBackend {
  readonly name = "local" as const;
  private client: ComfyUIClient;
  private config: LocalBackendConfig;

  constructor(config: LocalBackendConfig) {
    this.config = config;
    this.client = new ComfyUIClient({
      url: config.comfyuiUrl,
      inputDir: config.inputDir,
      outputDir: config.outputDir,
      timeout: config.timeout,
    });
  }

  async healthCheck() {
    try {
      const stats = await this.client.getSystemStats();
      return {
        healthy: true,
        version: "local",
        details: stats,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : "Cannot connect to local ComfyUI",
      };
    }
  }

  async portrait(params: PortraitParams): Promise<GenerationResult> {
    try {
      const workflow = buildTxt2ImgWorkflow({
        prompt: params.prompt,
        negativePrompt: params.negativePrompt || "low quality, blurry",
        model: params.model || "sd_xl_base_1.0.safetensors",
        width: params.width || 768,
        height: params.height || 1024,
        steps: params.steps || 20,
        cfgScale: params.cfgScale || 7,
        seed: params.seed,
      });

      const { prompt_id } = await this.client.queuePrompt(workflow);
      const history = await this.client.waitForCompletion(prompt_id);

      if (!history?.outputs) {
        return {
          success: false,
          files: [],
          error: "No output from workflow",
          backend: "local",
        };
      }

      // Find image output
      const files = await this.extractOutputFiles(history, params.outputPath);

      return {
        success: files.length > 0,
        files,
        seed: params.seed,
        promptId: prompt_id,
        backend: "local",
      };
    } catch (error) {
      return {
        success: false,
        files: [],
        error: error instanceof Error ? error.message : "Unknown error",
        backend: "local",
      };
    }
  }

  async tts(params: TTSParams): Promise<GenerationResult> {
    try {
      const workflow = buildTTSWorkflow({
        text: params.text,
        voiceReference: params.voiceReference,
        voiceReferenceText: params.voiceReferenceText,
        speed: params.speed || 1.0,
        seed: params.seed,
      });

      const { prompt_id } = await this.client.queuePrompt(workflow);
      const history = await this.client.waitForCompletion(prompt_id);

      if (!history?.outputs) {
        return {
          success: false,
          files: [],
          error: "No output from workflow",
          backend: "local",
        };
      }

      const files = await this.extractOutputFiles(history, params.outputPath);

      return {
        success: files.length > 0,
        files,
        promptId: prompt_id,
        backend: "local",
      };
    } catch (error) {
      return {
        success: false,
        files: [],
        error: error instanceof Error ? error.message : "Unknown error",
        backend: "local",
      };
    }
  }

  async lipsync(params: LipSyncParams): Promise<GenerationResult> {
    // NOTE: Lipsync is heavy - consider using RunPod backend for this
    try {
      const workflow = buildLipSyncWorkflow({
        portraitImage: params.portraitImage,
        audio: params.audio,
        duration: params.duration || 99999,
        inferenceSteps: params.inferenceSteps || 25,
        fps: params.fps || 25,
        seed: params.seed,
      });

      const { prompt_id } = await this.client.queuePrompt(workflow);
      const history = await this.client.waitForCompletion(prompt_id);

      if (!history?.outputs) {
        return {
          success: false,
          files: [],
          error: "No output from workflow",
          backend: "local",
        };
      }

      const files = await this.extractOutputFiles(history, params.outputPath);

      return {
        success: files.length > 0,
        files,
        promptId: prompt_id,
        backend: "local",
      };
    } catch (error) {
      return {
        success: false,
        files: [],
        error: error instanceof Error ? error.message : "Unknown error",
        backend: "local",
      };
    }
  }

  async imagine(params: ImagineParams): Promise<GenerationResult> {
    try {
      // Map quality to steps
      const stepsMap = { draft: 15, standard: 25, high: 35, ultra: 40 };
      const steps = stepsMap[params.quality || "standard"] || 25;

      const workflow = buildTxt2ImgWorkflow({
        prompt: params.description,
        model: params.model || "sd_xl_base_1.0.safetensors",
        width: params.width || 1024,
        height: params.height || 1024,
        steps,
        seed: params.seed,
      });

      const { prompt_id } = await this.client.queuePrompt(workflow);
      const history = await this.client.waitForCompletion(prompt_id);

      if (!history?.outputs) {
        return {
          success: false,
          files: [],
          error: "No output from workflow",
          backend: "local",
        };
      }

      const files = await this.extractOutputFiles(history, params.outputPath);

      return {
        success: files.length > 0,
        files,
        seed: params.seed,
        promptId: prompt_id,
        backend: "local",
      };
    } catch (error) {
      return {
        success: false,
        files: [],
        error: error instanceof Error ? error.message : "Unknown error",
        backend: "local",
      };
    }
  }

  /**
   * Extract output files from ComfyUI history and save locally
   */
  private async extractOutputFiles(
    history: any,
    outputPath: string
  ): Promise<GenerationResult["files"]> {
    const files: GenerationResult["files"] = [];

    for (const nodeOutput of Object.values(history.outputs || {})) {
      const output = nodeOutput as any;

      // Images
      if (output.images) {
        for (const img of output.images) {
          const data = await this.client.getImage(
            img.filename,
            img.subfolder || "",
            img.type || "output"
          );
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, data);

          files.push({
            type: "image",
            filename: img.filename,
            localPath: outputPath,
          });
        }
      }

      // Videos (VHS uses 'gifs' key)
      if (output.gifs || output.videos) {
        const videos = output.gifs || output.videos;
        for (const vid of videos) {
          const data = await this.client.getVideo(
            vid.filename,
            vid.subfolder || "",
            vid.type || "output"
          );
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, data);

          files.push({
            type: "video",
            filename: vid.filename,
            localPath: outputPath,
          });
        }
      }

      // Audio
      if (output.audio) {
        for (const aud of output.audio) {
          const data = await this.client.getAudio(
            aud.filename,
            aud.subfolder || "",
            aud.type || "output"
          );
          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, data);

          files.push({
            type: "audio",
            filename: aud.filename,
            localPath: outputPath,
          });
        }
      }
    }

    return files;
  }
}
