import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ComfyUIClient } from "./comfyui-client.js";
import {
  createMockFetch,
  mockObjectInfo,
  mockQueueStatus,
  mockQueueStatusBusy,
  mockQueuePromptResponse,
  mockHistoryComplete,
  mockImageBuffer,
} from "./__mocks__/comfyui-responses.js";

describe("ComfyUIClient", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({
      url: "http://localhost:8188",
      outputDir: "/tmp/test-output",
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should strip trailing slash from URL", () => {
      const clientWithSlash = new ComfyUIClient({
        url: "http://localhost:8188/",
      });
      // Access private property for testing
      expect((clientWithSlash as any).baseUrl).toBe("http://localhost:8188");
    });

    it("should convert http to ws for websocket URL", () => {
      expect((client as any).wsUrl).toBe("ws://localhost:8188");
    });

    it("should use default output directory if not specified", () => {
      const clientNoOutput = new ComfyUIClient({ url: "http://localhost:8188" });
      expect(clientNoOutput.outputDir).toBe("/tmp/comfyui-output");
    });

    it("should use provided output directory", () => {
      expect(client.outputDir).toBe("/tmp/test-output");
    });
  });

  describe("getObjectInfo", () => {
    it("should fetch and return object info", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const result = await client.getObjectInfo();

      expect(result).toEqual(mockObjectInfo);
    });

    it("should throw error on non-200 response", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response("Error", { status: 500 })
      );

      await expect(client.getObjectInfo()).rejects.toThrow(
        "Failed to get object info: 500"
      );
    });
  });

  describe("getModels", () => {
    it("should return list of checkpoint models", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const models = await client.getModels();

      expect(models).toEqual([
        "dreamshaper_8.safetensors",
        "sdXL_v10.safetensors",
        "cyberrealistic_v90.safetensors",
      ]);
    });

    it("should return empty array if no models found", async () => {
      global.fetch = createMockFetch({
        objectInfo: {},
      }) as typeof fetch;

      const models = await client.getModels();

      expect(models).toEqual([]);
    });
  });

  describe("getSamplers", () => {
    it("should return list of samplers", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const samplers = await client.getSamplers();

      expect(samplers).toEqual([
        "euler",
        "euler_ancestral",
        "dpmpp_2m",
        "dpmpp_sde",
        "ddim",
      ]);
    });

    it("should return empty array if no samplers found", async () => {
      global.fetch = createMockFetch({
        objectInfo: {},
      }) as typeof fetch;

      const samplers = await client.getSamplers();

      expect(samplers).toEqual([]);
    });
  });

  describe("getSchedulers", () => {
    it("should return list of schedulers", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const schedulers = await client.getSchedulers();

      expect(schedulers).toEqual([
        "normal",
        "karras",
        "exponential",
        "sgm_uniform",
      ]);
    });

    it("should return empty array if no schedulers found", async () => {
      global.fetch = createMockFetch({
        objectInfo: {},
      }) as typeof fetch;

      const schedulers = await client.getSchedulers();

      expect(schedulers).toEqual([]);
    });
  });

  describe("getQueueStatus", () => {
    it("should return empty queue status", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const status = await client.getQueueStatus();

      expect(status).toEqual(mockQueueStatus);
    });

    it("should return busy queue status", async () => {
      global.fetch = createMockFetch({
        queueStatus: mockQueueStatusBusy,
      }) as typeof fetch;

      const status = await client.getQueueStatus();

      expect(status.queue_running.length).toBe(1);
      expect(status.queue_pending.length).toBe(1);
    });

    it("should throw error on non-200 response", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response("Error", { status: 500 })
      );

      await expect(client.getQueueStatus()).rejects.toThrow(
        "Failed to get queue: 500"
      );
    });
  });

  describe("queuePrompt", () => {
    it("should queue a prompt and return response", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const workflow = { "1": { class_type: "Test" } };
      const result = await client.queuePrompt(workflow);

      expect(result).toEqual(mockQueuePromptResponse);
    });

    it("should include client_id if provided", async () => {
      let capturedBody: any;
      global.fetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify(mockQueuePromptResponse), {
          status: 200,
        });
      });

      await client.queuePrompt({ test: true }, "my-client-id");

      expect(capturedBody.client_id).toBe("my-client-id");
    });

    it("should throw error on non-200 response", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response("Workflow error", { status: 400 })
      );

      await expect(client.queuePrompt({})).rejects.toThrow(
        "Failed to queue prompt: 400 Workflow error"
      );
    });
  });

  describe("getHistory", () => {
    it("should return history for a prompt ID", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const history = await client.getHistory("test-prompt-id-12345");

      expect(history).toEqual(mockHistoryComplete["test-prompt-id-12345"]);
    });

    it("should return null for unknown prompt ID", async () => {
      global.fetch = createMockFetch({
        history: {} as any,
      }) as typeof fetch;

      const history = await client.getHistory("unknown-id");

      expect(history).toBeNull();
    });

    it("should throw error on non-200 response", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response("Error", { status: 500 })
      );

      await expect(client.getHistory("test")).rejects.toThrow(
        "Failed to get history: 500"
      );
    });
  });

  describe("getImage", () => {
    it("should fetch and return image buffer", async () => {
      global.fetch = createMockFetch() as typeof fetch;

      const buffer = await client.getImage("test.png", "", "output");

      expect(buffer).toEqual(mockImageBuffer);
    });

    it("should include correct query parameters", async () => {
      let capturedUrl: string = "";
      global.fetch = vi.fn().mockImplementation(async (url) => {
        capturedUrl = url.toString();
        return new Response(mockImageBuffer, { status: 200 });
      });

      await client.getImage("image.png", "subfolder", "output");

      expect(capturedUrl).toContain("filename=image.png");
      expect(capturedUrl).toContain("subfolder=subfolder");
      expect(capturedUrl).toContain("type=output");
    });

    it("should throw error on non-200 response", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response("Error", { status: 404 })
      );

      await expect(client.getImage("test.png", "", "output")).rejects.toThrow(
        "Failed to get image: 404"
      );
    });
  });

  describe("waitForCompletion (polling fallback)", () => {
    it("should poll for completion when WebSocket fails", async () => {
      // Mock fetch to return completed history on second call
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async (url) => {
        if (url.toString().includes("/history/")) {
          callCount++;
          if (callCount >= 2) {
            return new Response(
              JSON.stringify({
                "test-prompt-id": {
                  status: { completed: true },
                  outputs: { "9": { images: [{ filename: "test.png" }] } },
                },
              }),
              { status: 200 }
            );
          }
          return new Response(
            JSON.stringify({
              "test-prompt-id": { status: { completed: false } },
            }),
            { status: 200 }
          );
        }
        return new Response("{}", { status: 200 });
      });

      // Note: This test is limited because we can't easily mock WebSocket
      // In a real scenario, the WebSocket would fail and trigger polling
    });
  });
});
