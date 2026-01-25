/**
 * AI Analysis Engine for Document Processing
 * Uses clawdbot's LLM infrastructure for intelligent document analysis
 */

import type { ClawdbotPluginApi } from "../../../../src/plugins/types.js";
import type {
  DocumentAnalysis,
  DocumentType,
  ExtractedField,
  Anomaly,
  Recommendation,
  AnomalySeverity,
  RecommendationType,
} from "../types/index.js";
import { generateId, stripCodeFences, safeJsonParse } from "../utils.js";

type RunEmbeddedPiAgentFn = (params: Record<string, unknown>) => Promise<unknown>;

let runEmbeddedPiAgent: RunEmbeddedPiAgentFn | null = null;

async function loadRunner(): Promise<RunEmbeddedPiAgentFn> {
  if (runEmbeddedPiAgent) return runEmbeddedPiAgent;

  try {
    const mod = await import("../../../../src/agents/pi-embedded-runner.js");
    if (typeof (mod as Record<string, unknown>).runEmbeddedPiAgent === "function") {
      runEmbeddedPiAgent = (mod as Record<string, RunEmbeddedPiAgentFn>).runEmbeddedPiAgent;
      return runEmbeddedPiAgent;
    }
  } catch {
    // Fallback to built version
  }

  const mod = await import("../../../../agents/pi-embedded-runner.js");
  runEmbeddedPiAgent = (mod as Record<string, RunEmbeddedPiAgentFn>).runEmbeddedPiAgent;
  return runEmbeddedPiAgent;
}

function collectText(payloads: Array<{ text?: string; isError?: boolean }> | undefined): string {
  return (payloads ?? [])
    .filter((p) => !p.isError && typeof p.text === "string")
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();
}

export type AnalysisEngineConfig = {
  defaultModel?: string;
  defaultProvider?: string;
  timeoutMs?: number;
  maxTokens?: number;
};

export type AnalysisInput = {
  content: string;
  fileName: string;
  mimeType: string;
  metadata?: Record<string, unknown>;
};

type LLMAnalysisResult = {
  documentType: DocumentType;
  confidence: number;
  extractedFields: Array<{
    name: string;
    value: string | number | boolean | null;
    confidence: number;
    source?: string;
  }>;
  anomalies: Array<{
    type: string;
    description: string;
    severity: AnomalySeverity;
    field?: string;
    expectedValue?: string;
    actualValue?: string;
    confidence: number;
  }>;
  recommendations: Array<{
    type: RecommendationType;
    title: string;
    description: string;
    priority: "low" | "medium" | "high" | "urgent";
  }>;
  summary: string;
};

