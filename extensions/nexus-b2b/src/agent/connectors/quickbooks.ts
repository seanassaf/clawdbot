/**
 * QuickBooks Connector
 * Integrates with QuickBooks Online for invoice and expense management
 */

import type { ConnectorConfig } from "../../types/index.js";
import { BaseConnector, type DiscoveredFile, registerConnector } from "./base.js";

type QuickBooksSettings = {
  realmId?: string;
  syncInvoices?: boolean;
  syncExpenses?: boolean;
  syncBills?: boolean;
  syncReceipts?: boolean;
};

type QBOEntity = {
  Id: string;
  DocNumber?: string;
  TxnDate?: string;
  TotalAmt?: number;
  MetaData?: {
    CreateTime?: string;
    LastUpdatedTime?: string;
  };
};

type QBOInvoice = QBOEntity & {
  CustomerRef?: { value: string; name: string };
  DueDate?: string;
  Balance?: number;
  Line?: Array<{ Description?: string; Amount?: number }>;
};

type QBOBill = QBOEntity & {
  VendorRef?: { value: string; name: string };
  DueDate?: string;
  Balance?: number;
};

type QBOPurchase = QBOEntity & {
  PaymentType?: string;
  AccountRef?: { value: string; name: string };
  EntityRef?: { value: string; name: string };
};

export class QuickBooksConnector extends BaseConnector {
  private accessToken?: string;
  private refreshToken?: string;
  private realmId?: string;
  private settings: QuickBooksSettings;
  private baseUrl = "https://quickbooks.api.intuit.com";

  constructor(config: ConnectorConfig) {
    super(config);
    this.settings = (config.settings ?? {}) as QuickBooksSettings;
    this.realmId = this.settings.realmId;

    if (config.credentials?.type === "oauth") {
      this.accessToken = config.credentials.accessToken;
      this.refreshToken = config.credentials.refreshToken;
    }
  }

  async connect(): Promise<void> {
    if (!this.accessToken || !this.realmId) {
      this.setStatus("pending_auth", "OAuth credentials and realm ID required");
      throw new Error("OAuth credentials and realm ID required for QuickBooks");
    }

    const valid = await this.testConnection();
    if (!valid) {
      this.setStatus("error", "Failed to connect to QuickBooks");
      throw new Error("Failed to connect to QuickBooks");
    }

    this.setStatus("connected");
  }

  async disconnect(): Promise<void> {
    this.setStatus("disconnected");
  }

