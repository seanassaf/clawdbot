/**
 * Core types for the Nexus B2B Automation Platform
 */

// =============================================================================
// Document Types
// =============================================================================

export type DocumentType =
  | "expense"
  | "invoice"
  | "receipt"
  | "compliance_form"
  | "work_order"
  | "purchase_order"
  | "contract"
  | "inspection_report"
  | "photo"
  | "unknown";

export type DocumentStatus =
  | "pending"
  | "processing"
  | "analyzed"
  | "flagged"
  | "approved"
  | "rejected";

export type AnomalySeverity = "low" | "medium" | "high" | "critical";

export type Anomaly = {
  id: string;
  type: string;
  description: string;
  severity: AnomalySeverity;
  field?: string;
  expectedValue?: string;
  actualValue?: string;
  confidence: number;
};

export type ExtractedField = {
  name: string;
  value: string | number | boolean | null;
  confidence: number;
  source?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
};

export type DocumentAnalysis = {
  id: string;
  documentType: DocumentType;
  confidence: number;
  extractedFields: ExtractedField[];
  anomalies: Anomaly[];
  recommendations: Recommendation[];
  summary: string;
  processedAt: string;
  processingTimeMs: number;
};

export type Document = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  status: DocumentStatus;
  uploadedAt: string;
  source: DocumentSource;
  analysis?: DocumentAnalysis;
  metadata?: Record<string, unknown>;
};

export type DocumentSource =
  | { type: "upload"; uploadedBy?: string }
  | { type: "google_drive"; fileId: string; folderId?: string }
  | { type: "dropbox"; path: string }
  | { type: "email"; messageId: string; attachmentIndex: number }
  | { type: "api"; clientId: string }
  | { type: "connector"; connectorId: string; externalId: string };

// =============================================================================
// Recommendation Types
// =============================================================================

export type RecommendationType =
  | "approval_needed"
  | "review_required"
  | "auto_categorize"
  | "route_optimization"
  | "compliance_alert"
  | "duplicate_detected"
  | "missing_information"
  | "cost_saving"
  | "workflow_action";

export type Recommendation = {
  id: string;
  type: RecommendationType;
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  action?: RecommendedAction;
  metadata?: Record<string, unknown>;
};

export type RecommendedAction = {
  type: string;
  label: string;
  params?: Record<string, unknown>;
  autoExecute?: boolean;
};

// =============================================================================
// Connector Types (Agent Mode)
// =============================================================================

export type ConnectorType =
  | "google_drive"
  | "google_sheets"
  | "quickbooks"
  | "servicetitan"
  | "salesforce"
  | "hubspot"
  | "slack"
  | "email"
  | "dropbox"
  | "sharepoint"
  | "custom";

export type ConnectorStatus = "connected" | "disconnected" | "error" | "pending_auth";

export type ConnectorConfig = {
  id: string;
  type: ConnectorType;
  name: string;
  enabled: boolean;
  credentials?: ConnectorCredentials;
  settings?: Record<string, unknown>;
  syncSchedule?: SyncSchedule;
  filters?: ConnectorFilter[];
};

export type ConnectorCredentials =
  | { type: "oauth"; accessToken: string; refreshToken?: string; expiresAt?: string }
  | { type: "api_key"; apiKey: string }
  | { type: "basic"; username: string; password: string }
  | { type: "custom"; data: Record<string, unknown> };

export type SyncSchedule = {
  enabled: boolean;
  interval?: "realtime" | "5min" | "15min" | "hourly" | "daily";
  cronExpression?: string;
  lastSyncAt?: string;
  nextSyncAt?: string;
};

export type ConnectorFilter = {
  field: string;
  operator: "eq" | "neq" | "contains" | "startsWith" | "endsWith" | "gt" | "lt" | "gte" | "lte";
  value: string | number | boolean;
};

export type Connector = {
  id: string;
  config: ConnectorConfig;
  status: ConnectorStatus;
  lastError?: string;
  stats?: ConnectorStats;
};

export type ConnectorStats = {
  documentsProcessed: number;
  lastProcessedAt?: string;
  errorCount: number;
  avgProcessingTimeMs: number;
};

// =============================================================================
// Workflow/Task Types (Agent Mode)
// =============================================================================

