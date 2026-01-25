/**
 * ServiceTitan Connector
 * Integrates with ServiceTitan for field service management
 */

import type { ConnectorConfig, Location, Technician } from "../../types/index.js";
import { BaseConnector, type DiscoveredFile, registerConnector } from "./base.js";

type ServiceTitanSettings = {
  tenantId?: string;
  syncJobs?: boolean;
  syncInvoices?: boolean;
  syncCustomers?: boolean;
  syncTechnicians?: boolean;
};

type STJob = {
  id: number;
  number: string;
  status: string;
  jobType?: { name: string };
  customer?: {
    id: number;
    name: string;
  };
  location?: {
    id: number;
    street: string;
    city: string;
    state: string;
    zip: string;
    latitude?: number;
    longitude?: number;
  };
  technician?: {
    id: number;
    name: string;
  };
  scheduledStart?: string;
  scheduledEnd?: string;
  completedOn?: string;
  summary?: string;
  modifiedOn?: string;
};

type STInvoice = {
  id: number;
  number: string;
  status: string;
  customer?: { id: number; name: string };
  total?: number;
  balance?: number;
  invoiceDate?: string;
  dueDate?: string;
  modifiedOn?: string;
};

type STTechnician = {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  active: boolean;
};

type STResponse<T> = {
  data: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  hasMore: boolean;
};

export class ServiceTitanConnector extends BaseConnector {
  private accessToken?: string;
  private tenantId?: string;
  private settings: ServiceTitanSettings;
  private baseUrl = "https://api.servicetitan.io";

  constructor(config: ConnectorConfig) {
    super(config);
    this.settings = (config.settings ?? {}) as ServiceTitanSettings;
    this.tenantId = this.settings.tenantId;

    if (config.credentials?.type === "oauth") {
      this.accessToken = config.credentials.accessToken;
    } else if (config.credentials?.type === "api_key") {
      this.accessToken = config.credentials.apiKey;
    }
  }

  async connect(): Promise<void> {
    if (!this.accessToken || !this.tenantId) {
      this.setStatus("pending_auth", "API credentials and tenant ID required");
      throw new Error("API credentials and tenant ID required for ServiceTitan");
    }

    const valid = await this.testConnection();
    if (!valid) {
      this.setStatus("error", "Failed to connect to ServiceTitan");
      throw new Error("Failed to connect to ServiceTitan");
    }

    this.setStatus("connected");
  }

  async disconnect(): Promise<void> {
    this.setStatus("disconnected");
  }

