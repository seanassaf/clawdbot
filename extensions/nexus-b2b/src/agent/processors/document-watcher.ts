/**
 * Document Watcher - Background Service for Monitoring Connectors
 * Watches connected services for new documents and triggers processing
 */

import type { ClawdbotPluginApi } from "../../../../src/plugins/types.js";
import type { Connector, Document, ConnectorConfig, Task } from "../../types/index.js";
import { createConnector, type BaseConnector, type DiscoveredFile } from "../connectors/index.js";
import { TaskManager } from "./task-manager.js";
import { DocumentProcessor } from "../../dashboard/document-processor.js";
import { sleep } from "../../utils.js";

export type WatcherConfig = {
  enabled?: boolean;
  pollIntervalMs?: number;
  connectors?: ConnectorConfig[];
};

export type WatcherEvent =
  | { type: "started" }
  | { type: "stopped" }
  | { type: "connector_synced"; connectorId: string; filesFound: number }
  | { type: "document_processed"; document: Document }
  | { type: "error"; connectorId?: string; error: string };

export type WatcherEventHandler = (event: WatcherEvent) => void | Promise<void>;

export class DocumentWatcher {
  private api: ClawdbotPluginApi;
  private config: WatcherConfig;
  private connectors: Map<string, BaseConnector> = new Map();
  private lastSync: Map<string, Date> = new Map();
  private eventHandlers: WatcherEventHandler[] = [];
  private isRunning = false;
  private pollTimeout?: ReturnType<typeof setTimeout>;
  private taskManager: TaskManager;
  private documentProcessor: DocumentProcessor;

  constructor(
    api: ClawdbotPluginApi,
    config: WatcherConfig,
    taskManager: TaskManager,
    documentProcessor: DocumentProcessor,
  ) {
    this.api = api;
    this.config = {
      enabled: true,
      pollIntervalMs: 300000, // 5 minutes default
      ...config,
    };
    this.taskManager = taskManager;
    this.documentProcessor = documentProcessor;

    // Register task handlers
    this.taskManager.registerHandler("process_document", this.handleProcessDocument.bind(this));
    this.taskManager.registerHandler("sync_connector", this.handleSyncConnector.bind(this));
  }

  /**
   * Initialize connectors from config
   */
  async initialize(): Promise<void> {
    for (const connectorConfig of this.config.connectors ?? []) {
      if (!connectorConfig.enabled) continue;

      const connector = createConnector(connectorConfig);
      if (!connector) {
        await this.emit({ type: "error", error: `Unknown connector type: ${connectorConfig.type}` });
        continue;
      }

      try {
        await connector.connect();
        this.connectors.set(connector.getId(), connector);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await this.emit({ type: "error", connectorId: connector.getId(), error: errorMsg });
      }
    }
  }

  /**
   * Subscribe to watcher events
   */
  on(handler: WatcherEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  private async emit(event: WatcherEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (err) {
        console.error(`Watcher event handler error: ${err}`);
      }
    }
  }

