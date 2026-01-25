/**
 * Webhook System for Embedded Mode
 * Sends event notifications to configured webhook endpoints
 */

import { createHmac } from "node:crypto";
import type { WebhookConfig, WebhookEvent, NexusEvent } from "../types/index.js";
import { retryWithBackoff } from "../utils.js";

export type WebhookPayload = {
  id: string;
  event: WebhookEvent;
  timestamp: string;
  data: unknown;
};

export type WebhookDeliveryResult = {
  webhookId: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  duration: number;
};

export class WebhookManager {
  private webhooks: Map<string, WebhookConfig> = new Map();
  private deliveryLog: WebhookDeliveryResult[] = [];
  private maxLogEntries = 1000;

  constructor(webhooks?: WebhookConfig[]) {
    for (const webhook of webhooks ?? []) {
      this.webhooks.set(webhook.id, webhook);
    }
  }

  /**
   * Add a webhook configuration
   */
  addWebhook(config: WebhookConfig): void {
    this.webhooks.set(config.id, config);
  }

  /**
   * Remove a webhook
   */
  removeWebhook(id: string): boolean {
    return this.webhooks.delete(id);
  }

  /**
   * Update a webhook
   */
  updateWebhook(id: string, updates: Partial<WebhookConfig>): boolean {
    const existing = this.webhooks.get(id);
    if (!existing) return false;
    this.webhooks.set(id, { ...existing, ...updates, id });
    return true;
  }

  /**
   * List all webhooks
   */
  listWebhooks(): WebhookConfig[] {
    return Array.from(this.webhooks.values());
  }

  /**
   * Dispatch an event to all matching webhooks
   */
  async dispatch(event: NexusEvent): Promise<WebhookDeliveryResult[]> {
    const webhookEvent = this.mapEventType(event);
    if (!webhookEvent) return [];

    const matchingWebhooks = Array.from(this.webhooks.values()).filter(
      (w) => w.enabled !== false && w.events.includes(webhookEvent),
    );

    const results = await Promise.all(
      matchingWebhooks.map((webhook) => this.deliver(webhook, webhookEvent, event)),
    );

    // Log results
    for (const result of results) {
      this.deliveryLog.push(result);
      if (this.deliveryLog.length > this.maxLogEntries) {
        this.deliveryLog.shift();
      }
    }

    return results;
  }

  private mapEventType(event: NexusEvent): WebhookEvent | null {
    switch (event.type) {
      case "document.uploaded":
        return "document.uploaded";
      case "document.analyzed":
        return "document.analyzed";
      case "document.flagged":
        return "document.flagged";
      case "task.completed":
        return "task.completed";
      case "task.failed":
        return "task.failed";
      case "connector.synced":
        return "connector.synced";
      case "anomaly.detected":
        return "anomaly.detected";
      default:
        return null;
    }
  }

  private async deliver(
    webhook: WebhookConfig,
    eventType: WebhookEvent,
    event: NexusEvent,
  ): Promise<WebhookDeliveryResult> {
    const startTime = Date.now();
    const payload: WebhookPayload = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      event: eventType,
      timestamp: new Date().toISOString(),
      data: event,
    };

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Nexus-Event": eventType,
      "X-Nexus-Delivery": payload.id,
    };

    // Add signature if secret is configured
    if (webhook.secret) {
      const signature = this.sign(body, webhook.secret);
      headers["X-Nexus-Signature"] = signature;
    }

    try {
      const response = await retryWithBackoff(
        async () => {
          const res = await fetch(webhook.url, {
            method: "POST",
            headers,
            body,
            signal: AbortSignal.timeout(30000),
          });

          if (!res.ok && res.status >= 500) {
            throw new Error(`Server error: ${res.status}`);
          }

          return res;
        },
        {
          maxRetries: 3,
          initialDelayMs: 1000,
        },
      );

      return {
        webhookId: webhook.id,
        success: response.ok,
        statusCode: response.status,
        duration: Date.now() - startTime,
      };
    } catch (err) {
      return {
        webhookId: webhook.id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - startTime,
      };
    }
  }

  private sign(payload: string, secret: string): string {
    return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  }

  /**
   * Get delivery log
   */
  getDeliveryLog(limit = 100): WebhookDeliveryResult[] {
    return this.deliveryLog.slice(-limit);
  }

  /**
   * Get delivery stats
   */
  getStats(): {
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    avgDurationMs: number;
    byWebhook: Record<string, { success: number; failed: number }>;
  } {
    const byWebhook: Record<string, { success: number; failed: number }> = {};
    let successful = 0;
    let totalDuration = 0;

    for (const result of this.deliveryLog) {
      if (!byWebhook[result.webhookId]) {
        byWebhook[result.webhookId] = { success: 0, failed: 0 };
      }

      if (result.success) {
        successful++;
        byWebhook[result.webhookId]!.success++;
      } else {
        byWebhook[result.webhookId]!.failed++;
      }

      totalDuration += result.duration;
    }

    return {
      totalDeliveries: this.deliveryLog.length,
      successfulDeliveries: successful,
      failedDeliveries: this.deliveryLog.length - successful,
      avgDurationMs: this.deliveryLog.length > 0 ? totalDuration / this.deliveryLog.length : 0,
      byWebhook,
    };
  }

  /**
   * Test a webhook by sending a test event
   */
  async testWebhook(webhookId: string): Promise<WebhookDeliveryResult> {
    const webhook = this.webhooks.get(webhookId);
    if (!webhook) {
      return {
        webhookId,
        success: false,
        error: "Webhook not found",
        duration: 0,
      };
    }

    const testEvent: NexusEvent = {
      type: "document.uploaded",
      document: {
        id: "test_doc",
        fileName: "test.pdf",
        mimeType: "application/pdf",
        size: 1024,
        status: "pending",
        uploadedAt: new Date().toISOString(),
        source: { type: "api", clientId: "test" },
      },
    };

    return this.deliver(webhook, "document.uploaded", testEvent);
  }
}

export function createWebhookManager(webhooks?: WebhookConfig[]): WebhookManager {
  return new WebhookManager(webhooks);
}
