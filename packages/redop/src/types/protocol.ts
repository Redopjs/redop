export interface JsonRpcRequest {
  id: string | number | null;
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  error?: { code: number; message: string; data?: unknown };
  id: string | number | null;
  jsonrpc: "2.0";
  result?: unknown;
}

export type TransportKind = "http" | "stdio";

export enum McpErrorCode {
  ParseError = -32_700,
  InvalidRequest = -32_600,
  MethodNotFound = -32_601,
  InvalidParams = -32_602,
  InternalError = -32_603,
  /** HTTP header/body mismatch or missing required MCP headers (2026-07-28). */
  HeaderMismatch = -32_020,
  /** Client did not declare a required capability (2026-07-28). */
  MissingRequiredClientCapability = -32_021,
  /** Requested MCP protocol version is not supported (2026-07-28). */
  UnsupportedProtocolVersion = -32_022,
}

export class McpError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = "McpError";
  }
}
