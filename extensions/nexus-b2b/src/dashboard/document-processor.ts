/**
 * Document Processor for Dashboard Mode
 * Handles file uploads, content extraction, and coordinates analysis
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import type { ClawdbotPluginApi } from "../../../../src/plugins/types.js";
import type {
  Document,
  DocumentSource,
  DocumentAnalysis,
  DocumentStatus,
  DashboardConfig,
} from "../types/index.js";
import { generateId, isAllowedMimeType, guessMimeType, formatFileSize } from "../utils.js";
import { createAnalysisEngine, type AnalysisEngine } from "./analysis-engine.js";

export type ProcessorConfig = DashboardConfig & {
  storageDir?: string;
};

export type UploadResult = {
  document: Document;
  analysis?: DocumentAnalysis;
  error?: string;
};

export type DocumentStore = {
  documents: Map<string, Document>;
  save: () => Promise<void>;
  load: () => Promise<void>;
};

export class DocumentProcessor {
  private api: ClawdbotPluginApi;
  private config: ProcessorConfig;
  private analysisEngine: AnalysisEngine;
  private documents: Map<string, Document>;
  private storageDir: string;

  constructor(api: ClawdbotPluginApi, config: ProcessorConfig = {}) {
    this.api = api;
    this.config = {
      enabled: true,
      maxFileSizeMb: 50,
      allowedMimeTypes: [
        "application/pdf",
        "image/*",
        "text/plain",
        "text/csv",
        "application/json",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
      ],
      analysisTimeoutSeconds: 60,
      ...config,
    };
    this.analysisEngine = createAnalysisEngine(api, {
      defaultModel: config.defaultModel,
      timeoutMs: (config.analysisTimeoutSeconds ?? 60) * 1000,
    });
    this.documents = new Map();
    this.storageDir = config.storageDir ?? path.join(os.homedir(), ".clawdbot", "nexus-b2b", "documents");
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
    await this.loadDocuments();
  }

  private async loadDocuments(): Promise<void> {
    const indexPath = path.join(this.storageDir, "index.json");
    try {
      const data = await fs.readFile(indexPath, "utf8");
      const docs = JSON.parse(data) as Document[];
      for (const doc of docs) {
        this.documents.set(doc.id, doc);
      }
    } catch {
      // No existing index, start fresh
    }
  }

  private async saveDocuments(): Promise<void> {
    const indexPath = path.join(this.storageDir, "index.json");
    const docs = Array.from(this.documents.values());
    await fs.writeFile(indexPath, JSON.stringify(docs, null, 2));
  }

  /**
   * Process a file from a buffer
   */
  async processBuffer(
    buffer: Buffer,
    fileName: string,
    source: DocumentSource,
    mimeType?: string,
  ): Promise<UploadResult> {
    const resolvedMime = mimeType ?? guessMimeType(fileName);

    // Validate file size
    const maxBytes = (this.config.maxFileSizeMb ?? 50) * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return {
        document: this.createPendingDocument(fileName, resolvedMime, buffer.length, source),
        error: `File size ${formatFileSize(buffer.length)} exceeds maximum ${formatFileSize(maxBytes)}`,
      };
    }

    // Validate MIME type
    if (!isAllowedMimeType(resolvedMime, this.config.allowedMimeTypes)) {
      return {
        document: this.createPendingDocument(fileName, resolvedMime, buffer.length, source),
        error: `File type ${resolvedMime} is not allowed`,
      };
    }

    const doc = this.createPendingDocument(fileName, resolvedMime, buffer.length, source);
    this.documents.set(doc.id, doc);

    try {
      // Update status to processing
      doc.status = "processing";
      await this.saveDocuments();

      // Extract content based on MIME type
      const content = await this.extractContent(buffer, resolvedMime, fileName);

      // Run AI analysis
      const analysis = await this.analysisEngine.analyzeDocument({
        content,
        fileName,
        mimeType: resolvedMime,
      });

      doc.analysis = analysis;
      doc.status = analysis.anomalies.some((a) => a.severity === "critical" || a.severity === "high")
        ? "flagged"
        : "analyzed";

      await this.saveDocuments();

      return { document: doc, analysis };
    } catch (err) {
      doc.status = "pending";
      await this.saveDocuments();
      return {
        document: doc,
        error: err instanceof Error ? err.message : "Analysis failed",
      };
    }
  }

  /**
   * Process a file from the filesystem
   */
  async processFile(filePath: string, source?: DocumentSource): Promise<UploadResult> {
    const stats = await fs.stat(filePath);
    const buffer = await fs.readFile(filePath);
    const fileName = path.basename(filePath);

    return this.processBuffer(
      buffer,
      fileName,
      source ?? { type: "upload" },
      guessMimeType(fileName),
    );
  }

  /**
   * Extract text content from various file types
   */
  private async extractContent(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    const normalizedMime = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";

    // Plain text files
    if (normalizedMime.startsWith("text/") || normalizedMime === "application/json") {
      return buffer.toString("utf8");
    }

    // PDF files - use pdfjs-dist if available
    if (normalizedMime === "application/pdf") {
      return await this.extractPdfContent(buffer);
    }

    // Images - generate description using media understanding
    if (normalizedMime.startsWith("image/")) {
      return await this.describeImage(buffer, fileName, normalizedMime);
    }

    // Excel/Spreadsheet - extract basic text representation
    if (
      normalizedMime.includes("spreadsheet") ||
      normalizedMime.includes("excel") ||
      normalizedMime === "application/vnd.ms-excel"
    ) {
      return await this.extractSpreadsheetContent(buffer);
    }

    // Fallback - treat as binary and note the type
    return `[Binary file: ${fileName}, type: ${mimeType}, size: ${formatFileSize(buffer.length)}]`;
  }

  private async extractPdfContent(buffer: Buffer): Promise<string> {
    try {
      // Dynamically import pdfjs-dist
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const doc = await pdfjsLib.getDocument({ data: buffer }).promise;

      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
          .map((item: { str?: string }) => item.str ?? "")
          .join(" ");
        pages.push(`[Page ${i}]\n${text}`);
      }

      return pages.join("\n\n");
    } catch {
      return "[Unable to extract PDF content - may be image-based PDF]";
    }
  }

  private async describeImage(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<string> {
    // Use the analysis engine to describe the image
    const base64 = buffer.toString("base64");
    return `[Image: ${fileName}]\nBase64 preview available for vision analysis.\nSize: ${formatFileSize(buffer.length)}\nType: ${mimeType}\n\n[IMAGE_DATA:${base64.slice(0, 1000)}...]`;
  }

  private async extractSpreadsheetContent(buffer: Buffer): Promise<string> {
    try {
      // Dynamically import xlsx
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer" });

      const sheets: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const csv = XLSX.utils.sheet_to_csv(sheet);
        sheets.push(`[Sheet: ${sheetName}]\n${csv}`);
      }

      return sheets.join("\n\n");
    } catch {
      return "[Unable to extract spreadsheet content]";
    }
  }

  private createPendingDocument(
    fileName: string,
    mimeType: string,
    size: number,
    source: DocumentSource,
  ): Document {
    return {
      id: generateId("doc"),
      fileName,
      mimeType,
      size,
      status: "pending",
      uploadedAt: new Date().toISOString(),
      source,
    };
  }

  /**
   * Get a document by ID
   */
  getDocument(id: string): Document | undefined {
    return this.documents.get(id);
  }

  /**
   * List all documents with optional filtering
   */
  listDocuments(filter?: {
    status?: DocumentStatus;
    type?: string;
    limit?: number;
    offset?: number;
  }): Document[] {
    let docs = Array.from(this.documents.values());

    if (filter?.status) {
      docs = docs.filter((d) => d.status === filter.status);
    }

    if (filter?.type) {
      docs = docs.filter((d) => d.analysis?.documentType === filter.type);
    }

    // Sort by upload date, newest first
    docs.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

    const offset = filter?.offset ?? 0;
    const limit = filter?.limit ?? 100;

    return docs.slice(offset, offset + limit);
  }

  /**
   * Update document status
   */
  async updateStatus(id: string, status: DocumentStatus): Promise<Document | undefined> {
    const doc = this.documents.get(id);
    if (!doc) return undefined;

    doc.status = status;
    await this.saveDocuments();
    return doc;
  }

  /**
   * Delete a document
   */
  async deleteDocument(id: string): Promise<boolean> {
    const deleted = this.documents.delete(id);
    if (deleted) {
      await this.saveDocuments();
    }
    return deleted;
  }

  /**
   * Re-analyze an existing document
   */
  async reanalyze(id: string): Promise<UploadResult | undefined> {
    const doc = this.documents.get(id);
    if (!doc) return undefined;

    // For now, we can't re-analyze without the original content
    // In a full implementation, we'd store the extracted content
    return {
      document: doc,
      error: "Re-analysis requires original document content",
    };
  }

  /**
   * Get statistics about processed documents
   */
  getStats(): {
    total: number;
    byStatus: Record<DocumentStatus, number>;
    byType: Record<string, number>;
    avgProcessingTimeMs: number;
    flaggedCount: number;
  } {
    const docs = Array.from(this.documents.values());

    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let totalProcessingTime = 0;
    let processedCount = 0;

    for (const doc of docs) {
      // Count by status
      byStatus[doc.status] = (byStatus[doc.status] ?? 0) + 1;

      // Count by type
      if (doc.analysis?.documentType) {
        byType[doc.analysis.documentType] = (byType[doc.analysis.documentType] ?? 0) + 1;
      }

      // Track processing time
      if (doc.analysis?.processingTimeMs) {
        totalProcessingTime += doc.analysis.processingTimeMs;
        processedCount++;
      }
    }

    return {
      total: docs.length,
      byStatus: byStatus as Record<DocumentStatus, number>,
      byType,
      avgProcessingTimeMs: processedCount > 0 ? totalProcessingTime / processedCount : 0,
      flaggedCount: byStatus.flagged ?? 0,
    };
  }
}

export function createDocumentProcessor(
  api: ClawdbotPluginApi,
  config?: ProcessorConfig,
): DocumentProcessor {
  return new DocumentProcessor(api, config);
}
