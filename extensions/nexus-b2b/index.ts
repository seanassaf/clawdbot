/**
 * Nexus B2B Automation Platform
 *
 * A comprehensive B2B automation platform that uses AI to eliminate manual
 * paperwork and streamline operations for industrial companies, compliance-heavy
 * organizations, and businesses with outdated software systems.
 *
 * Three Modes of Operation:
 *
 * 1. DASHBOARD MODE - Drag-and-drop document processing with instant AI analysis
 *    - Upload documents (expenses, invoices, photos, compliance forms)
 *    - Receive analysis with categorization, anomaly detection, recommendations
 *    - Results delivered within 60 seconds
 *
 * 2. AGENT MODE - 24/7 background automation
 *    - Connects to external tools (Google Drive, QuickBooks, ServiceTitan, etc.)
 *    - Automatically processes new files as they arrive
 *    - Detects issues, optimizes routes, generates tasks
 *    - Zero manual intervention required
 *
 * 3. EMBEDDED MODE - API access for software vendors
 *    - RESTful API for third-party integration
 *    - Webhook notifications for real-time event streaming
 *    - Build Nexus AI capabilities into any product
 */

import type { ClawdbotPluginApi } from "../../src/plugins/types.js";
import { Type } from "@sinclair/typebox";

import type { NexusB2BConfig, NexusEvent } from "./src/types/index.js";
import { registerNexusCli } from "./src/cli.js";
import { createDocumentProcessor, type DocumentProcessor } from "./src/dashboard/index.js";
import { createTaskManager, createDocumentWatcher, type TaskManager, type DocumentWatcher } from "./src/agent/index.js";
import { createRouteOptimizer, type RouteOptimizer } from "./src/agent/optimizers/route-optimizer.js";
import { createApiRouter, createWebhookManager, type ApiRouter, type WebhookManager } from "./src/embedded/index.js";

// Global instances for the plugin
let documentProcessor: DocumentProcessor | null = null;
let taskManager: TaskManager | null = null;
let documentWatcher: DocumentWatcher | null = null;
let routeOptimizer: RouteOptimizer | null = null;
let apiRouter: ApiRouter | null = null;
let webhookManager: WebhookManager | null = null;

// Track initialization state
let initialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize all Nexus B2B components (called synchronously, async parts deferred)
 */
function initializeNexusSync(api: ClawdbotPluginApi, config: NexusB2BConfig): void {
  // Dashboard Mode - create synchronously
  if (config.dashboard?.enabled !== false) {
    documentProcessor = createDocumentProcessor(api, config.dashboard);
  }

  // Agent Mode - create synchronously
  if (config.agent?.enabled !== false) {
    taskManager = createTaskManager(config.agent?.backgroundProcessing);

    if (documentProcessor) {
      documentWatcher = createDocumentWatcher(
        api,
        {
          enabled: config.agent?.backgroundProcessing?.enabled,
          connectors: config.agent?.connectors,
        },
        taskManager,
        documentProcessor,
      );
    }

    routeOptimizer = createRouteOptimizer(api, config.agent?.routeOptimization);
  }

  // Embedded Mode
  if (config.embedded?.enabled !== false && documentProcessor && taskManager && documentWatcher) {
    webhookManager = createWebhookManager(config.embedded?.webhooks);

    apiRouter = createApiRouter({
      api,
      config: config.embedded ?? {},
      documentProcessor,
      taskManager,
      documentWatcher,
    });
  }
}

/**
 * Complete async initialization (called lazily when tools are used)
 */
async function ensureInitialized(api: ClawdbotPluginApi): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (documentProcessor) {
      await documentProcessor.initialize();
      api.logger.info("Nexus B2B: Dashboard Mode initialized");
    }
    if (taskManager) {
      api.logger.info("Nexus B2B: Agent Mode initialized");
    }
    if (apiRouter) {
      api.logger.info("Nexus B2B: Embedded Mode initialized");
    }
    initialized = true;
  })();

  return initPromise;
}

/**
 * Plugin definition
 */