export type TaskType =
  | "process_document"
  | "sync_connector"
  | "optimize_routes"
  | "compliance_check"
  | "generate_report"
  | "send_notification"
  | "export_data"
  | "custom";

export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export type Task = {
  id: string;
  type: TaskType;
  status: TaskStatus;
  priority: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  params: Record<string, unknown>;
  result?: TaskResult;
  error?: string;
  retryCount: number;
  maxRetries: number;
};

export type TaskResult = {
  success: boolean;
  data?: unknown;
  metrics?: {
    durationMs: number;
    itemsProcessed?: number;
  };
};

// =============================================================================
// Route Optimization Types
// =============================================================================

export type Location = {
  id: string;
  name?: string;
  address: string;
  latitude: number;
  longitude: number;
  serviceTimeMinutes?: number;
  timeWindow?: { start: string; end: string };
};

export type Technician = {
  id: string;
  name: string;
  skills?: string[];
  homeBase?: Location;
  maxStops?: number;
  shiftStart?: string;
  shiftEnd?: string;
};

export type RouteStop = {
  location: Location;
  arrivalTime: string;
  departureTime: string;
  sequence: number;
  serviceType?: string;
};

export type OptimizedRoute = {
  technicianId: string;
  stops: RouteStop[];
  totalDistanceKm: number;
  totalDurationMinutes: number;
  estimatedCost?: number;
};

export type RouteOptimizationResult = {
  routes: OptimizedRoute[];
  unassignedLocations: Location[];
  savingsVsManual?: {
    distanceKm: number;
    durationMinutes: number;
    costSavings?: number;
  };
};

// =============================================================================
// API Types (Embedded Mode)
// =============================================================================

export type ApiKeyScope =
  | "read:documents"
  | "write:documents"
  | "read:analysis"
  | "read:connectors"
  | "write:connectors"
  | "read:tasks"
  | "write:tasks"
  | "admin";

export type ApiKey = {
  id: string;
  name: string;
  keyHash: string;
  scopes: ApiKeyScope[];
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
};

export type ApiRequest = {
  endpoint: string;
  method: string;
  apiKeyId: string;
  clientIp?: string;
  timestamp: string;
  durationMs: number;
  statusCode: number;
};

// =============================================================================
// Configuration Types
// =============================================================================

export type NexusB2BConfig = {
  enabled?: boolean;
  dashboard?: DashboardConfig;
  agent?: AgentModeConfig;
  embedded?: EmbeddedModeConfig;
};

export type DashboardConfig = {
  enabled?: boolean;
  maxFileSizeMb?: number;
  allowedMimeTypes?: string[];
  analysisTimeoutSeconds?: number;
  defaultModel?: string;
};

export type AgentModeConfig = {
  enabled?: boolean;
  connectors?: ConnectorConfig[];
  backgroundProcessing?: {
    enabled?: boolean;
    maxConcurrentTasks?: number;
    taskRetryDelayMs?: number;
  };
  routeOptimization?: {
    enabled?: boolean;
    provider?: "google_maps" | "openrouteservice" | "custom";
    apiKey?: string;
  };
};

export type EmbeddedModeConfig = {
  enabled?: boolean;
  apiKeys?: Omit<ApiKey, "keyHash">[];
  cors?: {
    origins?: string[];
    methods?: string[];
  };
  rateLimiting?: {
    enabled?: boolean;
    defaultRequestsPerMinute?: number;
  };
  webhooks?: WebhookConfig[];
};

export type WebhookConfig = {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret?: string;
  enabled?: boolean;
};

export type WebhookEvent =
  | "document.uploaded"
  | "document.analyzed"
  | "document.flagged"
  | "task.completed"
  | "task.failed"
  | "connector.synced"
  | "anomaly.detected";

// =============================================================================
// Event Types
// =============================================================================

export type NexusEvent =
  | { type: "document.uploaded"; document: Document }
  | { type: "document.analyzed"; document: Document; analysis: DocumentAnalysis }
  | { type: "document.flagged"; document: Document; anomalies: Anomaly[] }
  | { type: "task.created"; task: Task }
  | { type: "task.completed"; task: Task }
  | { type: "task.failed"; task: Task; error: string }
  | { type: "connector.synced"; connector: Connector; documentsFound: number }
  | { type: "connector.error"; connector: Connector; error: string }
  | { type: "anomaly.detected"; document: Document; anomaly: Anomaly };
