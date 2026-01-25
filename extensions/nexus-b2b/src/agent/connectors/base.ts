/**
 * Base Connector Interface and Abstract Implementation
 * Defines the contract for all external tool connectors
 */

import type {
  Connector,
  ConnectorConfig,
  ConnectorStatus,
  ConnectorStats,
  ConnectorCredentials,
  Document,
  DocumentSource,
} from "../../types/index.js";
import { generateId } from "../../utils.js";

/**
 * File discovered by a connector
 */
export type DiscoveredFile = {
  externalId: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
  path?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Sync result from a connector
 */
export type SyncResult = {
  success: boolean;
  filesDiscovered: number;
  filesProcessed: number;
  errors: string[];
  duration: number;
};

/**
 * Events emitted by connectors
 */
export type ConnectorEvent =
  | { type: "file_discovered"; file: DiscoveredFile }
  | { type: "file_processed"; file: DiscoveredFile; document: Document }
  | { type: "sync_started" }
  | { type: "sync_completed"; result: SyncResult }
  | { type: "error"; error: string };

export type ConnectorEventHandler = (event: ConnectorEvent) => void | Promise<void>;

/**
 * Abstract base class for all connectors
 */
export abstract class BaseConnector {
  protected config: ConnectorConfig;
  protected status: ConnectorStatus = "disconnected";
  protected lastError?: string;
  protected stats: ConnectorStats = {
    documentsProcessed: 0,
    errorCount: 0,
    avgProcessingTimeMs: 0,
  };
  protected eventHandlers: ConnectorEventHandler[] = [];

  constructor(config: ConnectorConfig) {
    this.config = config;
  }

  /**
   * Get the connector ID
   */
  getId(): string {
    return this.config.id;
  }

  /**
   * Get connector type
   */
  getType(): string {
    return this.config.type;
  }

  /**
   * Get current status
   */
  getStatus(): ConnectorStatus {
    return this.status;
  }

  /**
   * Get connector info
   */
  getInfo(): Connector {
    return {
      id: this.config.id,
      config: this.config,
      status: this.status,
      lastError: this.lastError,
      stats: this.stats,
    };
  }

  /**
   * Subscribe to connector events
   */
  on(handler: ConnectorEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  /**
   * Emit an event to all handlers
   */
  protected async emit(event: ConnectorEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (err) {
        console.error(`Connector event handler error: ${err}`);
      }
    }
  }

  /**
   * Update connector status
   */
  protected setStatus(status: ConnectorStatus, error?: string): void {
    this.status = status;
    this.lastError = error;
    if (error) this.stats.errorCount++;
  }

  /**
   * Create a document source for this connector
   */
  protected createDocumentSource(externalId: string): DocumentSource {
    return {
      type: "connector",
      connectorId: this.config.id,
      externalId,
    };
  }

  /**
   * Connect to the external service
   */
  abstract connect(): Promise<void>;

  /**
   * Disconnect from the external service
   */
  abstract disconnect(): Promise<void>;

  /**
   * Test the connection
   */
  abstract testConnection(): Promise<boolean>;

  /**
   * Discover files from the external service
   */
  abstract discoverFiles(options?: {
    since?: Date;
    limit?: number;
  }): AsyncGenerator<DiscoveredFile>;

  /**
   * Download a file's content
   */
  abstract downloadFile(externalId: string): Promise<Buffer>;

  /**
   * Run a full sync
   */
  async sync(processFile: (file: DiscoveredFile, buffer: Buffer) => Promise<Document>): Promise<SyncResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let filesDiscovered = 0;
    let filesProcessed = 0;

    await this.emit({ type: "sync_started" });

    try {
      for await (const file of this.discoverFiles()) {
        filesDiscovered++;
        await this.emit({ type: "file_discovered", file });

        try {
          const buffer = await this.downloadFile(file.externalId);
          const document = await processFile(file, buffer);
          filesProcessed++;
          this.stats.documentsProcessed++;
          this.stats.lastProcessedAt = new Date().toISOString();
          await this.emit({ type: "file_processed", file, document });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to process ${file.name}: ${errorMsg}`);
          await this.emit({ type: "error", error: errorMsg });
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Sync error: ${errorMsg}`);
      await this.emit({ type: "error", error: errorMsg });
    }

    const result: SyncResult = {
      success: errors.length === 0,
      filesDiscovered,
      filesProcessed,
      errors,
      duration: Date.now() - startTime,
    };

    // Update average processing time
    if (filesProcessed > 0) {
      const totalTime = this.stats.avgProcessingTimeMs * (this.stats.documentsProcessed - filesProcessed) + result.duration;
      this.stats.avgProcessingTimeMs = totalTime / this.stats.documentsProcessed;
    }

    await this.emit({ type: "sync_completed", result });
    return result;
  }
}

/**
 * Registry of connector factories
 */
export type ConnectorFactory = (config: ConnectorConfig) => BaseConnector;

const connectorFactories = new Map<string, ConnectorFactory>();

/**
 * Register a connector factory
 */
export function registerConnector(type: string, factory: ConnectorFactory): void {
  connectorFactories.set(type, factory);
}

/**
 * Create a connector from config
 */
export function createConnector(config: ConnectorConfig): BaseConnector | null {
  const factory = connectorFactories.get(config.type);
  if (!factory) return null;
  return factory(config);
}

/**
 * Get all registered connector types
 */
export function getConnectorTypes(): string[] {
  return Array.from(connectorFactories.keys());
}
