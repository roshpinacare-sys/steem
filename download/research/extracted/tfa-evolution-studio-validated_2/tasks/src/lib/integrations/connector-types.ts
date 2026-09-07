/**
 * TFA Evolution Studio v28 — Connector Types
 */

export interface ConnectorConfig {
  url: string;
  token?: string;
  headers?: Record<string, string>;
}

export type ConnectorKind = "github" | "gitlab" | "jira" | "slack" | "notion" | "webhook" | "rest" | "cicd";
export type ConnectorPermission = "read" | "write" | "admin" | "none";
