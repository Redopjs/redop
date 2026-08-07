import type { TransportKind } from "./protocol";

export interface ProgressEmitter {
  progress(value: number, total?: number, message?: string): void;
}

export interface ToolRequest {
  abortSignal?: AbortSignal;
  /**
   * Client capabilities from `_meta.io.modelcontextprotocol/clientCapabilities`
   * (MCP 2026-07-28 per-request negotiation).
   */
  clientCapabilities?: Record<string, unknown>;
  headers: Record<string, string>;
  /**
   * MRTR responses echoed by the client when retrying after `input_required`
   * (MCP 2026-07-28).
   */
  inputResponses?: Record<string, unknown>;
  ip?: string;
  method?: string;
  progressCallback?: (p: {
    message?: string;
    progress: number;
    total?: number;
  }) => void;
  /** Negotiated MCP protocol version for this request. */
  protocolVersion?: string;
  raw?: Request;
  /**
   * Opaque MRTR request state echoed by the client (MCP 2026-07-28).
   */
  requestState?: string;
  sessionId?: string;
  transport: TransportKind;
  url?: string;
}

export type RequestMeta = ToolRequest;

export type BaseRequestContext<
  T extends Record<string, unknown> = Record<string, unknown>,
> = {
  headers: Record<string, string>;
  rawParams: Record<string, unknown>;
  requestId: string;
  sessionId?: string;
  transport: TransportKind;
} & T;

export type Context<
  T extends Record<string, unknown> = Record<string, unknown>,
> = BaseRequestContext<T> & {
  tool: string;
};

export type ResourceContext<
  T extends Record<string, unknown> = Record<string, unknown>,
> = BaseRequestContext<T> & {
  resource: string;
};

export type PromptContext<
  T extends Record<string, unknown> = Record<string, unknown>,
> = BaseRequestContext<T> & {
  prompt: string;
};
