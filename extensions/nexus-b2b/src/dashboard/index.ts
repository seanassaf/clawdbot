/**
 * Dashboard Mode - Document Processing and AI Analysis
 *
 * Provides drag-and-drop document processing with instant AI analysis,
 * categorization, anomaly detection, and actionable recommendations.
 */

export { AnalysisEngine, createAnalysisEngine, type AnalysisEngineConfig, type AnalysisInput } from "./analysis-engine.js";
export { DocumentProcessor, createDocumentProcessor, type ProcessorConfig, type UploadResult } from "./document-processor.js";
export { getWebDashboardHtml } from "./web-ui.js";
