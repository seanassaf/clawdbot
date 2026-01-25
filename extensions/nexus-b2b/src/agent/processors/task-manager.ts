/**
 * Task Manager - Background Task Processing System
 * Manages queued tasks, scheduling, and execution
 */

import type { Task, TaskType, TaskStatus, TaskResult } from "../../types/index.js";
import { generateId, sleep, retryWithBackoff } from "../../utils.js";

export type TaskHandler = (task: Task) => Promise<TaskResult>;

export type TaskManagerConfig = {
  maxConcurrentTasks?: number;
  taskRetryDelayMs?: number;
  maxRetries?: number;
  pollIntervalMs?: number;
};

export type TaskEvent =
  | { type: "task_queued"; task: Task }
  | { type: "task_started"; task: Task }
  | { type: "task_completed"; task: Task; result: TaskResult }
  | { type: "task_failed"; task: Task; error: string }
  | { type: "task_cancelled"; task: Task };

export type TaskEventHandler = (event: TaskEvent) => void | Promise<void>;

export class TaskManager {
  private config: TaskManagerConfig;
  private queue: Task[] = [];
  private running: Map<string, Task> = new Map();
  private handlers: Map<TaskType, TaskHandler> = new Map();
  private eventHandlers: TaskEventHandler[] = [];
  private isRunning = false;
  private pollTimeout?: ReturnType<typeof setTimeout>;

  constructor(config: TaskManagerConfig = {}) {
    this.config = {
      maxConcurrentTasks: 3,
      taskRetryDelayMs: 5000,
      maxRetries: 3,
      pollIntervalMs: 1000,
      ...config,
    };
  }

  /**
   * Register a handler for a task type
   */
  registerHandler(type: TaskType, handler: TaskHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Subscribe to task events
   */
  on(handler: TaskEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  private async emit(event: TaskEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (err) {
        console.error(`Task event handler error: ${err}`);
      }
    }
  }

  /**
   * Queue a new task
   */
  async queueTask(
    type: TaskType,
    params: Record<string, unknown>,
    options?: {
      priority?: number;
      maxRetries?: number;
    },
  ): Promise<Task> {
    const task: Task = {
      id: generateId("task"),
      type,
      status: "queued",
      priority: options?.priority ?? 5,
      createdAt: new Date().toISOString(),
      params,
      retryCount: 0,
      maxRetries: options?.maxRetries ?? this.config.maxRetries ?? 3,
    };

    // Insert by priority (higher priority first)
    const insertIndex = this.queue.findIndex((t) => t.priority < task.priority);
    if (insertIndex >= 0) {
      this.queue.splice(insertIndex, 0, task);
    } else {
      this.queue.push(task);
    }

    await this.emit({ type: "task_queued", task });
    return task;
  }

  /**
   * Get a task by ID
   */
  getTask(id: string): Task | undefined {
    const queued = this.queue.find((t) => t.id === id);
    if (queued) return queued;
    return this.running.get(id);
  }

  /**
   * Cancel a task
   */
  async cancelTask(id: string): Promise<boolean> {
    const queueIndex = this.queue.findIndex((t) => t.id === id);
    if (queueIndex >= 0) {
      const task = this.queue.splice(queueIndex, 1)[0]!;
      task.status = "cancelled";
      await this.emit({ type: "task_cancelled", task });
      return true;
    }

    const running = this.running.get(id);
    if (running) {
      running.status = "cancelled";
      await this.emit({ type: "task_cancelled", task: running });
      return true;
    }

    return false;
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    queued: number;
    running: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
  } {
    const allTasks = [...this.queue, ...this.running.values()];
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    for (const task of allTasks) {
      byType[task.type] = (byType[task.type] ?? 0) + 1;
      byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
    }

    return {
      queued: this.queue.length,
      running: this.running.size,
      byType,
      byStatus,
    };
  }

  /**
   * Start the task processor
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.poll();
  }

  /**
   * Stop the task processor
   */
  stop(): void {
    this.isRunning = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = undefined;
    }
  }

  private poll(): void {
    if (!this.isRunning) return;

    this.processQueue();

    this.pollTimeout = setTimeout(
      () => this.poll(),
      this.config.pollIntervalMs ?? 1000,
    );
  }

  private async processQueue(): Promise<void> {
    const maxConcurrent = this.config.maxConcurrentTasks ?? 3;

    while (this.running.size < maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;

      const handler = this.handlers.get(task.type);
      if (!handler) {
        task.status = "failed";
        task.error = `No handler registered for task type: ${task.type}`;
        await this.emit({ type: "task_failed", task, error: task.error });
        continue;
      }

      this.executeTask(task, handler);
    }
  }

  private async executeTask(task: Task, handler: TaskHandler): Promise<void> {
    task.status = "running";
    task.startedAt = new Date().toISOString();
    this.running.set(task.id, task);

    await this.emit({ type: "task_started", task });

    try {
      const result = await retryWithBackoff(
        async () => {
          if (task.status === "cancelled") {
            throw new Error("Task cancelled");
          }
          return handler(task);
        },
        {
          maxRetries: 0, // We handle retries at the task level
          initialDelayMs: this.config.taskRetryDelayMs ?? 5000,
        },
      );

      task.status = "completed";
      task.completedAt = new Date().toISOString();
      task.result = result;

      await this.emit({ type: "task_completed", task, result });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (task.retryCount < task.maxRetries && task.status !== "cancelled") {
        task.retryCount++;
        task.status = "queued";
        task.error = errorMsg;
        this.queue.unshift(task); // Add back to front of queue
      } else {
        task.status = "failed";
        task.completedAt = new Date().toISOString();
        task.error = errorMsg;
        await this.emit({ type: "task_failed", task, error: errorMsg });
      }
    } finally {
      this.running.delete(task.id);
    }
  }

  /**
   * Process all queued tasks and wait for completion
   */
  async drain(): Promise<void> {
    while (this.queue.length > 0 || this.running.size > 0) {
      await sleep(100);
    }
  }
}

export function createTaskManager(config?: TaskManagerConfig): TaskManager {
  return new TaskManager(config);
}