const nexusB2BPlugin = {
  id: "nexus-b2b",
  name: "Nexus B2B Automation",
  description: "AI-powered B2B automation platform for document processing, workflow automation, and third-party integration",
  version: "1.0.0",

  configSchema: {
    jsonSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", default: true },
        dashboard: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: true },
            maxFileSizeMb: { type: "number", default: 50 },
            analysisTimeoutSeconds: { type: "number", default: 60 },
            defaultModel: { type: "string" },
          },
        },
        agent: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: true },
            connectors: { type: "array", items: { type: "object" } },
            backgroundProcessing: {
              type: "object",
              properties: {
                enabled: { type: "boolean", default: true },
                maxConcurrentTasks: { type: "number", default: 3 },
              },
            },
            routeOptimization: {
              type: "object",
              properties: {
                enabled: { type: "boolean", default: true },
              },
            },
          },
        },
        embedded: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: true },
            cors: { type: "object" },
            rateLimiting: { type: "object" },
            webhooks: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
  },

  register(api: ClawdbotPluginApi) {
    const pluginConfig = (api.pluginConfig ?? {}) as NexusB2BConfig;

    // Register CLI commands
    api.registerCli(
      (ctx) => registerNexusCli(ctx),
      { commands: ["nexus"] },
    );

    if (pluginConfig.enabled === false) {
      api.logger.info("Nexus B2B: Plugin disabled by configuration");
      return;
    }

    // Initialize components synchronously
    initializeNexusSync(api, pluginConfig);

    // Register AI tools for agents (tools call ensureInitialized lazily)
    api.registerTool({
      name: "nexus_analyze_document",
      description: "Analyze a document using Nexus B2B AI. Returns document type, extracted fields, anomalies, and recommendations.",
      parameters: Type.Object({
        content: Type.String({ description: "The document content to analyze" }),
        fileName: Type.String({ description: "The file name" }),
        mimeType: Type.Optional(Type.String({ description: "MIME type of the document" })),
      }),
      async execute(_id: string, params: { content: string; fileName: string; mimeType?: string }) {
        await ensureInitialized(api);
        if (!documentProcessor) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "Document processor not available" }) }],
          };
        }
        const result = await documentProcessor.processBuffer(
          Buffer.from(params.content, "utf8"),
          params.fileName,
          { type: "api", clientId: "agent" },
          params.mimeType ?? "text/plain",
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  documentId: result.document.id,
                  documentType: result.analysis?.documentType,
                  confidence: result.analysis?.confidence,
                  summary: result.analysis?.summary,
                  fields: result.analysis?.extractedFields,
                  anomalies: result.analysis?.anomalies,
                  recommendations: result.analysis?.recommendations,
                  error: result.error,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    });

    api.registerTool({
      name: "nexus_optimize_routes",
      description: "Optimize technician routes for field service operations. Takes locations and technicians, returns optimized routes.",
      parameters: Type.Object({
        locations: Type.Array(
          Type.Object({
            id: Type.String(),
            address: Type.String(),
            latitude: Type.Number(),
            longitude: Type.Number(),
            serviceTimeMinutes: Type.Optional(Type.Number()),
          }),
          { description: "Locations to visit" },
        ),
        technicians: Type.Array(
          Type.Object({
            id: Type.String(),
            name: Type.String(),
            shiftStart: Type.Optional(Type.String()),
            shiftEnd: Type.Optional(Type.String()),
          }),
          { description: "Available technicians" },
        ),
        date: Type.Optional(Type.String({ description: "Date for route planning (ISO format)" })),
      }),
      async execute(
        _id: string,
        params: {
          locations: Array<{
            id: string;
            address: string;
            latitude: number;
            longitude: number;
            serviceTimeMinutes?: number;
          }>;
          technicians: Array<{
            id: string;
            name: string;
            shiftStart?: string;
            shiftEnd?: string;
          }>;
          date?: string;
        },
      ) {
        await ensureInitialized(api);
        if (!routeOptimizer) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "Route optimizer not available" }) }],
          };
        }
        const result = await routeOptimizer.optimizeRoutes(
          params.locations,
          params.technicians,
          params.date ? new Date(params.date) : new Date(),
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      },
    });

    // Register HTTP handler for Embedded Mode API
    if (apiRouter) {
      api.registerHttpHandler(async (req, res) => {
        return apiRouter!.handle(req, res);
      });
    }

    // Register gateway start hook to start background services
    api.on("gateway_start", async () => {
      if (documentWatcher) {
        await documentWatcher.start();
        api.logger.info("Nexus B2B: Document watcher started");
      }
    });

    // Register gateway stop hook to stop background services
    api.on("gateway_stop", async () => {
      if (documentWatcher) {
        await documentWatcher.stop();
        api.logger.info("Nexus B2B: Document watcher stopped");
      }
    });

    // Wire up webhook dispatching for events
    if (webhookManager && documentWatcher) {
      documentWatcher.on(async (event) => {
        let nexusEvent: NexusEvent | null = null;

        if (event.type === "document_processed") {
          nexusEvent = {
            type: "document.analyzed",
            document: event.document,
            analysis: event.document.analysis!,
          };

          // Check for flagged documents
          if (event.document.status === "flagged" && event.document.analysis?.anomalies) {
            await webhookManager!.dispatch({
              type: "document.flagged",
              document: event.document,
              anomalies: event.document.analysis.anomalies,
            });
          }
        } else if (event.type === "connector_synced") {
          nexusEvent = {
            type: "connector.synced",
            connector: {
              id: event.connectorId,
              config: { id: event.connectorId, type: "unknown", name: "", enabled: true },
              status: "connected",
            },
            documentsFound: event.filesFound,
          };
        }

        if (nexusEvent) {
          await webhookManager!.dispatch(nexusEvent);
        }
      });
    }

    api.logger.info("Nexus B2B: Plugin registered successfully");
  },
};

export default nexusB2BPlugin;

// Re-export types and utilities for external use
export * from "./src/types/index.js";
export * from "./src/dashboard/index.js";
export * from "./src/agent/index.js";
export * from "./src/embedded/index.js";
export { generateId, hashString, formatFileSize, formatDuration } from "./src/utils.js";
