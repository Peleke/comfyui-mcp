import WebSocket from "ws";

export interface ComfyUIConfig {
  url: string;
  outputDir?: string;
}

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

  constructor(config: ComfyUIConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.wsUrl = this.baseUrl.replace(/^http/, "ws");
    this.outputDir = config.outputDir || "/tmp/comfyui-output";
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
    const clientId = `mcp-${Date.now()}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.wsUrl}/ws?clientId=${clientId}`);
      let resolved = false;

      const cleanup = () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      };

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
              resolved = true;
              cleanup();

              // Small delay to ensure history is updated
              await new Promise((r) => setTimeout(r, 100));
              const history = await this.getHistory(promptId);
              if (history) {
                resolve(history);
              } else {
                reject(new Error("Failed to get history after completion"));
              }
            }
          }
        } catch (e) {
          // Ignore parse errors for binary messages
        }
      });

      ws.on("error", (error) => {
        if (!resolved) {
          cleanup();
          reject(error);
        }
      });

      ws.on("close", () => {
        if (!resolved) {
          // Fallback: poll for completion
          this.pollForCompletion(promptId)
            .then(resolve)
            .catch(reject);
        }
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (!resolved) {
          cleanup();
          reject(new Error("Generation timed out after 5 minutes"));
        }
      }, 5 * 60 * 1000);
    });
  }

  private async pollForCompletion(promptId: string, maxAttempts = 300): Promise<HistoryItem> {
    for (let i = 0; i < maxAttempts; i++) {
      const history = await this.getHistory(promptId);
      if (history?.status?.completed) {
        return history;
      }
      await new Promise((r) => setTimeout(r, 1000));
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
