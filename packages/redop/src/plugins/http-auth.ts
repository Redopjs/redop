// ─────────────────────────────────────────────
//  redop — HTTP auth errors for MCP OAuth
// ─────────────────────────────────────────────

import type { ProtectedResourceConfig } from "../types/config";

export type { ProtectedResourceConfig };

export type HttpAuthErrorCode =
  | "invalid_token"
  | "insufficient_scope"
  | "invalid_request";

export interface HttpAuthChallenge {
  /** Absolute URL to RFC 9728 Protected Resource Metadata. */
  resourceMetadataUrl?: string;
  /** Space-delimited scopes for the challenge. */
  scope?: string;
  error?: HttpAuthErrorCode;
  errorDescription?: string;
}

/**
 * Transport-level auth failure. MCP clients (including Claude) expect HTTP
 * 401/403 + `WWW-Authenticate`, not a JSON-RPC / tool `isError` result.
 */
export class HttpAuthError extends Error {
  readonly status: 401 | 403;
  readonly wwwAuthenticate: string;
  readonly challenge: HttpAuthChallenge;

  constructor(
    message: string,
    opts: {
      status?: 401 | 403;
      challenge?: HttpAuthChallenge;
    } = {}
  ) {
    super(message);
    this.name = "HttpAuthError";
    this.status = opts.status ?? 401;
    this.challenge = opts.challenge ?? {};
    this.wwwAuthenticate = buildWwwAuthenticate(this.challenge);
  }
}

export function isHttpAuthError(error: unknown): error is HttpAuthError {
  return error instanceof HttpAuthError;
}

export function buildWwwAuthenticate(challenge: HttpAuthChallenge): string {
  const parts = ["Bearer"];
  if (challenge.resourceMetadataUrl) {
    parts.push(`resource_metadata="${challenge.resourceMetadataUrl}"`);
  }
  if (challenge.scope) {
    parts.push(`scope="${challenge.scope}"`);
  }
  if (challenge.error) {
    parts.push(`error="${challenge.error}"`);
  }
  if (challenge.errorDescription) {
    parts.push(
      `error_description="${challenge.errorDescription.replace(/"/g, "'")}"`
    );
  }
  return parts.join(" ");
}

/**
 * Build absolute Protected Resource Metadata URLs for a request origin.
 * RFC 9728 allows a path-suffixed well-known document when the resource has a path.
 */
export function protectedResourceMetadataPaths(mcpPath: string): {
  root: string;
  suffixed: string;
} {
  const path = mcpPath.startsWith("/") ? mcpPath : `/${mcpPath}`;
  return {
    root: "/.well-known/oauth-protected-resource",
    suffixed:
      path === "/"
        ? "/.well-known/oauth-protected-resource"
        : `/.well-known/oauth-protected-resource${path}`,
  };
}

export function absoluteMetadataUrl(origin: string, pathname: string): string {
  return `${origin.replace(/\/$/, "")}${pathname}`;
}

export function buildProtectedResourceDocument(
  config: ProtectedResourceConfig
): Record<string, unknown> {
  return {
    resource: config.resource,
    authorization_servers: config.authorizationServers,
    ...(config.scopesSupported?.length
      ? { scopes_supported: config.scopesSupported }
      : {}),
    bearer_methods_supported: config.bearerMethodsSupported ?? ["header"],
  };
}
