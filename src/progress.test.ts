import { describe, it, expect, vi } from "vitest";
import {
  createProgressEmitter,
  wrapComfyUIProgress,
  generateTaskId,
  ProgressEvent,
  ProgressCallback,
  GenerationStage,
} from "./progress.js";

describe("Progress Module", () => {
  describe("generateTaskId", () => {
    it("generates unique task IDs", () => {
      const id1 = generateTaskId();
      const id2 = generateTaskId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^task_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^task_\d+_[a-z0-9]+$/);
    });

    it("includes timestamp in task ID", () => {
      const before = Date.now();
      const id = generateTaskId();
      const after = Date.now();

      const timestampPart = parseInt(id.split("_")[1], 10);
      expect(timestampPart).toBeGreaterThanOrEqual(before);
      expect(timestampPart).toBeLessThanOrEqual(after);
    });
  });

  describe("createProgressEmitter", () => {
    it("returns no-op function when no callback provided", () => {
      const emit = createProgressEmitter("task_123");

      // Should not throw
      expect(() => emit("generating", 50, "Half done")).not.toThrow();
    });

    it("calls callback with correct ProgressEvent structure", () => {
      const callback = vi.fn<[ProgressEvent], void>();
      const emit = createProgressEmitter("task_123", callback);

      emit("generating", 50, "Half done");

      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0][0];
      expect(event.taskId).toBe("task_123");
      expect(event.stage).toBe("generating");
      expect(event.progress).toBe(50);
      expect(event.message).toBe("Half done");
      expect(event.timestamp).toBeGreaterThan(0);
    });

    it("includes extra fields when provided", () => {
      const callback = vi.fn<[ProgressEvent], void>();
      const emit = createProgressEmitter("task_123", callback);

      emit("generating", 50, "Step 10/20", {
        step: 10,
        totalSteps: 20,
        currentNode: "KSampler",
      });

      const event = callback.mock.calls[0][0];
      expect(event.step).toBe(10);
      expect(event.totalSteps).toBe(20);
      expect(event.currentNode).toBe("KSampler");
    });

    it("emits events in sequence", () => {
      const events: ProgressEvent[] = [];
      const callback = (e: ProgressEvent) => events.push(e);
      const emit = createProgressEmitter("task_123", callback);

      emit("queued", 0, "Queued");
      emit("starting", 5, "Starting");
      emit("generating", 50, "Generating");
      emit("complete", 100, "Done");

      expect(events).toHaveLength(4);
      expect(events.map((e) => e.stage)).toEqual([
        "queued",
        "starting",
        "generating",
        "complete",
      ]);
      expect(events.map((e) => e.progress)).toEqual([0, 5, 50, 100]);
    });
  });

  describe("wrapComfyUIProgress", () => {
    it("converts ComfyUI progress to ProgressEvent", () => {
      const callback = vi.fn<[ProgressEvent], void>();
      const emit = createProgressEmitter("task_123", callback);
      const comfyCallback = wrapComfyUIProgress(emit);

      // Simulate ComfyUI progress: step 5 of 20
      comfyCallback(5, 20);

      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0][0];
      expect(event.stage).toBe("generating");
      expect(event.progress).toBe(25); // 5/20 = 25%
      expect(event.step).toBe(5);
      expect(event.totalSteps).toBe(20);
    });

    it("calculates percentage correctly", () => {
      const events: ProgressEvent[] = [];
      const callback = (e: ProgressEvent) => events.push(e);
      const emit = createProgressEmitter("task_123", callback);
      const comfyCallback = wrapComfyUIProgress(emit);

      comfyCallback(0, 100);
      comfyCallback(50, 100);
      comfyCallback(100, 100);

      expect(events.map((e) => e.progress)).toEqual([0, 50, 100]);
    });

    it("handles edge case of max=0", () => {
      const callback = vi.fn<[ProgressEvent], void>();
      const emit = createProgressEmitter("task_123", callback);
      const comfyCallback = wrapComfyUIProgress(emit);

      comfyCallback(5, 0);

      const event = callback.mock.calls[0][0];
      expect(event.progress).toBe(0); // Should handle gracefully
    });

    it("rounds progress to whole numbers", () => {
      const callback = vi.fn<[ProgressEvent], void>();
      const emit = createProgressEmitter("task_123", callback);
      const comfyCallback = wrapComfyUIProgress(emit);

      comfyCallback(1, 3); // 33.33...%

      const event = callback.mock.calls[0][0];
      expect(event.progress).toBe(33); // Rounded
    });
  });

  describe("Type exports", () => {
    it("GenerationStage includes all expected stages", () => {
      const stages: GenerationStage[] = [
        "queued",
        "starting",
        "loading_model",
        "generating",
        "post_processing",
        "uploading",
        "complete",
        "error",
      ];

      // This is a compile-time check - if any stage is wrong, TypeScript will error
      expect(stages).toHaveLength(8);
    });
  });

  describe("Integration patterns", () => {
    it("supports pub/sub forwarding pattern", () => {
      // Simulate a pub/sub forwarder
      const pubSubMessages: Array<{ topic: string; payload: any }> = [];
      const pubSub = {
        publish: (topic: string, payload: any) => {
          pubSubMessages.push({ topic, payload });
        },
      };

      // Wire progress to pub/sub
      const forwardToMQ: ProgressCallback = (event) => {
        pubSub.publish(`generation.${event.taskId}`, event);
      };

      const emit = createProgressEmitter("task_123", forwardToMQ);

      emit("queued", 0, "Queued");
      emit("generating", 50, "Half done");
      emit("complete", 100, "Done");

      expect(pubSubMessages).toHaveLength(3);
      expect(pubSubMessages[0].topic).toBe("generation.task_123");
      expect(pubSubMessages[2].payload.stage).toBe("complete");
    });

    it("supports MCP notification forwarding pattern", () => {
      // Simulate MCP notification
      const notifications: Array<{ method: string; params: any }> = [];
      const mcpServer = {
        notification: (data: { method: string; params: any }) => {
          notifications.push(data);
        },
      };

      // Wire progress to MCP notifications
      const forwardToMCP: ProgressCallback = (event) => {
        mcpServer.notification({
          method: "notifications/progress",
          params: {
            progressToken: event.taskId,
            progress: event.progress,
            total: 100,
            message: event.message,
          },
        });
      };

      const emit = createProgressEmitter("task_123", forwardToMCP);

      emit("generating", 50, "Half done");

      expect(notifications).toHaveLength(1);
      expect(notifications[0].method).toBe("notifications/progress");
      expect(notifications[0].params.progressToken).toBe("task_123");
      expect(notifications[0].params.progress).toBe(50);
    });

    it("supports WebSocket forwarding pattern", () => {
      // Simulate WebSocket connection
      const sentMessages: string[] = [];
      const ws = {
        send: (data: string) => sentMessages.push(data),
      };

      // Wire progress to WebSocket
      const forwardToWS: ProgressCallback = (event) => {
        ws.send(JSON.stringify({
          type: "progress",
          ...event,
        }));
      };

      const emit = createProgressEmitter("task_123", forwardToWS);

      emit("generating", 50, "Half done");

      expect(sentMessages).toHaveLength(1);
      const parsed = JSON.parse(sentMessages[0]);
      expect(parsed.type).toBe("progress");
      expect(parsed.taskId).toBe("task_123");
    });
  });
});
