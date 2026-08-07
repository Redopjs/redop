// ─────────────────────────────────────────────
//  redop — shared MCP protocol helpers (2026-07-28+)
// ─────────────────────────────────────────────

export const PROTOCOL_LATEST = "2026-07-28" as const;
export const PROTOCOL_LEGACY_DEFAULT = "2025-03-26" as const;

export const SUPPORTED_PROTOCOL_VERSIONS = [
  PROTOCOL_LATEST,
  "2025-11-25",
  "2025-03-26",
  "2024-11-05",
] as const;

export type SupportedProtocolVersion =
  (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

export const HEADER_MISMATCH = -32_020;
export const MISSING_REQUIRED_CLIENT_CAPABILITY = -32_021;
export const UNSUPPORTED_PROTOCOL_VERSION = -32_022;

export const TASKS_EXTENSION_ID = "io.modelcontextprotocol/tasks";

export const META_PROTOCOL_VERSION =
  "io.modelcontextprotocol/protocolVersion" as const;
export const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo" as const;
export const META_CLIENT_CAPABILITIES =
  "io.modelcontextprotocol/clientCapabilities" as const;

export type CacheScope = "public" | "private";

export interface CacheHints {
  cacheScope: CacheScope;
  ttlMs: number;
}

export const DEFAULT_LIST_CACHE: CacheHints = {
  ttlMs: 60_000,
  cacheScope: "public",
};

export const DEFAULT_READ_CACHE: CacheHints = {
  ttlMs: 30_000,
  cacheScope: "private",
};

export function isStatelessProtocol(
  version: string | undefined
): version is typeof PROTOCOL_LATEST {
  return version === PROTOCOL_LATEST;
}

export function negotiateProtocolVersion(
  clientVersion: string | undefined,
  fallback: SupportedProtocolVersion = PROTOCOL_LEGACY_DEFAULT
): SupportedProtocolVersion {
  if (!clientVersion) {
    return fallback;
  }
  return (
    SUPPORTED_PROTOCOL_VERSIONS.find((v) => v === clientVersion) ?? fallback
  );
}

export function isSupportedProtocolVersion(
  version: string
): version is SupportedProtocolVersion {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

export function withCacheHints<T extends Record<string, unknown>>(
  result: T,
  hints: CacheHints,
  protocolVersion: string | undefined
): T & Partial<CacheHints> {
  if (!isStatelessProtocol(protocolVersion)) {
    return result;
  }
  return {
    ...result,
    ttlMs: hints.ttlMs,
    cacheScope: hints.cacheScope,
  };
}

export function withResultType<T extends Record<string, unknown>>(
  result: T,
  protocolVersion: string | undefined,
  resultType: "complete" | "input_required" | "task" = "complete"
): T & { resultType?: string } {
  if (!isStatelessProtocol(protocolVersion)) {
    return result;
  }
  return { ...result, resultType };
}

export function buildServerCapabilities(
  caps: { tools: boolean; resources: boolean; prompts: boolean },
  protocolVersion: string | undefined
): Record<string, unknown> {
  const capabilities: Record<string, unknown> = {};
  if (caps.tools) {
    capabilities.tools = { listChanged: true };
  }
  if (caps.resources) {
    capabilities.resources = { subscribe: true, listChanged: true };
  }
  if (caps.prompts) {
    capabilities.prompts = { listChanged: true };
  }

  if (isStatelessProtocol(protocolVersion)) {
    capabilities.extensions = {
      [TASKS_EXTENSION_ID]: {},
    };
  } else {
    capabilities.tasks = {
      list: {},
      cancel: {},
      requests: { tools: { call: {} } },
    };
  }

  return capabilities;
}

export type InputRequest = {
  method: string;
  params?: Record<string, unknown>;
};

export type InputRequests = Record<string, InputRequest>;
export type InputResponses = Record<string, unknown>;

/**
 * Thrown from a tool/resource/prompt handler to trigger an MRTR
 * `input_required` response (MCP 2026-07-28).
 */
export class InputRequiredError extends Error {
  readonly inputRequests?: InputRequests;
  readonly requestState?: string;

  constructor(opts: {
    inputRequests?: InputRequests;
    requestState?: string;
  }) {
    if (!(opts.inputRequests || opts.requestState)) {
      throw new Error(
        "InputRequiredError requires inputRequests and/or requestState"
      );
    }
    super("Input required");
    this.name = "InputRequiredError";
    this.inputRequests = opts.inputRequests;
    this.requestState = opts.requestState;
  }
}

/** Convenience helper that always throws {@link InputRequiredError}. */
export function requireInput(opts: {
  inputRequests?: InputRequests;
  requestState?: string;
}): never {
  throw new InputRequiredError(opts);
}

export function isInputRequiredError(
  error: unknown
): error is InputRequiredError {
  return error instanceof InputRequiredError;
}

export function inputRequiredResult(
  error: InputRequiredError
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    resultType: "input_required",
  };
  if (error.inputRequests) {
    result.inputRequests = error.inputRequests;
  }
  if (error.requestState !== undefined) {
    result.requestState = error.requestState;
  }
  return result;
}

const BASE64_NAME_RE = /^=\?base64\?([A-Za-z0-9+/=]+)\?=$/;

/** Decode `Mcp-Name` / `Mcp-Param-*` values, including the Base64 sentinel. */
export function decodeMcpHeaderValue(value: string): string {
  const match = BASE64_NAME_RE.exec(value.trim());
  if (!match?.[1]) {
    return value;
  }
  try {
    return Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return value;
  }
}

function expectedMcpName(
  method: string,
  params: Record<string, unknown> | undefined
): string | undefined {
  if (!params) {
    return undefined;
  }
  switch (method) {
    case "tools/call":
    case "prompts/get":
      return typeof params.name === "string" ? params.name : undefined;
    case "resources/read":
      return typeof params.uri === "string" ? params.uri : undefined;
    case "tasks/get":
    case "tasks/update":
    case "tasks/cancel":
    case "tasks/result":
      return typeof params.taskId === "string" ? params.taskId : undefined;
    default:
      return undefined;
  }
}

export function mcpNameRequired(method: string): boolean {
  return (
    method === "tools/call" ||
    method === "resources/read" ||
    method === "prompts/get" ||
    method === "tasks/get" ||
    method === "tasks/update" ||
    method === "tasks/cancel" ||
    method === "tasks/result"
  );
}

/**
 * Validate Streamable HTTP mirrored headers for 2026-07-28.
 * Returns an error message when validation fails.
 */
export function validateMcpHeaders(opts: {
  method: string;
  params?: Record<string, unknown>;
  mcpMethodHeader: string | null;
  mcpNameHeader: string | null;
}): string | null {
  const { method, params, mcpMethodHeader, mcpNameHeader } = opts;

  if (!mcpMethodHeader) {
    return "Missing required Mcp-Method header";
  }
  if (mcpMethodHeader !== method) {
    return `Header mismatch: Mcp-Method header value '${mcpMethodHeader}' does not match body value '${method}'`;
  }

  if (!mcpNameRequired(method)) {
    return null;
  }

  const expected = expectedMcpName(method, params);
  if (expected === undefined) {
    // Body is missing the name/uri/taskId — leave that to the RPC handler.
    return null;
  }

  if (!mcpNameHeader) {
    return "Missing required Mcp-Name header";
  }

  const decoded = decodeMcpHeaderValue(mcpNameHeader);
  if (decoded !== expected) {
    return `Header mismatch: Mcp-Name header value '${decoded}' does not match body value '${expected}'`;
  }

  return null;
}

export function readProtocolMeta(
  params: Record<string, unknown> | undefined
): {
  clientCapabilities?: Record<string, unknown>;
  clientInfo?: Record<string, unknown>;
  protocolVersion?: string;
} {
  const meta = params?._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return {};
  }
  const m = meta as Record<string, unknown>;
  return {
    protocolVersion:
      typeof m[META_PROTOCOL_VERSION] === "string"
        ? (m[META_PROTOCOL_VERSION] as string)
        : undefined,
    clientInfo:
      m[META_CLIENT_INFO] && typeof m[META_CLIENT_INFO] === "object"
        ? (m[META_CLIENT_INFO] as Record<string, unknown>)
        : undefined,
    clientCapabilities:
      m[META_CLIENT_CAPABILITIES] &&
      typeof m[META_CLIENT_CAPABILITIES] === "object"
        ? (m[META_CLIENT_CAPABILITIES] as Record<string, unknown>)
        : undefined,
  };
}

export function clientHasTasksExtension(
  clientCapabilities: Record<string, unknown> | undefined
): boolean {
  const extensions = clientCapabilities?.extensions;
  if (!extensions || typeof extensions !== "object") {
    return false;
  }
  return TASKS_EXTENSION_ID in (extensions as Record<string, unknown>);
}
