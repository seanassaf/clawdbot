/**
 * Embedded Mode - API Access for Third-Party Integration
 *
 * Provides RESTful API endpoints that software vendors can use
 * to build Nexus AI capabilities directly into their own products.
 */

export { ApiRouter, createApiRouter, type ApiContext, type ApiResponse } from "./api-router.js";
export { WebhookManager, createWebhookManager, type WebhookPayload, type WebhookDeliveryResult } from "./webhooks.js";
