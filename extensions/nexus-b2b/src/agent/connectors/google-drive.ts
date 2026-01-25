/**
 * Google Drive Connector
 * Syncs documents from Google Drive folders
 */

import type { ConnectorConfig } from "../../types/index.js";
import { BaseConnector, type DiscoveredFile, registerConnector } from "./base.js";

type GoogleDriveSettings = {
  folderId?: string;
  folderIds?: string[];
  includeSharedDrives?: boolean;
  fileTypes?: string[];
  maxFileSize?: number;
};

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  modifiedTime: string;
  parents?: string[];
  webViewLink?: string;
};

type DriveListResponse = {
  files: DriveFile[];
  nextPageToken?: string;
};

export class GoogleDriveConnector extends BaseConnector {
  private accessToken?: string;
  private refreshToken?: string;
  private settings: GoogleDriveSettings;

  constructor(config: ConnectorConfig) {
    super(config);
    this.settings = (config.settings ?? {}) as GoogleDriveSettings;

    if (config.credentials?.type === "oauth") {
      this.accessToken = config.credentials.accessToken;
      this.refreshToken = config.credentials.refreshToken;
    }
  }

  async connect(): Promise<void> {
    if (!this.accessToken) {
      this.setStatus("pending_auth", "OAuth credentials required");
      throw new Error("OAuth credentials required for Google Drive");
    }

    const valid = await this.testConnection();
    if (!valid) {
      this.setStatus("error", "Failed to connect to Google Drive");
      throw new Error("Failed to connect to Google Drive");
    }

    this.setStatus("connected");
  }

  async disconnect(): Promise<void> {
    this.setStatus("disconnected");
  }

  async testConnection(): Promise<boolean> {
    if (!this.accessToken) return false;

    try {
      const response = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async *discoverFiles(options?: { since?: Date; limit?: number }): AsyncGenerator<DiscoveredFile> {
    if (!this.accessToken) {
      throw new Error("Not connected to Google Drive");
    }

    const folderIds = this.settings.folderIds ?? (this.settings.folderId ? [this.settings.folderId] : []);
    const fileTypes = this.settings.fileTypes ?? [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "application/vnd.google-apps.spreadsheet",
      "application/vnd.google-apps.document",
    ];
    const maxSize = this.settings.maxFileSize ?? 50 * 1024 * 1024;

    let query = `trashed = false`;

    if (folderIds.length > 0) {
      const folderQuery = folderIds.map((id) => `'${id}' in parents`).join(" or ");
      query += ` and (${folderQuery})`;
    }

    if (fileTypes.length > 0) {
      const mimeQuery = fileTypes.map((t) => `mimeType = '${t}'`).join(" or ");
      query += ` and (${mimeQuery})`;
    }

    if (options?.since) {
      query += ` and modifiedTime > '${options.since.toISOString()}'`;
    }

    let pageToken: string | undefined;
    let count = 0;
    const limit = options?.limit ?? 1000;

    do {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", query);
      url.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime,parents,webViewLink),nextPageToken");
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      if (this.settings.includeSharedDrives) {
        url.searchParams.set("includeItemsFromAllDrives", "true");
        url.searchParams.set("supportsAllDrives", "true");
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Google Drive API error: ${response.status}`);
      }

      const data = (await response.json()) as DriveListResponse;
      pageToken = data.nextPageToken;

      for (const file of data.files) {
        const size = parseInt(file.size ?? "0", 10);
        if (size > maxSize) continue;

        yield {
          externalId: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size,
          modifiedAt: file.modifiedTime,
          metadata: {
            parents: file.parents,
            webViewLink: file.webViewLink,
          },
        };

        count++;
        if (count >= limit) return;
      }
    } while (pageToken && count < limit);
  }

  async downloadFile(externalId: string): Promise<Buffer> {
    if (!this.accessToken) {
      throw new Error("Not connected to Google Drive");
    }

    // Check if it's a Google Docs file that needs export
    const metaResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${externalId}?fields=mimeType`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      },
    );

    if (!metaResponse.ok) {
      throw new Error(`Failed to get file metadata: ${metaResponse.status}`);
    }

    const meta = (await metaResponse.json()) as { mimeType: string };

    let url: string;
    if (meta.mimeType.startsWith("application/vnd.google-apps.")) {
      // Export Google Docs formats
      const exportMimes: Record<string, string> = {
        "application/vnd.google-apps.document": "application/pdf",
        "application/vnd.google-apps.spreadsheet": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.google-apps.presentation": "application/pdf",
      };
      const exportMime = exportMimes[meta.mimeType] ?? "application/pdf";
      url = `https://www.googleapis.com/drive/v3/files/${externalId}/export?mimeType=${encodeURIComponent(exportMime)}`;
    } else {
      url = `https://www.googleapis.com/drive/v3/files/${externalId}?alt=media`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

// Register the connector
registerConnector("google_drive", (config) => new GoogleDriveConnector(config));

export function createGoogleDriveConnector(config: ConnectorConfig): GoogleDriveConnector {
  return new GoogleDriveConnector(config);
}
