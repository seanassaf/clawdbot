/**
 * Route Optimizer - AI-Powered Technician Route Optimization
 * Optimizes daily routes for field service technicians
 */

import type { ClawdbotPluginApi } from "../../../../src/plugins/types.js";
import type {
  Location,
  Technician,
  OptimizedRoute,
  RouteStop,
  RouteOptimizationResult,
} from "../../types/index.js";
import { stripCodeFences, safeJsonParse } from "../../utils.js";

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
    // Fallback
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

export type RouteOptimizerConfig = {
  provider?: "ai" | "google_maps" | "openrouteservice";
  apiKey?: string;
  defaultServiceTimeMinutes?: number;
  maxDrivingMinutesPerDay?: number;
};

type DistanceMatrix = {
  origins: string[];
  destinations: string[];
  distances: number[][]; // kilometers
  durations: number[][]; // minutes
};

const ROUTE_OPTIMIZATION_PROMPT = `You are an expert route optimization AI for field service operations.
Given a list of job locations and available technicians, create optimal routes that:
1. Minimize total travel distance and time
2. Respect technician work hours (shift start/end times)
3. Honor appointment time windows when specified
4. Balance workload across technicians
5. Consider technician skills if specified

Return ONLY valid JSON matching this schema:
{
  "routes": [
    {
      "technicianId": "<string>",
      "stops": [
        {
          "locationId": "<string>",
          "arrivalTime": "<ISO datetime>",
          "departureTime": "<ISO datetime>",
          "sequence": <number 1-based>
        }
      ],
      "totalDistanceKm": <number>,
      "totalDurationMinutes": <number>
    }
  ],
  "unassignedLocations": [
    {
      "id": "<string>",
      "reason": "<why unassigned>"
    }
  ],
  "savingsVsManual": {
    "distanceKm": <estimated savings>,
    "durationMinutes": <estimated time savings>
  }
}`;

export class RouteOptimizer {
  private api: ClawdbotPluginApi;
  private config: RouteOptimizerConfig;

  constructor(api: ClawdbotPluginApi, config: RouteOptimizerConfig = {}) {
    this.api = api;
    this.config = {
      provider: "ai",
      defaultServiceTimeMinutes: 60,
      maxDrivingMinutesPerDay: 480, // 8 hours
      ...config,
    };
  }

  /**
   * Optimize routes for a set of locations and technicians
   */
  async optimizeRoutes(
    locations: Location[],
    technicians: Technician[],
    date: Date,
  ): Promise<RouteOptimizationResult> {
    if (locations.length === 0) {
      return {
        routes: [],
        unassignedLocations: [],
      };
    }

    if (technicians.length === 0) {
      return {
        routes: [],
        unassignedLocations: locations,
      };
    }

    // Use AI-based optimization
    return this.optimizeWithAI(locations, technicians, date);
  }

