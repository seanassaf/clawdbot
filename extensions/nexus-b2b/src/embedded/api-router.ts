/**
 * Embedded Mode API Router
 * RESTful API for third-party integrations
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ClawdbotPluginApi } from "../../../../src/plugins/types.js";
import type {
  ApiKey,
  ApiKeyScope,
  EmbeddedModeConfig,
  Document,
  DocumentAnalysis,
  Connector,
  Task,
  WebhookConfig,
  NexusEvent,
} from "../types/index.js";
import { DocumentProcessor } from "../dashboard/document-processor.js";
import { TaskManager } from "../agent/processors/task-manager.js";
import { DocumentWatcher } from "../agent/processors/document-watcher.js";
import { hashString, generateApiKey } from "../utils.js";

export type ApiContext = {
  api: ClawdbotPluginApi;
  config: EmbeddedModeConfig;
  documentProcessor: DocumentProcessor;
  taskManager: TaskManager;
  documentWatcher: DocumentWatcher;
};

export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
  };
};

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  params: Record<string, string>,
) => Promise<void>;

type Route = {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
  scopes: ApiKeyScope[];
};

const routes: Route[] = [];

function route(
  method: string,
  path: string,
  scopes: ApiKeyScope[],
  handler: RouteHandler,
): void {
  // Convert path pattern to regex
  const paramNames: string[] = [];
  const regexStr = path.replace(/:(\w+)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  routes.push({
    method,
    pattern: new RegExp(`^${regexStr}$`),
    paramNames,
    handler,
    scopes,
  });
}

async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      if (!body) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: ApiResponse): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendError(res: ServerResponse, status: number, error: string): void {
  sendJson(res, status, { success: false, error });
}

// =============================================================================
// API Key Management
// =============================================================================

const apiKeys = new Map<string, ApiKey>();

function validateApiKey(
  req: IncomingMessage,
  requiredScopes: ApiKeyScope[],
): ApiKey | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const keyHash = hashString(token);

  for (const apiKey of apiKeys.values()) {
    if (apiKey.keyHash === keyHash) {
      // Check expiration
      if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
        return null;
      }

      // Check scopes
      const hasAdmin = apiKey.scopes.includes("admin");
      const hasRequiredScopes = requiredScopes.every(
        (scope) => hasAdmin || apiKey.scopes.includes(scope),
      );

      if (!hasRequiredScopes) return null;

      // Update last used
      apiKey.lastUsedAt = new Date().toISOString();
      return apiKey;
    }
  }

  return null;
}

// =============================================================================
// Document Routes
// =============================================================================

route("GET", "/api/v1/documents", ["read:documents"], async (req, res, ctx, params) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const status = url.searchParams.get("status") ?? undefined;
  const type = url.searchParams.get("type") ?? undefined;
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

  const documents = ctx.documentProcessor.listDocuments({
    status: status as Document["status"],
    type,
    limit,
    offset,
  });

  sendJson(res, 200, {
    success: true,
    data: documents,
    meta: { page: Math.floor(offset / limit) + 1, pageSize: limit },
  });
});

route("GET", "/api/v1/documents/:id", ["read:documents"], async (req, res, ctx, params) => {
  const document = ctx.documentProcessor.getDocument(params.id!);
  if (!document) {
    sendError(res, 404, "Document not found");
    return;
  }
  sendJson(res, 200, { success: true, data: document });
});

route("POST", "/api/v1/documents", ["write:documents"], async (req, res, ctx, params) => {
  const contentType = req.headers["content-type"] ?? "";

  if (contentType.includes("multipart/form-data")) {
    // Handle multipart file upload - simplified for this implementation
    sendError(res, 501, "Multipart upload not yet implemented - use base64 body");
    return;
  }

  const body = (await parseBody(req)) as {
    fileName?: string;
    content?: string;
    contentBase64?: string;
    mimeType?: string;
  };

  if (!body?.fileName) {
    sendError(res, 400, "fileName is required");
    return;
  }

  let buffer: Buffer;
  if (body.contentBase64) {
    buffer = Buffer.from(body.contentBase64, "base64");
  } else if (body.content) {
    buffer = Buffer.from(body.content, "utf8");
  } else {
    sendError(res, 400, "content or contentBase64 is required");
    return;
  }

  const result = await ctx.documentProcessor.processBuffer(
    buffer,
    body.fileName,
    { type: "api", clientId: "embedded" },
    body.mimeType,
  );

  if (result.error) {
    sendJson(res, 422, {
      success: false,
      error: result.error,
      data: result.document,
    });
    return;
  }

  sendJson(res, 201, {
    success: true,
    data: {
      document: result.document,
      analysis: result.analysis,
    },
  });
});

route("DELETE", "/api/v1/documents/:id", ["write:documents"], async (req, res, ctx, params) => {
  const deleted = await ctx.documentProcessor.deleteDocument(params.id!);
  if (!deleted) {
    sendError(res, 404, "Document not found");
    return;
  }
  sendJson(res, 200, { success: true });
});

// =============================================================================
// Analysis Routes
// =============================================================================

route("GET", "/api/v1/documents/:id/analysis", ["read:analysis"], async (req, res, ctx, params) => {
  const document = ctx.documentProcessor.getDocument(params.id!);
  if (!document) {
    sendError(res, 404, "Document not found");
    return;
  }
  if (!document.analysis) {
    sendError(res, 404, "Analysis not available");
    return;
  }
  sendJson(res, 200, { success: true, data: document.analysis });
});

route("POST", "/api/v1/analyze", ["read:analysis"], async (req, res, ctx, params) => {
  const body = (await parseBody(req)) as {
    content?: string;
    fileName?: string;
    mimeType?: string;
  };

  if (!body?.content || !body?.fileName) {
    sendError(res, 400, "content and fileName are required");
    return;
  }

  const buffer = Buffer.from(body.content, "utf8");
  const result = await ctx.documentProcessor.processBuffer(
    buffer,
    body.fileName,
    { type: "api", clientId: "embedded" },
    body.mimeType ?? "text/plain",
  );

  if (result.error) {
    sendJson(res, 422, { success: false, error: result.error });
    return;
  }

  sendJson(res, 200, { success: true, data: result.analysis });
});

// =============================================================================
// Connector Routes
// =============================================================================

route("GET", "/api/v1/connectors", ["read:connectors"], async (req, res, ctx, params) => {
  const connectors = ctx.documentWatcher.getConnectors();
  sendJson(res, 200, { success: true, data: connectors });
});

route("POST", "/api/v1/connectors/:id/sync", ["write:connectors"], async (req, res, ctx, params) => {
  try {
    const task = await ctx.documentWatcher.triggerSync(params.id!);
    sendJson(res, 202, { success: true, data: { taskId: task.id } });
  } catch (err) {
    sendError(res, 400, err instanceof Error ? err.message : "Sync failed");
  }
});

// =============================================================================
// Task Routes
// =============================================================================

route("GET", "/api/v1/tasks", ["read:tasks"], async (req, res, ctx, params) => {
  const stats = ctx.taskManager.getStats();
  sendJson(res, 200, { success: true, data: stats });
});

route("GET", "/api/v1/tasks/:id", ["read:tasks"], async (req, res, ctx, params) => {
  const task = ctx.taskManager.getTask(params.id!);
  if (!task) {
    sendError(res, 404, "Task not found");
    return;
  }
  sendJson(res, 200, { success: true, data: task });
});

route("DELETE", "/api/v1/tasks/:id", ["write:tasks"], async (req, res, ctx, params) => {
  const cancelled = await ctx.taskManager.cancelTask(params.id!);
  if (!cancelled) {
    sendError(res, 404, "Task not found or cannot be cancelled");
    return;
  }
  sendJson(res, 200, { success: true });
});

// =============================================================================
// Stats Routes
// =============================================================================

route("GET", "/api/v1/stats", ["read:documents"], async (req, res, ctx, params) => {
  const docStats = ctx.documentProcessor.getStats();
  const taskStats = ctx.taskManager.getStats();
  const watcherStatus = ctx.documentWatcher.getStatus();

  sendJson(res, 200, {
    success: true,
    data: {
      documents: docStats,
      tasks: taskStats,
      watcher: watcherStatus,
    },
  });
});

// =============================================================================
// Health Check
// =============================================================================

route("GET", "/api/v1/health", [], async (req, res, ctx, params) => {
  sendJson(res, 200, {
    success: true,
    data: {
      status: "healthy",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    },
  });
});

// =============================================================================
// Router
// =============================================================================

export class ApiRouter {
  private ctx: ApiContext;

  constructor(ctx: ApiContext) {
    this.ctx = ctx;

    // Initialize API keys from config
    for (const keyConfig of ctx.config.apiKeys ?? []) {
      const { key, hash } = generateApiKey();
      apiKeys.set(keyConfig.id, {
        ...keyConfig,
        keyHash: hash,
      });
    }
  }

  /**
   * Handle an HTTP request
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    // CORS headers
    const corsOrigins = this.ctx.config.cors?.origins ?? ["*"];
    const origin = req.headers.origin ?? "*";
    if (corsOrigins.includes("*") || corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // Handle preflight
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return true;
    }

    // Check if this is a Nexus API route
    if (!pathname.startsWith("/api/v1/")) {
      return false;
    }

    // Find matching route
    for (const route of routes) {
      if (route.method !== method) continue;

      const match = pathname.match(route.pattern);
      if (!match) continue;

      // Extract params
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1] ?? "";
      });

      // Validate API key (skip for health check)
      if (route.scopes.length > 0) {
        const apiKey = validateApiKey(req, route.scopes);
        if (!apiKey) {
          sendError(res, 401, "Invalid or missing API key");
          return true;
        }
      }

      // Execute handler
      try {
        await route.handler(req, res, this.ctx, params);
      } catch (err) {
        console.error(`API error: ${err}`);
        sendError(res, 500, err instanceof Error ? err.message : "Internal server error");
      }

      return true;
    }

    // No matching route
    sendError(res, 404, "Not found");
    return true;
  }

  /**
   * Create a new API key
   */
  createApiKey(name: string, scopes: ApiKeyScope[], expiresAt?: string): { id: string; key: string } {
    const { key, hash } = generateApiKey();
    const id = `key_${Date.now()}`;

    apiKeys.set(id, {
      id,
      name,
      keyHash: hash,
      scopes,
      createdAt: new Date().toISOString(),
      expiresAt,
    });

    return { id, key };
  }

  /**
   * Revoke an API key
   */
  revokeApiKey(id: string): boolean {
    return apiKeys.delete(id);
  }

  /**
   * List API keys (without secrets)
   */
  listApiKeys(): Array<Omit<ApiKey, "keyHash">> {
    return Array.from(apiKeys.values()).map(({ keyHash, ...rest }) => rest);
  }
}

export function createApiRouter(ctx: ApiContext): ApiRouter {
  return new ApiRouter(ctx);
}
