/**
 * Progress tracking for long-running generation tasks.
 *
 * Designed to be easily wired to:
 * - MCP notifications/progress
 * - WebSocket pub/sub
 * - Server-Sent Events
 * - Any callback-based system
 */

export type GenerationStage =
  | "queued"
  | "starting"
  | "loading_model"
  | "generating"
  | "post_processing"
  | "uploading"
  | "complete"
  | "error";

export interface ProgressEvent {
  /** Unique identifier for this generation task */
  taskId: string;

  /** Current stage of generation */
  stage: GenerationStage;

  /** Progress within current stage (0-100) */
  progress: number;

  /** Human-readable status message */
  message: string;

  /** Timestamp of this event */
  timestamp: number;

  /** Optional: current step / total steps from ComfyUI */
  step?: number;
  totalSteps?: number;

  /** Optional: which node is currently executing */
  currentNode?: string;

  /** Optional: estimated time remaining in ms */
  estimatedRemainingMs?: number;
}

/**
 * Callback type for progress updates.
 * Wire this to your notification system of choice.
 */
export type ProgressCallback = (event: ProgressEvent) => void;

/**
 * Options for generation tools that support progress tracking.
 */
export interface ProgressOptions {
  /** Callback invoked on each progress update */
  onProgress?: ProgressCallback;

  /** Task ID for tracking (auto-generated if not provided) */
  taskId?: string;
}

/**
 * Helper to create a progress emitter for a task.
 * Wraps the callback with consistent taskId and timestamp handling.
 */
export function createProgressEmitter(
  taskId: string,
  onProgress?: ProgressCallback
): (stage: GenerationStage, progress: number, message: string, extra?: Partial<ProgressEvent>) => void {
  if (!onProgress) {
    return () => {}; // No-op if no callback provided
  }

  return (stage, progress, message, extra = {}) => {
    onProgress({
      taskId,
      stage,
      progress,
      message,
      timestamp: Date.now(),
      ...extra,
    });
  };
}

/**
 * Wraps ComfyUI's raw progress callback to emit typed ProgressEvents.
 */
export function wrapComfyUIProgress(
  emit: ReturnType<typeof createProgressEmitter>
): (value: number, max: number) => void {
  return (value: number, max: number) => {
    const progress = max > 0 ? Math.round((value / max) * 100) : 0;
    emit("generating", progress, `Step ${value}/${max}`, {
      step: value,
      totalSteps: max,
    });
  };
}

/**
 * Generate a unique task ID.
 */
export function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
