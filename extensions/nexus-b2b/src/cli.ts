/**
 * CLI Commands for Nexus B2B Platform
 * Provides command-line interface for document analysis, connector management, and more
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";

import type { ClawdbotPluginCliContext } from "../../../src/plugins/types.js";
import type { NexusB2BConfig } from "./types/index.js";
import { createDocumentProcessor } from "./dashboard/index.js";
import { createTaskManager, createDocumentWatcher, getConnectorTypes } from "./agent/index.js";
import { createRouteOptimizer } from "./agent/optimizers/route-optimizer.js";
import { formatFileSize, formatDuration } from "./utils.js";

export function registerNexusCli(ctx: ClawdbotPluginCliContext): void {
  const { program, config, logger } = ctx;

  const nexus = program
    .command("nexus")
    .description("Nexus B2B automation platform commands");

  // ==========================================================================
  // Document Analysis Commands
  // ==========================================================================

  const docs = nexus
    .command("docs")
    .description("Document processing and analysis");

  docs
    .command("analyze <file>")
    .description("Analyze a document using AI")
    .option("-o, --output <format>", "Output format (json, text)", "text")
    .action(async (file: string, options: { output: string }) => {
      const filePath = path.resolve(file);

      try {
        const stats = await fs.stat(filePath);
        logger.info(`Analyzing ${path.basename(filePath)} (${formatFileSize(stats.size)})...`);

        const processor = createDocumentProcessor(
          { config, logger } as any,
          (config.plugins?.["nexus-b2b"] as NexusB2BConfig)?.dashboard,
        );
        await processor.initialize();

        const result = await processor.processFile(filePath);

        if (result.error) {
          logger.error(`Analysis failed: ${result.error}`);
          process.exit(1);
        }

        if (options.output === "json") {
          console.log(JSON.stringify(result.analysis, null, 2));
        } else {
          console.log("\n=== Document Analysis ===\n");
          console.log(`Type: ${result.analysis?.documentType} (${Math.round((result.analysis?.confidence ?? 0) * 100)}% confidence)`);
          console.log(`Processing time: ${formatDuration(result.analysis?.processingTimeMs ?? 0)}`);
          console.log(`\nSummary: ${result.analysis?.summary}\n`);

          if (result.analysis?.extractedFields?.length) {
            console.log("Extracted Fields:");
            for (const field of result.analysis.extractedFields) {
              console.log(`  - ${field.name}: ${field.value} (${Math.round(field.confidence * 100)}%)`);
            }
            console.log();
          }

          if (result.analysis?.anomalies?.length) {
            console.log("Anomalies Detected:");
            for (const anomaly of result.analysis.anomalies) {
              const icon = anomaly.severity === "critical" ? "🚨" : anomaly.severity === "high" ? "⚠️" : "ℹ️";
              console.log(`  ${icon} [${anomaly.severity.toUpperCase()}] ${anomaly.description}`);
            }
            console.log();
          }

          if (result.analysis?.recommendations?.length) {
            console.log("Recommendations:");
            for (const rec of result.analysis.recommendations) {
              console.log(`  - [${rec.priority.toUpperCase()}] ${rec.title}: ${rec.description}`);
            }
          }
        }
      } catch (err) {
        logger.error(`Failed to analyze file: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  docs
    .command("list")
    .description("List processed documents")
    .option("-s, --status <status>", "Filter by status")
    .option("-t, --type <type>", "Filter by document type")
    .option("-l, --limit <n>", "Limit results", "20")
    .action(async (options: { status?: string; type?: string; limit: string }) => {
      const processor = createDocumentProcessor(
        { config, logger } as any,
        (config.plugins?.["nexus-b2b"] as NexusB2BConfig)?.dashboard,
      );
      await processor.initialize();

      const docs = processor.listDocuments({
        status: options.status as any,
        type: options.type,
        limit: parseInt(options.limit, 10),
      });

      if (docs.length === 0) {
        console.log("No documents found.");
        return;
      }

      console.log("\nProcessed Documents:\n");
      console.log("ID                         | Status     | Type           | File Name");
      console.log("-".repeat(80));

      for (const doc of docs) {
        const type = doc.analysis?.documentType ?? "pending";
        console.log(
          `${doc.id.padEnd(26)} | ${doc.status.padEnd(10)} | ${type.padEnd(14)} | ${doc.fileName}`,
        );
      }

      console.log(`\nTotal: ${docs.length} documents`);
    });

  docs
    .command("stats")
    .description("Show document processing statistics")
    .action(async () => {
      const processor = createDocumentProcessor(
        { config, logger } as any,
        (config.plugins?.["nexus-b2b"] as NexusB2BConfig)?.dashboard,
      );
      await processor.initialize();

      const stats = processor.getStats();

      console.log("\n=== Document Statistics ===\n");
      console.log(`Total documents: ${stats.total}`);
      console.log(`Flagged documents: ${stats.flaggedCount}`);
      console.log(`Average processing time: ${formatDuration(stats.avgProcessingTimeMs)}`);

      console.log("\nBy Status:");
      for (const [status, count] of Object.entries(stats.byStatus)) {
        console.log(`  ${status}: ${count}`);
      }

      console.log("\nBy Type:");
      for (const [type, count] of Object.entries(stats.byType)) {
        console.log(`  ${type}: ${count}`);
      }
    });

  // ==========================================================================
  // Connector Commands
  // ==========================================================================

  const connectors = nexus
    .command("connectors")
    .description("Manage external tool connectors");

  connectors
    .command("types")
    .description("List available connector types")
    .action(() => {
      const types = getConnectorTypes();
      console.log("\nAvailable Connector Types:\n");
      for (const type of types) {
        console.log(`  - ${type}`);
      }
      console.log(`\nTotal: ${types.length} connector types`);
    });

  connectors
    .command("list")
    .description("List configured connectors")
    .action(async () => {
      const agentConfig = (config.plugins?.["nexus-b2b"] as NexusB2BConfig)?.agent;
      const connectorConfigs = agentConfig?.connectors ?? [];

      if (connectorConfigs.length === 0) {
        console.log("No connectors configured.");
        return;
      }

      console.log("\nConfigured Connectors:\n");
      console.log("ID                    | Type          | Name                | Enabled");
      console.log("-".repeat(75));

      for (const conn of connectorConfigs) {
        console.log(
          `${conn.id.padEnd(21)} | ${conn.type.padEnd(13)} | ${conn.name.padEnd(19)} | ${conn.enabled ? "Yes" : "No"}`,
        );
      }
    });

  // ==========================================================================
  // Route Optimization Commands
  // ==========================================================================

  const routes = nexus
    .command("routes")
    .description("Route optimization for field service");

  routes
    .command("optimize <locations-file>")
    .description("Optimize routes from a JSON file of locations")
    .option("-t, --technicians <file>", "Technicians JSON file")
    .option("-d, --date <date>", "Date for route planning (YYYY-MM-DD)")
    .option("-o, --output <file>", "Output file for results")
    .action(async (
      locationsFile: string,
      options: { technicians?: string; date?: string; output?: string },
    ) => {
      try {
        const locationsData = await fs.readFile(path.resolve(locationsFile), "utf8");
        const locations = JSON.parse(locationsData);

        let technicians = [{ id: "tech1", name: "Default Technician" }];
        if (options.technicians) {
          const techData = await fs.readFile(path.resolve(options.technicians), "utf8");
          technicians = JSON.parse(techData);
        }

        const optimizer = createRouteOptimizer(
          { config, logger } as any,
          (config.plugins?.["nexus-b2b"] as NexusB2BConfig)?.agent?.routeOptimization,
        );

        const date = options.date ? new Date(options.date) : new Date();

        logger.info(`Optimizing routes for ${locations.length} locations and ${technicians.length} technicians...`);

        const result = await optimizer.optimizeRoutes(locations, technicians, date);

        if (options.output) {
          await fs.writeFile(options.output, JSON.stringify(result, null, 2));
          console.log(`Results written to ${options.output}`);
        } else {
          console.log("\n=== Optimized Routes ===\n");

          for (const route of result.routes) {
            const tech = technicians.find((t) => t.id === route.technicianId);
            console.log(`\nTechnician: ${tech?.name ?? route.technicianId}`);
            console.log(`Total distance: ${route.totalDistanceKm.toFixed(1)} km`);
            console.log(`Total duration: ${route.totalDurationMinutes} minutes`);
            console.log("\nStops:");

            for (const stop of route.stops) {
              console.log(`  ${stop.sequence}. ${stop.location.name ?? stop.location.address}`);
              console.log(`     Arrival: ${stop.arrivalTime}`);
            }
          }

          if (result.unassignedLocations.length > 0) {
            console.log(`\nUnassigned locations: ${result.unassignedLocations.length}`);
          }

          if (result.savingsVsManual) {
            console.log("\nEstimated Savings:");
            console.log(`  Distance: ${result.savingsVsManual.distanceKm.toFixed(1)} km`);
            console.log(`  Time: ${result.savingsVsManual.durationMinutes} minutes`);
          }
        }
      } catch (err) {
        logger.error(`Route optimization failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  // ==========================================================================
  // API Key Management
  // ==========================================================================

  const api = nexus
    .command("api")
    .description("Embedded API management");

  api
    .command("create-key <name>")
    .description("Create a new API key")
    .option("-s, --scopes <scopes>", "Comma-separated list of scopes", "read:documents,read:analysis")
    .option("-e, --expires <days>", "Expiration in days")
    .action(async (name: string, options: { scopes: string; expires?: string }) => {
      const { generateApiKey } = await import("./utils.js");
      const { key, hash } = generateApiKey();

      const scopes = options.scopes.split(",").map((s) => s.trim());
      const expiresAt = options.expires
        ? new Date(Date.now() + parseInt(options.expires, 10) * 86400000).toISOString()
        : undefined;

      console.log("\n=== New API Key Created ===\n");
      console.log(`Name: ${name}`);
      console.log(`Key: ${key}`);
      console.log(`Scopes: ${scopes.join(", ")}`);
      if (expiresAt) console.log(`Expires: ${expiresAt}`);
      console.log("\n⚠️  Save this key - it won't be shown again!");
      console.log("\nAdd to your config:\n");
      console.log(`{
  "plugins": {
    "nexus-b2b": {
      "embedded": {
        "apiKeys": [
          {
            "id": "key_${Date.now()}",
            "name": "${name}",
            "scopes": ${JSON.stringify(scopes)}${expiresAt ? `,\n            "expiresAt": "${expiresAt}"` : ""}
          }
        ]
      }
    }
  }
}`);
    });

  // ==========================================================================
  // General Status
  // ==========================================================================

  nexus
    .command("status")
    .description("Show Nexus B2B platform status")
    .action(async () => {
      const pluginConfig = (config.plugins?.["nexus-b2b"] as NexusB2BConfig) ?? {};

      console.log("\n=== Nexus B2B Platform Status ===\n");

      // Dashboard Mode
      console.log("Dashboard Mode:");
      console.log(`  Enabled: ${pluginConfig.dashboard?.enabled !== false ? "Yes" : "No"}`);
      console.log(`  Max file size: ${pluginConfig.dashboard?.maxFileSizeMb ?? 50} MB`);
      console.log(`  Analysis timeout: ${pluginConfig.dashboard?.analysisTimeoutSeconds ?? 60}s`);

      // Agent Mode
      console.log("\nAgent Mode:");
      console.log(`  Enabled: ${pluginConfig.agent?.enabled !== false ? "Yes" : "No"}`);
      console.log(`  Connectors: ${pluginConfig.agent?.connectors?.length ?? 0}`);
      console.log(`  Background processing: ${pluginConfig.agent?.backgroundProcessing?.enabled !== false ? "Yes" : "No"}`);
      console.log(`  Route optimization: ${pluginConfig.agent?.routeOptimization?.enabled !== false ? "Yes" : "No"}`);

      // Embedded Mode
      console.log("\nEmbedded Mode:");
      console.log(`  Enabled: ${pluginConfig.embedded?.enabled !== false ? "Yes" : "No"}`);
      console.log(`  Webhooks: ${pluginConfig.embedded?.webhooks?.length ?? 0}`);

      console.log("\n✓ Nexus B2B platform is operational");
    });
}