  private async optimizeWithAI(
    locations: Location[],
    technicians: Technician[],
    date: Date,
  ): Promise<RouteOptimizationResult> {
    const runner = await loadRunner();

    const locationsJson = JSON.stringify(
      locations.map((l) => ({
        id: l.id,
        name: l.name,
        address: l.address,
        lat: l.latitude,
        lng: l.longitude,
        serviceTimeMinutes: l.serviceTimeMinutes ?? this.config.defaultServiceTimeMinutes,
        timeWindow: l.timeWindow,
      })),
      null,
      2,
    );

    const techniciansJson = JSON.stringify(
      technicians.map((t) => ({
        id: t.id,
        name: t.name,
        skills: t.skills,
        homeBase: t.homeBase
          ? {
              lat: t.homeBase.latitude,
              lng: t.homeBase.longitude,
              address: t.homeBase.address,
            }
          : undefined,
        maxStops: t.maxStops,
        shiftStart: t.shiftStart ?? "08:00",
        shiftEnd: t.shiftEnd ?? "17:00",
      })),
      null,
      2,
    );

    const prompt = `${ROUTE_OPTIMIZATION_PROMPT}

DATE: ${date.toISOString().split("T")[0]}

LOCATIONS TO VISIT:
${locationsJson}

AVAILABLE TECHNICIANS:
${techniciansJson}

CONSTRAINTS:
- Maximum driving time per technician: ${this.config.maxDrivingMinutesPerDay} minutes
- Default service time at each location: ${this.config.defaultServiceTimeMinutes} minutes

Optimize the routes and return the JSON result:`;

    const result = await runner({
      sessionId: `nexus-route-${Date.now()}`,
      sessionFile: "",
      workspaceDir: this.api.config?.agents?.defaults?.workspace ?? process.cwd(),
      config: this.api.config,
      prompt,
      timeoutMs: 90000,
      runId: `nexus-route-${Date.now()}`,
      provider: "anthropic",
      model: "claude-opus-4-5",
      disableTools: true,
      streamParams: { maxTokens: 8192 },
    });

    const text = collectText((result as Record<string, unknown>).payloads as Array<{ text?: string; isError?: boolean }>);
    const parsed = safeJsonParse<{
      routes: Array<{
        technicianId: string;
        stops: Array<{
          locationId: string;
          arrivalTime: string;
          departureTime: string;
          sequence: number;
        }>;
        totalDistanceKm: number;
        totalDurationMinutes: number;
      }>;
      unassignedLocations: Array<{ id: string; reason?: string }>;
      savingsVsManual?: { distanceKm: number; durationMinutes: number };
    }>(stripCodeFences(text), null as unknown as ReturnType<typeof safeJsonParse>);

    if (!parsed) {
      throw new Error("Failed to parse route optimization result");
    }

    // Map back to full types
    const locationMap = new Map(locations.map((l) => [l.id, l]));

    const routes: OptimizedRoute[] = parsed.routes.map((r) => ({
      technicianId: r.technicianId,
      stops: r.stops.map((s) => {
        const location = locationMap.get(s.locationId);
        return {
          location: location ?? {
            id: s.locationId,
            address: "Unknown",
            latitude: 0,
            longitude: 0,
          },
          arrivalTime: s.arrivalTime,
          departureTime: s.departureTime,
          sequence: s.sequence,
        };
      }),
      totalDistanceKm: r.totalDistanceKm,
      totalDurationMinutes: r.totalDurationMinutes,
    }));

    const unassignedLocations = parsed.unassignedLocations
      .map((u) => locationMap.get(u.id))
      .filter((l): l is Location => l !== undefined);

    return {
      routes,
      unassignedLocations,
      savingsVsManual: parsed.savingsVsManual,
    };
  }

  /**
   * Calculate estimated driving distance between two points
   * Uses Haversine formula for rough estimates
   */
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Build a simple distance matrix for a set of locations
   */
  buildDistanceMatrix(locations: Location[]): DistanceMatrix {
    const n = locations.length;
    const distances: number[][] = [];
    const durations: number[][] = [];
    const avgSpeed = 40; // km/h average speed

    for (let i = 0; i < n; i++) {
      distances[i] = [];
      durations[i] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          distances[i][j] = 0;
          durations[i][j] = 0;
        } else {
          const dist = this.calculateDistance(
            locations[i]!.latitude,
            locations[i]!.longitude,
            locations[j]!.latitude,
            locations[j]!.longitude,
          );
          distances[i][j] = dist;
          durations[i][j] = (dist / avgSpeed) * 60; // minutes
        }
      }
    }

    return {
      origins: locations.map((l) => l.id),
      destinations: locations.map((l) => l.id),
      distances,
      durations,
    };
  }

  /**
   * Simple nearest-neighbor heuristic for quick route generation
   */
  nearestNeighborRoute(
    locations: Location[],
    startLocation?: Location,
  ): Location[] {
    if (locations.length <= 1) return locations;

    const unvisited = new Set(locations);
    const route: Location[] = [];

    let current = startLocation ?? locations[0]!;
    if (startLocation) {
      route.push(current);
    } else {
      route.push(current);
      unvisited.delete(current);
    }

    while (unvisited.size > 0) {
      let nearest: Location | null = null;
      let nearestDist = Infinity;

      for (const loc of unvisited) {
        const dist = this.calculateDistance(
          current.latitude,
          current.longitude,
          loc.latitude,
          loc.longitude,
        );
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = loc;
        }
      }

      if (nearest) {
        route.push(nearest);
        unvisited.delete(nearest);
        current = nearest;
      } else {
        break;
      }
    }

    return route;
  }
}

export function createRouteOptimizer(
  api: ClawdbotPluginApi,
  config?: RouteOptimizerConfig,
): RouteOptimizer {
  return new RouteOptimizer(api, config);
}