const ANALYSIS_PROMPT = `You are an expert document analysis AI for a B2B automation platform.
Analyze the following document and extract structured information.

IMPORTANT: Return ONLY valid JSON matching the schema below. No markdown, no explanation.

DOCUMENT TYPES:
- expense: Expense reports, reimbursement requests
- invoice: Vendor invoices, bills
- receipt: Purchase receipts, transaction records
- compliance_form: Safety forms, regulatory documents, certifications
- work_order: Service orders, job tickets, maintenance requests
- purchase_order: PO documents, requisitions
- contract: Agreements, terms of service, legal documents
- inspection_report: Quality checks, audit reports, site inspections
- photo: Job site photos, equipment images, damage documentation
- unknown: Cannot determine document type

SEVERITY LEVELS for anomalies:
- low: Minor issue, informational
- medium: Requires attention, potential issue
- high: Significant problem, needs resolution
- critical: Urgent issue, immediate action required

RECOMMENDATION TYPES:
- approval_needed: Document requires manager/supervisor approval
- review_required: Manual review needed for accuracy
- auto_categorize: Can be automatically filed/categorized
- route_optimization: Related to scheduling/routing efficiency
- compliance_alert: Regulatory or safety compliance concern
- duplicate_detected: Potential duplicate document
- missing_information: Required fields are missing
- cost_saving: Opportunity for cost reduction
- workflow_action: Triggers a specific workflow step

OUTPUT SCHEMA:
{
  "documentType": "<DocumentType>",
  "confidence": <0.0-1.0>,
  "extractedFields": [
    {
      "name": "<field_name>",
      "value": "<extracted_value>",
      "confidence": <0.0-1.0>,
      "source": "<where_in_document>"
    }
  ],
  "anomalies": [
    {
      "type": "<anomaly_type>",
      "description": "<what_is_wrong>",
      "severity": "<low|medium|high|critical>",
      "field": "<related_field_if_any>",
      "expectedValue": "<what_was_expected>",
      "actualValue": "<what_was_found>",
      "confidence": <0.0-1.0>
    }
  ],
  "recommendations": [
    {
      "type": "<RecommendationType>",
      "title": "<short_title>",
      "description": "<detailed_recommendation>",
      "priority": "<low|medium|high|urgent>"
    }
  ],
  "summary": "<2-3 sentence summary of the document>"
}

COMMON FIELDS TO EXTRACT (if present):
- For invoices/receipts: vendor_name, invoice_number, date, due_date, total_amount, tax_amount, line_items, payment_terms
- For expenses: employee_name, expense_date, category, amount, description, receipt_attached
- For work orders: job_number, customer_name, service_address, scheduled_date, technician, service_type, status
- For compliance forms: form_type, inspector_name, inspection_date, pass_fail, violations, corrective_actions
- For photos: subject, location, timestamp, description, issues_visible

ANOMALY DETECTION - Flag these issues:
- Missing required fields
- Unusual amounts (too high/low for category)
- Date inconsistencies (future dates, expired)
- Math errors (totals don't add up)
- Duplicate entries
- Policy violations
- Incomplete signatures/approvals
- Expired certifications
- Safety concerns in photos`;

export class AnalysisEngine {
  private api: ClawdbotPluginApi;
  private config: AnalysisEngineConfig;

  constructor(api: ClawdbotPluginApi, config: AnalysisEngineConfig = {}) {
    this.api = api;
    this.config = config;
  }

  async analyzeDocument(input: AnalysisInput): Promise<DocumentAnalysis> {
    const startTime = Date.now();
    const runner = await loadRunner();

    const primary = this.api.config?.agents?.defaults?.model?.primary;
    const primaryProvider = typeof primary === "string" ? primary.split("/")[0] : undefined;
    const primaryModel = typeof primary === "string" ? primary.split("/").slice(1).join("/") : undefined;

    const provider = this.config.defaultProvider ?? primaryProvider ?? "anthropic";
    const model = this.config.defaultModel ?? primaryModel ?? "claude-opus-4-5";
    const timeoutMs = this.config.timeoutMs ?? 60000;

    const prompt = `${ANALYSIS_PROMPT}

DOCUMENT METADATA:
- File name: ${input.fileName}
- MIME type: ${input.mimeType}
${input.metadata ? `- Additional context: ${JSON.stringify(input.metadata)}` : ""}

DOCUMENT CONTENT:
${input.content}

Analyze this document and return the JSON analysis:`;

    const result = await runner({
      sessionId: `nexus-analysis-${Date.now()}`,
      sessionFile: "",
      workspaceDir: this.api.config?.agents?.defaults?.workspace ?? process.cwd(),
      config: this.api.config,
      prompt,
      timeoutMs,
      runId: `nexus-${Date.now()}`,
      provider,
      model,
      disableTools: true,
      streamParams: {
        maxTokens: this.config.maxTokens ?? 4096,
      },
    });

    const text = collectText((result as Record<string, unknown>).payloads as Array<{ text?: string; isError?: boolean }>);
    if (!text) {
      throw new Error("Analysis returned empty output");
    }

    const cleaned = stripCodeFences(text);
    const parsed = safeJsonParse<LLMAnalysisResult>(cleaned, null as unknown as LLMAnalysisResult);

    if (!parsed) {
      throw new Error("Failed to parse analysis result as JSON");
    }

    const processingTimeMs = Date.now() - startTime;

    return {
      id: generateId("analysis"),
      documentType: parsed.documentType ?? "unknown",
      confidence: parsed.confidence ?? 0.5,
      extractedFields: (parsed.extractedFields ?? []).map((f) => ({
        name: f.name,
        value: f.value,
        confidence: f.confidence ?? 0.5,
        source: f.source,
      })) as ExtractedField[],
      anomalies: (parsed.anomalies ?? []).map((a) => ({
        id: generateId("anomaly"),
        type: a.type,
        description: a.description,
        severity: a.severity ?? "low",
        field: a.field,
        expectedValue: a.expectedValue,
        actualValue: a.actualValue,
        confidence: a.confidence ?? 0.5,
      })) as Anomaly[],
      recommendations: (parsed.recommendations ?? []).map((r) => ({
        id: generateId("rec"),
        type: r.type,
        title: r.title,
        description: r.description,
        priority: r.priority ?? "medium",
      })) as Recommendation[],
      summary: parsed.summary ?? "Document analyzed",
      processedAt: new Date().toISOString(),
      processingTimeMs,
    };
  }

