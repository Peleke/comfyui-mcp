/**
 * RunPod Serverless Client
 *
 * Client for communicating with ComfyUI deployed as a RunPod serverless endpoint.
 * Provides stable URL (no more changing pod IDs!) and auto-scaling.
 *
 * Usage:
 *   const client = new RunPodServerlessClient(endpointId, apiKey);
 *   const result = await client.portrait({ description: "Viking warrior" });
 */

export interface RunPodConfig {
  endpointId: string;
  apiKey: string;
  timeout?: number; // ms, default 5 minutes
}

export interface PortraitParams {
  description?: string;
  prompt?: string;
  negative_prompt?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfg_scale?: number;
  seed?: number;
}

export interface TTSParams {
  text: string;
  voice_reference: string;
  voice_reference_text?: string;
  speed?: number;
  seed?: number;
}

export interface LipSyncParams {
  portrait_image: string;
  audio: string;
  svd_checkpoint?: string;
  sonic_unet?: string;
  inference_steps?: number;
  fps?: number;
}

export interface RunPodFile {
  type: "image" | "video" | "audio";
  filename: string;
  data?: string; // base64
  encoding?: "base64";
  path?: string;
  size_bytes?: number;
}

export interface RunPodResponse {
  status: "success" | "error";
  action?: string;
  files?: RunPodFile[];
  prompt_id?: string;
  error?: string;
}

export interface RunPodJobStatus {
  id: string;
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  output?: RunPodResponse;
  error?: string;
}

export class RunPodServerlessClient {
  private endpointId: string;
  private apiKey: string;
  private timeout: number;
  private baseUrl: string;

  constructor(config: RunPodConfig) {
    this.endpointId = config.endpointId;
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 5 * 60 * 1000; // 5 minutes default
    this.baseUrl = `https://api.runpod.ai/v2/${this.endpointId}`;
  }

  /**
   * Run a synchronous request (blocks until complete or timeout).
   * Use for requests expected to complete within 30s.
   */
  async runSync<T = RunPodResponse>(input: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/runsync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`RunPod error ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      if (result.status === "FAILED") {
        throw new Error(`RunPod job failed: ${result.error || "Unknown error"}`);
      }

      return result.output as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`RunPod request timed out after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Run an asynchronous request (returns job ID immediately).
   * Use for long-running requests like lip-sync.
   */
  async run(input: Record<string, unknown>): Promise<string> {
    const response = await fetch(`${this.baseUrl}/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`RunPod error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    return result.id;
  }

  /**
   * Check status of an async job.
   */
  async status(jobId: string): Promise<RunPodJobStatus> {
    const response = await fetch(`${this.baseUrl}/status/${jobId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`RunPod error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Wait for an async job to complete.
   */
  async waitForCompletion(
    jobId: string,
    pollInterval: number = 1000,
    maxWait: number = this.timeout
  ): Promise<RunPodResponse> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const status = await this.status(jobId);

      if (status.status === "COMPLETED") {
        return status.output!;
      }

      if (status.status === "FAILED") {
        throw new Error(`RunPod job failed: ${status.error || "Unknown error"}`);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`RunPod job timed out after ${maxWait}ms`);
  }

  // =========================================================================
  // Convenience Methods
  // =========================================================================

  /**
   * Health check.
   */
  async health(): Promise<{ status: string; comfyui_url?: string }> {
    return this.runSync({ action: "health" });
  }

  /**
   * Generate a portrait image.
   */
  async portrait(params: PortraitParams): Promise<RunPodResponse> {
    return this.runSync({
      action: "portrait",
      ...params,
    });
  }

  /**
   * Generate TTS audio with voice cloning.
   */
  async tts(params: TTSParams): Promise<RunPodResponse> {
    return this.runSync({
      action: "tts",
      ...params,
    });
  }

  /**
   * Generate lip-sync video (async, may take 1-2 minutes).
   */
  async lipsync(params: LipSyncParams): Promise<RunPodResponse> {
    // Use async for long-running lip-sync
    const jobId = await this.run({
      action: "lipsync",
      ...params,
    });

    return this.waitForCompletion(jobId);
  }

  /**
   * Generate full talking head: TTS + lip-sync.
   */
  async talkingHead(params: {
    text: string;
    voice_reference: string;
    portrait_image: string;
    voice_reference_text?: string;
    speed?: number;
  }): Promise<{ tts: RunPodResponse; lipsync: RunPodResponse }> {
    // Step 1: Generate TTS
    const ttsResult = await this.tts({
      text: params.text,
      voice_reference: params.voice_reference,
      voice_reference_text: params.voice_reference_text,
      speed: params.speed,
    });

    if (ttsResult.status !== "success" || !ttsResult.files?.length) {
      throw new Error("TTS generation failed");
    }

    // Step 2: Generate lip-sync
    // Note: This assumes the audio file is accessible to the serverless handler
    // In practice, you may need to upload the TTS result first
    const audioFile = ttsResult.files[0].filename;

    const lipsyncResult = await this.lipsync({
      portrait_image: params.portrait_image,
      audio: audioFile,
    });

    return { tts: ttsResult, lipsync: lipsyncResult };
  }
}

/**
 * Create a client from environment variables.
 */
export function createRunPodClient(): RunPodServerlessClient | null {
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  const apiKey = process.env.RUNPOD_API_KEY;

  if (!endpointId || !apiKey) {
    return null;
  }

  return new RunPodServerlessClient({
    endpointId,
    apiKey,
    timeout: parseInt(process.env.RUNPOD_TIMEOUT ?? "300000", 10),
  });
}
