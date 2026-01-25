/**
 * Agent Mode - Background Automation System
 *
 * Connects to external tools and runs 24/7 in the background,
 * automatically processing documents, detecting issues, and
 * optimizing operations without manual intervention.
 */

// Connectors for external tools
export * from "./connectors/index.js";

// Background processors
export * from "./processors/index.js";

// Route optimization
export { RouteOptimizer, createRouteOptimizer, type RouteOptimizerConfig } from "./optimizers/route-optimizer.js";
