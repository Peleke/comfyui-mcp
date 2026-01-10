import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getQueueStatus } from "./queue-status.js";
import { ComfyUIClient } from "../comfyui-client.js";
import {
  createMockFetch,
  mockQueueStatus,
  mockQueueStatusBusy,
} from "../__mocks__/comfyui-responses.js";

describe("getQueueStatus", () => {
  let client: ComfyUIClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    client = new ComfyUIClient({ url: "http://localhost:8188" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("should return empty queue status", async () => {
    global.fetch = createMockFetch() as typeof fetch;

    const status = await getQueueStatus(client);

    expect(status.running).toBe(0);
    expect(status.pending).toBe(0);
    expect(status.details.running).toEqual([]);
    expect(status.details.pending).toEqual([]);
  });

  it("should return busy queue status", async () => {
    global.fetch = createMockFetch({
      queueStatus: mockQueueStatusBusy,
    }) as typeof fetch;

    const status = await getQueueStatus(client);

    expect(status.running).toBe(1);
    expect(status.pending).toBe(1);
    expect(status.details.running).toHaveLength(1);
    expect(status.details.pending).toHaveLength(1);
  });

  it("should include queue details", async () => {
    global.fetch = createMockFetch({
      queueStatus: mockQueueStatusBusy,
    }) as typeof fetch;

    const status = await getQueueStatus(client);

    expect(status.details).toBeDefined();
    expect(status.details.running).toEqual(mockQueueStatusBusy.queue_running);
    expect(status.details.pending).toEqual(mockQueueStatusBusy.queue_pending);
  });
});
