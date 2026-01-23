/**
 * Backend Types
 *
 * Common interface for ComfyUI backends (local, RunPod, etc.)
 * Allows tools to work with any backend transparently.
 */

// ============================================================================
// Result Types
// ============================================================================

export interface GeneratedFile {
  type: "image" | "video" | "audio";
  filename: string;
  localPath?: string;
  remoteUrl?: string;
  signedUrl?: string;
  sizeBytes?: number;
}

export interface GenerationResult {
  success: boolean;
  files: GeneratedFile[];
  seed?: number;
  error?: string;
  promptId?: string;
  backend: "local" | "runpod";
}

// ============================================================================
// Parameter Types
// ============================================================================

export interface PortraitParams {
  prompt: string;
  negativePrompt?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  outputPath: string;
  saveToAvatars?: boolean;
  avatarName?: string;
}

export interface TTSParams {
  text: string;
  voiceReference: string;
  voiceReferenceText?: string;
  speed?: number;
  seed?: number;
  outputPath: string;
}

export interface LipSyncParams {
  portraitImage: string;
  audio: string;
  duration?: number;
  inferenceSteps?: number;
  fps?: number;
  seed?: number;
  outputPath: string;
}

export interface ImagineParams {
  description: string;
  style?: string;
  model?: string;
  width?: number;
  height?: number;
  quality?: "draft" | "standard" | "high" | "ultra";
  seed?: number;
  outputPath: string;
}

// ============================================================================
// Backend Interface
// ============================================================================

export interface ComfyBackend {
  readonly name: "local" | "runpod";

  /**
   * Check if backend is available and healthy
   */
  healthCheck(): Promise<{
    healthy: boolean;
    version?: string;
    error?: string;
  }>;

  /**
   * Generate a portrait image
   */
  portrait(params: PortraitParams): Promise<GenerationResult>;

  /**
   * Generate TTS audio with voice cloning
   */
  tts(params: TTSParams): Promise<GenerationResult>;

  /**
   * Generate lip-sync video
   */
  lipsync(params: LipSyncParams): Promise<GenerationResult>;

  /**
   * General image generation
   */
  imagine(params: ImagineParams): Promise<GenerationResult>;
}

// ============================================================================
// Configuration
// ============================================================================

export interface LocalBackendConfig {
  comfyuiUrl: string;
  inputDir: string;
  outputDir: string;
  timeout?: number;
}

export interface RunPodBackendConfig {
  endpointId: string;
  apiKey: string;
  timeout?: number;
}

export type BackendConfig = {
  type: "local";
  config: LocalBackendConfig;
} | {
  type: "runpod";
  config: RunPodBackendConfig;
};