  async categorizeDocument(content: string, fileName: string): Promise<{ type: DocumentType; confidence: number }> {
    const runner = await loadRunner();

    const prompt = `Classify this document into exactly one category. Return ONLY JSON: {"type": "<category>", "confidence": <0-1>}

Categories: expense, invoice, receipt, compliance_form, work_order, purchase_order, contract, inspection_report, photo, unknown

File: ${fileName}
Content preview: ${content.slice(0, 2000)}`;

    const result = await runner({
      sessionId: `nexus-categorize-${Date.now()}`,
      sessionFile: "",
      workspaceDir: process.cwd(),
      config: this.api.config,
      prompt,
      timeoutMs: 15000,
      runId: `nexus-cat-${Date.now()}`,
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      disableTools: true,
    });

    const text = collectText((result as Record<string, unknown>).payloads as Array<{ text?: string; isError?: boolean }>);
    const parsed = safeJsonParse<{ type: DocumentType; confidence: number }>(
      stripCodeFences(text),
      { type: "unknown", confidence: 0.5 },
    );

    return parsed;
  }

  async detectAnomalies(
    fields: ExtractedField[],
    documentType: DocumentType,
  ): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = [];

    // Rule-based anomaly detection (fast, no LLM needed)
    for (const field of fields) {
      // Low confidence extraction
      if (field.confidence < 0.7) {
        anomalies.push({
          id: generateId("anomaly"),
          type: "low_confidence_extraction",
          description: `Field "${field.name}" was extracted with low confidence`,
          severity: "low",
          field: field.name,
          confidence: 1 - field.confidence,
        });
      }

      // Check for suspicious amounts
      if (field.name.toLowerCase().includes("amount") || field.name.toLowerCase().includes("total")) {
        const amount = typeof field.value === "number" ? field.value : parseFloat(String(field.value));
        if (!isNaN(amount)) {
          if (amount < 0) {
            anomalies.push({
              id: generateId("anomaly"),
              type: "negative_amount",
              description: "Negative amount detected",
              severity: "high",
              field: field.name,
              actualValue: String(amount),
              confidence: 0.95,
            });
          }
          if (amount > 100000 && documentType === "expense") {
            anomalies.push({
              id: generateId("anomaly"),
              type: "unusually_high_amount",
              description: "Expense amount is unusually high",
              severity: "medium",
              field: field.name,
              actualValue: String(amount),
              confidence: 0.8,
            });
          }
        }
      }

      // Check for date issues
      if (field.name.toLowerCase().includes("date")) {
        const dateValue = new Date(String(field.value));
        if (!isNaN(dateValue.getTime())) {
          const now = new Date();
          if (dateValue > now) {
            anomalies.push({
              id: generateId("anomaly"),
              type: "future_date",
              description: "Date is in the future",
              severity: "medium",
              field: field.name,
              actualValue: String(field.value),
              confidence: 0.9,
            });
          }
          const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
          if (dateValue < oneYearAgo && documentType !== "contract") {
            anomalies.push({
              id: generateId("anomaly"),
              type: "old_date",
              description: "Date is more than a year old",
              severity: "low",
              field: field.name,
              actualValue: String(field.value),
              confidence: 0.85,
            });
          }
        }
      }
    }