  async testConnection(): Promise<boolean> {
    if (!this.accessToken || !this.tenantId) return false;

    try {
      const response = await fetch(
        `${this.baseUrl}/jpm/v2/tenant/${this.tenantId}/jobs?pageSize=1`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "ST-App-Key": this.accessToken,
          },
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async *discoverFiles(options?: { since?: Date; limit?: number }): AsyncGenerator<DiscoveredFile> {
    if (!this.accessToken || !this.tenantId) {
      throw new Error("Not connected to ServiceTitan");
    }

    const limit = options?.limit ?? 500;
    let count = 0;

    // Sync jobs/work orders
    if (this.settings.syncJobs !== false) {
      for await (const file of this.fetchJobs(options?.since)) {
        yield file;
        count++;
        if (count >= limit) return;
      }
    }

    // Sync invoices
    if (this.settings.syncInvoices !== false) {
      for await (const file of this.fetchInvoices(options?.since)) {
        yield file;
        count++;
        if (count >= limit) return;
      }
    }
  }

  private async *fetchJobs(since?: Date): AsyncGenerator<DiscoveredFile> {
    let page = 1;
    const pageSize = 50;

    while (true) {
      const url = new URL(`${this.baseUrl}/jpm/v2/tenant/${this.tenantId}/jobs`);
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(pageSize));
      if (since) {
        url.searchParams.set("modifiedOnOrAfter", since.toISOString());
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "ST-App-Key": this.accessToken!,
        },
      });

      if (!response.ok) {
        throw new Error(`ServiceTitan jobs query failed: ${response.status}`);
      }

      const data = (await response.json()) as STResponse<STJob>;

      for (const job of data.data) {
        yield {
          externalId: `job_${job.id}`,
          name: `WorkOrder_${job.number}.json`,
          mimeType: "application/json",
          size: JSON.stringify(job).length,
          modifiedAt: job.modifiedOn ?? new Date().toISOString(),
          metadata: {
            type: "work_order",
            jobNumber: job.number,
            status: job.status,
            jobType: job.jobType?.name,
            customerName: job.customer?.name,
            technicianName: job.technician?.name,
            scheduledStart: job.scheduledStart,
            address: job.location
              ? `${job.location.street}, ${job.location.city}, ${job.location.state} ${job.location.zip}`
              : undefined,
          },
        };
      }

      if (!data.hasMore) break;
      page++;
    }
  }

  private async *fetchInvoices(since?: Date): AsyncGenerator<DiscoveredFile> {
    let page = 1;
    const pageSize = 50;

    while (true) {
      const url = new URL(`${this.baseUrl}/accounting/v2/tenant/${this.tenantId}/invoices`);
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(pageSize));
      if (since) {
        url.searchParams.set("modifiedOnOrAfter", since.toISOString());
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "ST-App-Key": this.accessToken!,
        },
      });

      if (!response.ok) {
        throw new Error(`ServiceTitan invoices query failed: ${response.status}`);
      }

      const data = (await response.json()) as STResponse<STInvoice>;

      for (const invoice of data.data) {
        yield {
          externalId: `invoice_${invoice.id}`,
          name: `Invoice_${invoice.number}.json`,
          mimeType: "application/json",
          size: JSON.stringify(invoice).length,
          modifiedAt: invoice.modifiedOn ?? new Date().toISOString(),
          metadata: {
            type: "invoice",
            invoiceNumber: invoice.number,
            status: invoice.status,
            customerName: invoice.customer?.name,
            total: invoice.total,
            balance: invoice.balance,
            dueDate: invoice.dueDate,
          },
        };
      }

      if (!data.hasMore) break;
      page++;
    }
  }

  async downloadFile(externalId: string): Promise<Buffer> {
    if (!this.accessToken || !this.tenantId) {
      throw new Error("Not connected to ServiceTitan");
    }

    const [type, id] = externalId.split("_");
    let endpoint: string;

    switch (type) {
      case "job":
        endpoint = `jpm/v2/tenant/${this.tenantId}/jobs/${id}`;
        break;
      case "invoice":
        endpoint = `accounting/v2/tenant/${this.tenantId}/invoices/${id}`;
        break;
      default:
        throw new Error(`Unknown entity type: ${type}`);
    }

    const response = await fetch(`${this.baseUrl}/${endpoint}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "ST-App-Key": this.accessToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${type}: ${response.status}`);
    }

    const data = await response.json();
    return Buffer.from(JSON.stringify(data, null, 2));
  }

  /**
   * Get technicians for route optimization
   */
  async getTechnicians(): Promise<Technician[]> {
    if (!this.accessToken || !this.tenantId) {
      throw new Error("Not connected to ServiceTitan");
    }

    const response = await fetch(
      `${this.baseUrl}/settings/v2/tenant/${this.tenantId}/technicians?active=true`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "ST-App-Key": this.accessToken,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch technicians: ${response.status}`);
    }

    const data = (await response.json()) as STResponse<STTechnician>;

    return data.data.map((t) => ({
      id: String(t.id),
      name: t.name,
    }));
  }

  /**
   * Get jobs for a specific date for route optimization
   */
  async getJobsForDate(date: Date): Promise<Array<{ job: STJob; location: Location }>> {
    if (!this.accessToken || !this.tenantId) {
      throw new Error("Not connected to ServiceTitan");
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const url = new URL(`${this.baseUrl}/jpm/v2/tenant/${this.tenantId}/jobs`);
    url.searchParams.set("scheduledStartOnOrAfter", startOfDay.toISOString());
    url.searchParams.set("scheduledStartBefore", endOfDay.toISOString());
    url.searchParams.set("pageSize", "100");

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "ST-App-Key": this.accessToken,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch jobs: ${response.status}`);
    }

    const data = (await response.json()) as STResponse<STJob>;

    return data.data
      .filter((job) => job.location?.latitude && job.location?.longitude)
      .map((job) => ({
        job,
        location: {
          id: String(job.location!.id),
          name: job.customer?.name,
          address: `${job.location!.street}, ${job.location!.city}, ${job.location!.state} ${job.location!.zip}`,
          latitude: job.location!.latitude!,
          longitude: job.location!.longitude!,
          serviceTimeMinutes: 60, // Default service time
          timeWindow: job.scheduledStart && job.scheduledEnd
            ? { start: job.scheduledStart, end: job.scheduledEnd }
            : undefined,
        },
      }));
  }

  /**
   * Update job assignment
   */
  async assignJob(jobId: string, technicianId: string): Promise<void> {
    if (!this.accessToken || !this.tenantId) {
      throw new Error("Not connected to ServiceTitan");
    }

    const response = await fetch(
      `${this.baseUrl}/jpm/v2/tenant/${this.tenantId}/jobs/${jobId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "ST-App-Key": this.accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          technicianId: parseInt(technicianId, 10),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to assign job: ${response.status}`);
    }
  }
}

// Register the connector
registerConnector("servicetitan", (config) => new ServiceTitanConnector(config));

export function createServiceTitanConnector(config: ConnectorConfig): ServiceTitanConnector {
  return new ServiceTitanConnector(config);
}
