import { ComfyUIClient } from "../comfyui-client.js";

export interface QueueStatusResult {
  running: number;
  pending: number;
  details: {
    running: any[];
    pending: any[];
  };
}

export async function getQueueStatus(client: ComfyUIClient): Promise<QueueStatusResult> {
  const status = await client.getQueueStatus();

  return {
    running: status.queue_running.length,
    pending: status.queue_pending.length,
    details: {
      running: status.queue_running,
      pending: status.queue_pending,
    },
  };
}