    // Check for missing required fields based on document type
    const requiredFields: Record<DocumentType, string[]> = {
      invoice: ["vendor_name", "invoice_number", "total_amount", "date"],
      expense: ["amount", "date", "category"],
      receipt: ["vendor_name", "total_amount", "date"],
      work_order: ["job_number", "customer_name", "service_type"],
      purchase_order: ["po_number", "vendor_name", "total_amount"],
      compliance_form: ["form_type", "date", "inspector_name"],
      inspection_report: ["date", "inspector_name", "pass_fail"],
      contract: ["parties", "effective_date"],
      photo: ["description"],
      unknown: [],
    };

    const fieldNames = new Set(fields.map((f) => f.name.toLowerCase().replace(/[_\s]/g, "")));
    const required = requiredFields[documentType] ?? [];

    for (const req of required) {
      const normalized = req.toLowerCase().replace(/[_\s]/g, "");
      if (!fieldNames.has(normalized)) {
        anomalies.push({
          id: generateId("anomaly"),
          type: "missing_required_field",
          description: `Required field "${req}" is missing`,
          severity: "medium",
          field: req,
          confidence: 0.9,
        });
      }
    }

    return anomalies;
  }

  async generateRecommendations(
    analysis: Omit<DocumentAnalysis, "recommendations">,
  ): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    // High-value documents need approval
    const totalField = analysis.extractedFields.find(
      (f) => f.name.toLowerCase().includes("total") || f.name.toLowerCase().includes("amount"),
    );
    if (totalField) {
      const amount = typeof totalField.value === "number"
        ? totalField.value
        : parseFloat(String(totalField.value));
      if (!isNaN(amount) && amount > 5000) {
        recommendations.push({
          id: generateId("rec"),
          type: "approval_needed",
          title: "Manager Approval Required",
          description: `Document total of $${amount.toLocaleString()} exceeds $5,000 threshold`,
          priority: amount > 25000 ? "urgent" : "high",
        });
      }
    }

    // Critical anomalies need review
    const criticalAnomalies = analysis.anomalies.filter((a) => a.severity === "critical");
    if (criticalAnomalies.length > 0) {
      recommendations.push({
        id: generateId("rec"),
        type: "review_required",
        title: "Critical Issues Detected",
        description: `${criticalAnomalies.length} critical anomal${criticalAnomalies.length === 1 ? "y" : "ies"} require immediate attention`,
        priority: "urgent",
      });
    }

    // Compliance forms with failures
    if (analysis.documentType === "compliance_form" || analysis.documentType === "inspection_report") {
      const passFailField = analysis.extractedFields.find(
        (f) => f.name.toLowerCase().includes("pass") || f.name.toLowerCase().includes("fail"),
      );
      if (passFailField && String(passFailField.value).toLowerCase().includes("fail")) {
        recommendations.push({
          id: generateId("rec"),
          type: "compliance_alert",
          title: "Compliance Failure Detected",
          description: "Document indicates a failed inspection or compliance check",
          priority: "high",
        });
      }
    }

    // Work orders may benefit from route optimization
    if (analysis.documentType === "work_order") {
      const addressField = analysis.extractedFields.find(
        (f) => f.name.toLowerCase().includes("address"),
      );
      if (addressField) {
        recommendations.push({
          id: generateId("rec"),
          type: "route_optimization",
          title: "Include in Route Optimization",
          description: "This work order can be included in daily route planning",
          priority: "low",
        });
      }
    }

    // Auto-categorize clean documents
    if (analysis.anomalies.length === 0 && analysis.confidence > 0.9) {
      recommendations.push({
        id: generateId("rec"),
        type: "auto_categorize",
        title: "Ready for Auto-Filing",
        description: "Document is clean and can be automatically categorized",
        priority: "low",
      });
    }

    // Missing information
    const missingFields = analysis.anomalies.filter((a) => a.type === "missing_required_field");
    if (missingFields.length > 0) {
      recommendations.push({
        id: generateId("rec"),
        type: "missing_information",
        title: "Complete Missing Fields",
        description: `${missingFields.length} required field${missingFields.length === 1 ? " is" : "s are"} missing`,
        priority: "medium",
      });
    }

    return recommendations;
  }
}

export function createAnalysisEngine(api: ClawdbotPluginApi, config?: AnalysisEngineConfig): AnalysisEngine {
  return new AnalysisEngine(api, config);
}
