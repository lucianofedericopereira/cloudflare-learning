/**
 * Type definitions for the Redirect Engine
 */

export interface Env {
  REDIRECTS: KVNamespace;
  API_KEY: string;
}

export interface RedirectRule {
  id: string;
  source: string;
  destination: string;
  statusCode: 301 | 302 | 307 | 308;
  preserveQueryString: boolean;
  enabled: boolean;
  isPattern: boolean; // true if contains wildcards
  created: string;
  updated: string;
  hits: number;
}

export interface CreateRedirectRequest {
  source: string;
  destination: string;
  statusCode?: 301 | 302 | 307 | 308;
  preserveQueryString?: boolean;
  enabled?: boolean;
}

export interface BulkImportResult {
  success: number;
  failed: number;
  errors: Array<{ source: string; error: string }>;
}

export type RedirectRuleInput = Omit<RedirectRule, "id" | "created" | "updated" | "hits" | "isPattern">;
