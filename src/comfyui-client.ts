import WebSocket from "ws";

export interface ComfyUIConfig {
  url: string;
  outputDir?: string;
  /** Generation timeout in milliseconds (default: 10 minutes) */
  timeout?: number;
}

/** Default timeout: 10 minutes. Override with COMFYUI_TIMEOUT env var (in seconds) */
const DEFAULT_TIMEOUT = parseInt(process.env.COMFYUI_TIMEOUT || "600", 10) * 1000;

export interface QueuePromptResponse {
  prompt_id: string;
  number: number;
}

export interface HistoryItem {
  prompt: any;
  outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>;
  status: { status_str: string; completed: boolean; messages: any[] };
}

export interface QueueStatus {
  queue_running: any[];
  queue_pending: any[];
}

export interface SystemStats {
  system: {
    os: string;
    python_version: string;
    embedded_python: boolean;
    comfyui_version?: string;
  };
  devices: Array<{
    name: string;
    type: string;
    index: number;
    vram_total: number;
    vram_free: number;
    torch_vram_total: number;
    torch_vram_free: number;
  }>;
}

// Minimal fetch options to avoid aiohttp's 8KB header limit
// Node.js fetch can sometimes include large default headers or proxy headers
const FETCH_OPTIONS: RequestInit = {
  credentials: "omit",  // Don't send cookies
  cache: "no-store",    // Don't cache
};

const GET_OPTIONS: RequestInit = {
  ...FETCH_OPTIONS,
  method: "GET",
  headers: {
    "Accept": "application/json",
  },
};

const POST_OPTIONS: RequestInit = {
  ...FETCH_OPTIONS,
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Accept": "application/json",
  },
};

export class ComfyUIClient {
  private baseUrl: string;
  private wsUrl: string;
  public outputDir: string;
  private timeout: number;

