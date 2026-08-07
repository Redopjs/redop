import type { TransportKind } from "./protocol";
import type { ServerIcon } from "./tooling";

/**
 * Fine-grained control over which MCP capabilities are advertised.
 * Disabled capabilities are omitted from initialize and their handlers
 * return Method Not Found.
 *
 * @example
 * ```json
 * {
 *   "tools": true,
 *   "resources": false,
 *   "prompts": true
 * }
 * ```
 */
export interface CapabilityOptions {
  /** @default true when any prompt is registered */
  prompts?: boolean;
  /** @default true when any resource is registered */
  resources?: boolean;
  /** @default true */
  tools?: boolean;
}

/**
 * Metadata returned from MCP `initialize` as `serverInfo`, plus the optional
 * top-level `instructions` hint included in the initialize result.
 *
 * In the MCP spec, `name` and `version` are the core `Implementation` fields.
 * `title`, `description`, `icons`, and `websiteUrl` are optional. `instructions`
 * is not part of `serverInfo` in the wire schema, but Redop groups it here so
 * server metadata stays in one place at construction time.
 *
 * @example
 * ```json
 * {
 *   "name": "my-mcp-server",
 *   "version": "0.1.0",
 *   "title": "My MCP Server",
 *   "description": "Searches internal docs",
 *   "websiteUrl": "https://example.com",
 *   "icons": [
 *     {
 *       "src": "https://example.com/icon.svg",
 *       "mimeType": "image/svg+xml"
 *     }
 *   ],
 *   "instructions": "Use search_docs before answering from memory."
 * }
 * ```
 */
export interface ServerInfoOptions {
  /** Optional human-readable description shown by supporting clients. */
  description?: string;
  /** Optional client-displayable icons from the MCP `Implementation` schema. */
  icons?: ServerIcon[];
  /**
   * Optional usage guidance returned as top-level `initialize.instructions`.
   */
  instructions?: string;
  /** MCP implementation name. @default "redop" */
  name?: string;
  /** Optional UI-friendly display name. */
  title?: string;
  /** MCP implementation version. @default "0.1.0" */
  version?: string;
  /** Optional project or product URL shown by supporting clients. */
  websiteUrl?: string;
}

/**
 * Constructor options for `new Redop(...)`.
 *
 * Prefer grouping MCP-facing metadata under `serverInfo` and keeping framework
 * behavior at the top level.
 *
 * @example
 * ```json
 * {
 *   "serverInfo": {
 *     "name": "my-mcp-server",
 *     "version": "0.1.0"
 *   },
 *   "capabilities": {
 *     "tools": true,
 *     "resources": true,
 *     "prompts": true
 *   }
 * }
 * ```
 */
export interface RedopOptions {
  /**
   * Override which MCP capability groups are advertised.
   *
   * @default all enabled
   */
  capabilities?: CapabilityOptions;
  /** @deprecated Use serverInfo.description instead. */
  description?: string;
  /** @deprecated Use serverInfo.icons instead. */
  icons?: ServerIcon[];
  /** @deprecated Use serverInfo.instructions instead. */
  instructions?: string;
  /** @deprecated Use serverInfo.name instead. */
  name?: string;
  /** Grouped MCP server metadata. */
  serverInfo?: ServerInfoOptions;
  /** @deprecated Use serverInfo.title instead. */
  title?: string;
  /** @deprecated Use serverInfo.version instead. */
  version?: string;
  /** @deprecated Use serverInfo.websiteUrl instead. */
  websiteUrl?: string;
}

/**
 * HTTP CORS settings for the built-in transport.
 *
 * @example
 * ```json
 * {
 *   "origins": ["https://app.example.com"],
 *   "methods": ["GET", "POST", "DELETE"],
 *   "headers": ["content-type", "authorization"],
 *   "credentials": true
 * }
 * ```
 */
export interface CorsOptions {
  /** Whether to send `Access-Control-Allow-Credentials`. @default false */
  credentials?: boolean;
  /** Allowed request headers. */
  headers?: string[];
  /** Allowed HTTP methods. */
  methods?: string[];
  /** Allowed origin or list of origins. */
  origins?: string | string[];
}

export type TlsOptions = import("bun").TLSOptions;

/**
 * Health endpoint options for the built-in HTTP transport.
 *
 * @example
 * ```json
 * {
 *   "path": "/healthz"
 * }
 * ```
 */
export interface HealthOptions {
  /** HTTP path to respond on. @default "/health" */
  path?: string;
}

/**
 * Transport options for `.listen(...)`.
 *
 * Passing a number is shorthand for `{ port: number }`.
 *
 * @example
 * ```json
 * {
 *   "transport": "http",
 *   "hostname": "127.0.0.1",
 *   "port": 3000,
 *   "path": "/mcp",
 *   "cors": true,
 *   "health": {
 *     "path": "/health"
 *   }
 * }
 * ```
 */
export interface ListenOptions {
  /** Enable permissive CORS or provide explicit CORS settings. @default false */
  cors?: boolean | CorsOptions;
  /** Log extra HTTP transport details. @default false */
  debug?: boolean;
  /** Enable `/health` or configure the health endpoint. @default false */
  health?: boolean | HealthOptions;
  /** Interface to bind to for HTTP transport. @default "127.0.0.1" */
  hostname?: string;
  /** Maximum accepted request body size in bytes. */
  maxBodySize?: number;
  onListen?: (info: { hostname: string; port: number; url: string }) => void;
  /** MCP endpoint path for HTTP transport. @default "/mcp" */
  path?: string;
  /** TCP port for HTTP transport. @default 3000 */
  port?: number | string;
  /**
   * Cache hints returned on list/discover responses for MCP 2026-07-28.
   * Ignored for older protocol versions.
   */
  listCache?: {
    /** @default "public" */
    cacheScope?: "public" | "private";
    /** @default 60000 */
    ttlMs?: number;
  };
  /** Session expiry in milliseconds for HTTP sessions. @default 60000 */
  sessionTimeout?: number;
  tls?: TlsOptions;
  /** Transport kind. @default "http" when `port` is set, otherwise "stdio" */
  transport?: TransportKind;
}
