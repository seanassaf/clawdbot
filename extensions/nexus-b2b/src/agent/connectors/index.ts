/**
 * Connectors Index
 * Re-exports all connector implementations and utilities
 */

// Base connector infrastructure
export {
  BaseConnector,
  registerConnector,
  createConnector,
  getConnectorTypes,
  type DiscoveredFile,
  type SyncResult,
  type ConnectorEvent,
  type ConnectorEventHandler,
  type ConnectorFactory,
} from "./base.js";

// Connector implementations
export { GoogleDriveConnector, createGoogleDriveConnector } from "./google-drive.js";
export { QuickBooksConnector, createQuickBooksConnector } from "./quickbooks.js";
export { ServiceTitanConnector, createServiceTitanConnector } from "./servicetitan.js";

// Import to register connectors
import "./google-drive.js";
import "./quickbooks.js";
import "./servicetitan.js";