  constructor(config: ComfyUIConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.wsUrl = this.baseUrl.replace(/^http/, "ws");
    this.outputDir = config.outputDir || "/tmp/comfyui-output";
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  async queuePrompt(workflow: any, clientId?: string): Promise<QueuePromptResponse> {
    const body: any = { prompt: workflow };
    if (clientId) {
      body.client_id = clientId;
    }

    const response = await fetch(`${this.baseUrl}/prompt`, {
      ...POST_OPTIONS,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to queue prompt: ${response.status} ${text}`);
    }

    return response.json();
  }

  async getHistory(promptId: string): Promise<HistoryItem | null> {
    const response = await fetch(`${this.baseUrl}/history/${promptId}`, GET_OPTIONS);
    if (!response.ok) {
      throw new Error(`Failed to get history: ${response.status}`);
    }

    const data = await response.json();
    return data[promptId] || null;
  }

  async getObjectInfo(): Promise<Record<string, any>> {
    const response = await fetch(`${this.baseUrl}/object_info`, GET_OPTIONS);
    if (!response.ok) {
      throw new Error(`Failed to get object info: ${response.status}`);
    }
    return response.json();
  }

  async getQueueStatus(): Promise<QueueStatus> {
    const response = await fetch(`${this.baseUrl}/queue`, GET_OPTIONS);
    if (!response.ok) {
      throw new Error(`Failed to get queue: ${response.status}`);
    }
    return response.json();
  }

  async getSystemStats(): Promise<SystemStats> {
    const response = await fetch(`${this.baseUrl}/system_stats`, GET_OPTIONS);
    if (!response.ok) {
      throw new Error(`Failed to get system stats: ${response.status}`);
    }
    return response.json();
  }

  async getModels(): Promise<string[]> {
    const objectInfo = await this.getObjectInfo();
    const checkpointLoader = objectInfo["CheckpointLoaderSimple"];
    if (checkpointLoader?.input?.required?.ckpt_name?.[0]) {
      return checkpointLoader.input.required.ckpt_name[0];
    }
    return [];
  }

  async getSamplers(): Promise<string[]> {
    const objectInfo = await this.getObjectInfo();
    const kSampler = objectInfo["KSampler"];
    if (kSampler?.input?.required?.sampler_name?.[0]) {
      return kSampler.input.required.sampler_name[0];
    }
    return [];
  }

  async getSchedulers(): Promise<string[]> {
    const objectInfo = await this.getObjectInfo();
    const kSampler = objectInfo["KSampler"];
    if (kSampler?.input?.required?.scheduler?.[0]) {
      return kSampler.input.required.scheduler[0];
    }
    return [];
  }

  async waitForCompletion(
    promptId: string,
    onProgress?: (value: number, max: number) => void
  ): Promise<HistoryItem> {
    // Check immediately in case generation already completed (fast generations)
    const immediateCheck = await this.getHistory(promptId);
    if (immediateCheck?.status?.completed) {
      return immediateCheck;
    }

    const clientId = `mcp-${Date.now()}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.wsUrl}/ws?clientId=${clientId}`);
      let resolved = false;
      let pollInterval: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      };

      const handleCompletion = async () => {
        if (resolved) return;
        resolved = true;
        cleanup();

        // Small delay to ensure history is updated
        await new Promise((r) => setTimeout(r, 50));
        const history = await this.getHistory(promptId);
        if (history) {
          resolve(history);
        } else {
          reject(new Error("Failed to get history after completion"));
        }
      };

      // Start parallel polling alongside WebSocket (belt and suspenders)
      // Poll every 500ms to catch completion quickly even if WebSocket misses it
      pollInterval = setInterval(async () => {
        if (resolved) return;
        try {
          const history = await this.getHistory(promptId);
          if (history?.status?.completed) {
            await handleCompletion();
          }
        } catch {
          // Ignore poll errors, WebSocket is primary
        }
      }, 500);

      ws.on("open", () => {
        // WebSocket connected, now wait for messages
      });

      ws.on("message", async (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === "progress" && message.data.prompt_id === promptId) {
            onProgress?.(message.data.value, message.data.max);
          }

          if (message.type === "executing" && message.data.prompt_id === promptId) {
            if (message.data.node === null) {
              // Execution complete
              await handleCompletion();
            }
          }
        } catch {
          // Ignore parse errors for binary messages
        }
      });

      ws.on("error", (error) => {
        // Don't reject on WebSocket error - polling will continue
        console.error("WebSocket error (polling continues):", error.message);
      });

      ws.on("close", () => {
        // WebSocket closed but polling continues - no action needed
      });

      // Timeout (default 10 minutes, configurable via COMFYUI_TIMEOUT env var)
      const timeoutMinutes = Math.round(this.timeout / 60000);
      setTimeout(() => {
        if (!resolved) {
          cleanup();
          reject(new Error(`Generation timed out after ${timeoutMinutes} minutes`));
        }
      }, this.timeout);
    });
  }

  private async pollForCompletion(promptId: string, maxAttempts = 600): Promise<HistoryItem> {
    // Faster polling: 500ms intervals, 600 attempts = 5 minutes
    for (let i = 0; i < maxAttempts; i++) {
      const history = await this.getHistory(promptId);
      if (history?.status?.completed) {
        return history;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("Generation timed out");
  }

  async getImage(filename: string, subfolder: string, type: string): Promise<Buffer> {
    const params = new URLSearchParams({ filename, subfolder, type });
    const response = await fetch(`${this.baseUrl}/view?${params}`, {
      ...FETCH_OPTIONS,
      method: "GET",
    });
    if (!response.ok) {
      throw new Error(`Failed to get image: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async getAudio(filename: string, subfolder: string, type: string): Promise<Buffer> {
    const params = new URLSearchParams({ filename, subfolder, type });
    const response = await fetch(`${this.baseUrl}/view?${params}`, {
      ...FETCH_OPTIONS,
      method: "GET",
    });
    if (!response.ok) {
      throw new Error(`Failed to get audio: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async getVideo(filename: string, subfolder: string, type: string): Promise<Buffer> {
    const params = new URLSearchParams({ filename, subfolder, type });
    const response = await fetch(`${this.baseUrl}/view?${params}`, {
      ...FETCH_OPTIONS,
      method: "GET",
    });
    if (!response.ok) {
      throw new Error(`Failed to get video: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
