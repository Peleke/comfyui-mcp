/**
 * Simple In-Memory Job Queue
 *
 * A lightweight job queue for async task processing.
 * Works well with persistent containers (Fly.io) without external dependencies.
 *
 * For production at scale, swap for Quirrel or BullMQ.
 */

import { randomUUID } from "crypto";
import { EventEmitter } from "events";

// ============================================================================
// Types
// ============================================================================

export type JobStatus = "pending" | "processing" | "complete" | "failed";

export interface Job<T = unknown, R = unknown> {
  id: string;
  payload: T;
  status: JobStatus;
  result?: R;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  retries: number;
  maxRetries: number;
}

export interface JobResult<R = unknown> {
  status: "complete" | "failed";
  result?: R;
  error?: string;
}

export interface QueueOptions {
  /** Max concurrent jobs (default: 2) */
  concurrency?: number;
  /** Max retries on failure (default: 3) */
  maxRetries?: number;
  /** Job timeout in ms (default: 5 min) */
  timeout?: number;
}

// ============================================================================
// Simple Queue Implementation
// ============================================================================

export class SimpleQueue<T, R> extends EventEmitter {
  private jobs: Map<string, Job<T, R>> = new Map();
  private queue: string[] = [];
  private processing: Set<string> = new Set();
  private concurrency: number;
  private maxRetries: number;
  private timeout: number;
  private handler: (payload: T) => Promise<R>;
  private name: string;

  constructor(
    name: string,
    handler: (payload: T) => Promise<R>,
    options: QueueOptions = {}
  ) {
    super();
    this.name = name;
    this.handler = handler;
    this.concurrency = options.concurrency ?? 2;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeout = options.timeout ?? 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Add a job to the queue.
   * Returns the job ID for tracking.
   */
  async enqueue(payload: T): Promise<{ id: string }> {
    const id = randomUUID();
    const job: Job<T, R> = {
      id,
      payload,
      status: "pending",
      createdAt: new Date(),
      retries: 0,
      maxRetries: this.maxRetries,
    };

    this.jobs.set(id, job);
    this.queue.push(id);

    console.log(`[${this.name}] Job enqueued: ${id}`);

    // Process queue (non-blocking)
    setImmediate(() => this.processQueue());

    return { id };
  }

  /**
   * Get job by ID.
   */
  getJob(id: string): Job<T, R> | undefined {
    return this.jobs.get(id);
  }

  /**
   * Get job status by ID.
   */
  getStatus(id: string): JobStatus | undefined {
    return this.jobs.get(id)?.status;
  }

  /**
   * Get all jobs (for debugging).
   */
  getAllJobs(): Job<T, R>[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Process pending jobs up to concurrency limit.
   */
  private async processQueue(): Promise<void> {
    while (
      this.queue.length > 0 &&
      this.processing.size < this.concurrency
    ) {
      const jobId = this.queue.shift();
      if (!jobId) continue;

      const job = this.jobs.get(jobId);
      if (!job || job.status !== "pending") continue;

      this.processing.add(jobId);
      this.processJob(job).finally(() => {
        this.processing.delete(jobId);
        // Continue processing queue
        setImmediate(() => this.processQueue());
      });
    }
  }

  /**
   * Process a single job.
   */
  private async processJob(job: Job<T, R>): Promise<void> {
    job.status = "processing";
    job.startedAt = new Date();
    console.log(`[${this.name}] Processing job: ${job.id}`);

    try {
      // Wrap handler with timeout
      const result = await Promise.race([
        this.handler(job.payload),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Job timeout")), this.timeout)
        ),
      ]);

      job.status = "complete";
      job.result = result;
      job.completedAt = new Date();

      console.log(`[${this.name}] Job complete: ${job.id}`);
      this.emit("complete", job);
    } catch (err) {
      job.retries++;
      job.error = err instanceof Error ? err.message : "Unknown error";

      if (job.retries < job.maxRetries) {
        // Re-queue for retry
        job.status = "pending";
        this.queue.push(job.id);
        console.log(`[${this.name}] Job ${job.id} failed, retrying (${job.retries}/${job.maxRetries})`);
      } else {
        job.status = "failed";
        job.completedAt = new Date();
        console.error(`[${this.name}] Job ${job.id} failed permanently:`, job.error);
        this.emit("failed", job);
      }
    }
  }

  /**
   * Clear completed/failed jobs older than maxAge (default: 1 hour).
   */
  cleanup(maxAgeMs: number = 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [id, job] of this.jobs.entries()) {
      if (
        (job.status === "complete" || job.status === "failed") &&
        job.completedAt &&
        job.completedAt.getTime() < cutoff
      ) {
        this.jobs.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`[${this.name}] Cleaned up ${removed} old jobs`);
    }

    return removed;
  }
}

// ============================================================================
// Queue Registry
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queues: Map<string, SimpleQueue<any, any>> = new Map();

/**
 * Get or create a queue by name.
 */
export function getQueue<T, R>(
  name: string,
  handler?: (payload: T) => Promise<R>,
  options?: QueueOptions
): SimpleQueue<T, R> {
  let queue = queues.get(name);

  if (!queue && handler) {
    queue = new SimpleQueue(name, handler, options);
    queues.set(name, queue);
  }

  if (!queue) {
    throw new Error(`Queue "${name}" not found and no handler provided`);
  }

  return queue as SimpleQueue<T, R>;
}

/**
 * Start periodic cleanup of old jobs.
 */
export function startQueueCleanup(intervalMs: number = 15 * 60 * 1000): void {
  setInterval(() => {
    for (const queue of queues.values()) {
      queue.cleanup();
    }
  }, intervalMs);
}