  /**
   * Start the document watcher
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    await this.initialize();
    this.isRunning = true;
    this.taskManager.start();

    await this.emit({ type: "started" });
    this.poll();
  }

  /**
   * Stop the document watcher
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    this.taskManager.stop();

    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = undefined;
    }

    // Disconnect all connectors
    for (const connector of this.connectors.values()) {
      await connector.disconnect();
    }

    await this.emit({ type: "stopped" });
  }

  private poll(): void {
    if (!this.isRunning) return;

    this.checkConnectors();

    this.pollTimeout = setTimeout(
      () => this.poll(),
      this.config.pollIntervalMs ?? 300000,
    );
  }

  private async checkConnectors(): Promise<void> {
    for (const connector of this.connectors.values()) {
      if (connector.getStatus() !== "connected") continue;

      const config = connector.getInfo().config;
      if (!this.shouldSync(connector.getId(), config)) continue;

      // Queue a sync task
      await this.taskManager.queueTask("sync_connector", {
        connectorId: connector.getId(),
      });
    }
  }

  private shouldSync(connectorId: string, config: ConnectorConfig): boolean {
    const schedule = config.syncSchedule;
    if (!schedule?.enabled) return false;

    const lastSyncTime = this.lastSync.get(connectorId);
    if (!lastSyncTime) return true;

    const now = new Date();
    const intervalMs = this.getIntervalMs(schedule.interval ?? "hourly");

    return now.getTime() - lastSyncTime.getTime() >= intervalMs;
  }

  private getIntervalMs(interval: string): number {
    switch (interval) {
      case "realtime":
        return 60000; // 1 minute
      case "5min":
        return 300000;
      case "15min":
        return 900000;
      case "hourly":
        return 3600000;
      case "daily":
        return 86400000;
      default:
        return 3600000;
    }
  }

  private async handleSyncConnector(task: Task): Promise<{ success: boolean; data: unknown }> {
    const connectorId = task.params.connectorId as string;
    const connector = this.connectors.get(connectorId);

    if (!connector) {
      throw new Error(`Connector not found: ${connectorId}`);
    }

    const since = this.lastSync.get(connectorId);
    let filesFound = 0;

    for await (const file of connector.discoverFiles({ since })) {
      filesFound++;

      // Queue document processing task
      await this.taskManager.queueTask(
        "process_document",
        {
          connectorId,
          file,
        },
        { priority: 5 },
      );
    }

    this.lastSync.set(connectorId, new Date());

    await this.emit({
      type: "connector_synced",
      connectorId,
      filesFound,
    });

    return {
      success: true,
      data: { filesFound },
    };
  }

  private async handleProcessDocument(task: Task): Promise<{ success: boolean; data: unknown }> {
    const connectorId = task.params.connectorId as string;
    const file = task.params.file as DiscoveredFile;
    const connector = this.connectors.get(connectorId);

    if (!connector) {
      throw new Error(`Connector not found: ${connectorId}`);
    }

    // Download file content
    const buffer = await connector.downloadFile(file.externalId);

    // Process with document processor
    const result = await this.documentProcessor.processBuffer(
      buffer,
      file.name,
      {
        type: "connector",
        connectorId,
        externalId: file.externalId,
      },
      file.mimeType,
    );

    if (result.error) {
      throw new Error(result.error);
    }

    await this.emit({
      type: "document_processed",
      document: result.document,
    });

    return {
      success: true,
      data: {
        documentId: result.document.id,
        analysis: result.analysis,
      },
    };
  }

  /**
   * Add a connector at runtime
   */
  async addConnector(config: ConnectorConfig): Promise<BaseConnector | null> {
    const connector = createConnector(config);
    if (!connector) return null;

    try {
      await connector.connect();
      this.connectors.set(connector.getId(), connector);
      return connector;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.emit({ type: "error", connectorId: connector.getId(), error: errorMsg });
      return null;
    }
  }

  /**
   * Remove a connector
   */
  async removeConnector(connectorId: string): Promise<boolean> {
    const connector = this.connectors.get(connectorId);
    if (!connector) return false;

    await connector.disconnect();
    this.connectors.delete(connectorId);
    this.lastSync.delete(connectorId);
    return true;
  }

  /**
   * Get all connectors
   */
  getConnectors(): Connector[] {
    return Array.from(this.connectors.values()).map((c) => c.getInfo());
  }

  /**
   * Trigger an immediate sync for a connector
   */
  async triggerSync(connectorId: string): Promise<Task> {
    return this.taskManager.queueTask(
      "sync_connector",
      { connectorId },
      { priority: 10 }, // High priority
    );
  }

  /**
   * Get watcher status
   */
  getStatus(): {
    running: boolean;
    connectors: number;
    tasksQueued: number;
    tasksRunning: number;
  } {
    const taskStats = this.taskManager.getStats();
    return {
      running: this.isRunning,
      connectors: this.connectors.size,
      tasksQueued: taskStats.queued,
      tasksRunning: taskStats.running,
    };
  }
}

export function createDocumentWatcher(
  api: ClawdbotPluginApi,
  config: WatcherConfig,
  taskManager: TaskManager,
  documentProcessor: DocumentProcessor,
): DocumentWatcher {
  return new DocumentWatcher(api, config, taskManager, documentProcessor);
}
