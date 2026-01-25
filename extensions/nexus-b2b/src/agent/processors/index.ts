/**
 * Processors Index
 * Background task processing and document watching
 */

export { TaskManager, createTaskManager, type TaskManagerConfig, type TaskHandler, type TaskEvent, type TaskEventHandler } from "./task-manager.js";
export { DocumentWatcher, createDocumentWatcher, type WatcherConfig, type WatcherEvent, type WatcherEventHandler } from "./document-watcher.js";