  async testConnection(): Promise<boolean> {
    if (!this.accessToken || !this.realmId) return false;

    try {
      const response = await fetch(
        `${this.baseUrl}/v3/company/${this.realmId}/companyinfo/${this.realmId}`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            Accept: "application/json",
          },
        },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async *discoverFiles(options?: { since?: Date; limit?: number }): AsyncGenerator<DiscoveredFile> {
    if (!this.accessToken || !this.realmId) {
      throw new Error("Not connected to QuickBooks");
    }

    const limit = options?.limit ?? 500;
    let count = 0;

    // Sync invoices
    if (this.settings.syncInvoices !== false) {
      for await (const file of this.fetchInvoices(options?.since)) {
        yield file;
        count++;
        if (count >= limit) return;
      }
    }

    // Sync bills (vendor invoices)
    if (this.settings.syncBills !== false) {
      for await (const file of this.fetchBills(options?.since)) {
        yield file;
        count++;
        if (count >= limit) return;
      }
    }

    // Sync expenses/purchases
    if (this.settings.syncExpenses !== false) {
      for await (const file of this.fetchPurchases(options?.since)) {
        yield file;
        count++;
        if (count >= limit) return;
      }
    }
  }

  private async *fetchInvoices(since?: Date): AsyncGenerator<DiscoveredFile> {
    let query = "SELECT * FROM Invoice";
    if (since) {
      query += ` WHERE MetaData.LastUpdatedTime > '${since.toISOString()}'`;
    }
    query += " MAXRESULTS 100";

    const data = await this.query(query);
    const invoices = (data?.QueryResponse?.Invoice ?? []) as QBOInvoice[];

    for (const invoice of invoices) {
      yield {
        externalId: `invoice_${invoice.Id}`,
        name: `Invoice_${invoice.DocNumber ?? invoice.Id}.json`,
        mimeType: "application/json",
        size: JSON.stringify(invoice).length,
        modifiedAt: invoice.MetaData?.LastUpdatedTime ?? new Date().toISOString(),
        metadata: {
          type: "invoice",
          docNumber: invoice.DocNumber,
          customerName: invoice.CustomerRef?.name,
          totalAmount: invoice.TotalAmt,
          balance: invoice.Balance,
          dueDate: invoice.DueDate,
        },
      };
    }
  }

  private async *fetchBills(since?: Date): AsyncGenerator<DiscoveredFile> {
    let query = "SELECT * FROM Bill";
    if (since) {
      query += ` WHERE MetaData.LastUpdatedTime > '${since.toISOString()}'`;
    }
    query += " MAXRESULTS 100";

    const data = await this.query(query);
    const bills = (data?.QueryResponse?.Bill ?? []) as QBOBill[];

    for (const bill of bills) {
      yield {
        externalId: `bill_${bill.Id}`,
        name: `Bill_${bill.DocNumber ?? bill.Id}.json`,
        mimeType: "application/json",
        size: JSON.stringify(bill).length,
        modifiedAt: bill.MetaData?.LastUpdatedTime ?? new Date().toISOString(),
        metadata: {
          type: "bill",
          docNumber: bill.DocNumber,
          vendorName: bill.VendorRef?.name,
          totalAmount: bill.TotalAmt,
          balance: bill.Balance,
          dueDate: bill.DueDate,
        },
      };
    }
  }

  private async *fetchPurchases(since?: Date): AsyncGenerator<DiscoveredFile> {
    let query = "SELECT * FROM Purchase";
    if (since) {
      query += ` WHERE MetaData.LastUpdatedTime > '${since.toISOString()}'`;
    }
    query += " MAXRESULTS 100";

    const data = await this.query(query);
    const purchases = (data?.QueryResponse?.Purchase ?? []) as QBOPurchase[];

    for (const purchase of purchases) {
      yield {
        externalId: `purchase_${purchase.Id}`,
        name: `Expense_${purchase.DocNumber ?? purchase.Id}.json`,
        mimeType: "application/json",
        size: JSON.stringify(purchase).length,
        modifiedAt: purchase.MetaData?.LastUpdatedTime ?? new Date().toISOString(),
        metadata: {
          type: "expense",
          docNumber: purchase.DocNumber,
          paymentType: purchase.PaymentType,
          totalAmount: purchase.TotalAmt,
          entityName: purchase.EntityRef?.name,
        },
      };
    }
  }

  private async query(query: string): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}/v3/company/${this.realmId}/query?query=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`QuickBooks query failed: ${response.status}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }

  async downloadFile(externalId: string): Promise<Buffer> {
    if (!this.accessToken || !this.realmId) {
      throw new Error("Not connected to QuickBooks");
    }

    const [type, id] = externalId.split("_");
    let endpoint: string;

    switch (type) {
      case "invoice":
        endpoint = `Invoice/${id}`;
        break;
      case "bill":
        endpoint = `Bill/${id}`;
        break;
      case "purchase":
        endpoint = `Purchase/${id}`;
        break;
      default:
        throw new Error(`Unknown entity type: ${type}`);
    }

    const response = await fetch(`${this.baseUrl}/v3/company/${this.realmId}/${endpoint}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${type}: ${response.status}`);
    }

    const data = await response.json();
    return Buffer.from(JSON.stringify(data, null, 2));
  }

  /**
   * Create an invoice in QuickBooks
   */
  async createInvoice(invoice: {
    customerRef: { value: string };
    line: Array<{ description: string; amount: number; detailType: string }>;
    dueDate?: string;
  }): Promise<QBOInvoice> {
    if (!this.accessToken || !this.realmId) {
      throw new Error("Not connected to QuickBooks");
    }

    const response = await fetch(`${this.baseUrl}/v3/company/${this.realmId}/invoice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        CustomerRef: invoice.customerRef,
        Line: invoice.line.map((l) => ({
          Description: l.description,
          Amount: l.amount,
          DetailType: l.detailType,
        })),
        DueDate: invoice.dueDate,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create invoice: ${response.status}`);
    }

    const data = (await response.json()) as { Invoice: QBOInvoice };
    return data.Invoice;
  }

  /**
   * Create an expense in QuickBooks
   */
  async createExpense(expense: {
    accountRef: { value: string };
    paymentType: "Cash" | "Check" | "CreditCard";
    totalAmt: number;
    txnDate?: string;
    memo?: string;
  }): Promise<QBOPurchase> {
    if (!this.accessToken || !this.realmId) {
      throw new Error("Not connected to QuickBooks");
    }

    const response = await fetch(`${this.baseUrl}/v3/company/${this.realmId}/purchase`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        AccountRef: expense.accountRef,
        PaymentType: expense.paymentType,
        TotalAmt: expense.totalAmt,
        TxnDate: expense.txnDate,
        PrivateNote: expense.memo,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create expense: ${response.status}`);
    }

    const data = (await response.json()) as { Purchase: QBOPurchase };
    return data.Purchase;
  }
}

// Register the connector
registerConnector("quickbooks", (config) => new QuickBooksConnector(config));

export function createQuickBooksConnector(config: ConnectorConfig): QuickBooksConnector {
  return new QuickBooksConnector(config);
}
