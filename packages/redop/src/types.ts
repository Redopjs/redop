// ─────────────────────────────────────────────
//  redop — core types
// ─────────────────────────────────────────────

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

// ── Progress emitter ──────────────────────────

export interface ProgressEmitter {
  progress(value: number, total?: number, message?: string): void;
}

// ── Request / context ─────────────────────────

export interface ToolRequest {
  abortSignal?: AbortSignal;
  headers: Record<string, string>;
  ip?: string;
  method?: string;
  progressCallback?: (p: {
    message?: string;
    progress: number;
    total?: number;
  }) => void;
  raw?: Request;
  sessionId?: string;
  transport: TransportKind;
  url?: string;
}

export type RequestMeta = ToolRequest;

export type Context<
  T extends Record<string, unknown> = Record<string, unknown>,
> = {
  headers: Record<string, string>;
  rawParams: Record<string, unknown>;
  requestId: string;
  sessionId?: string;
  tool: string;
  transport: TransportKind;
} & T;

// ── Tool event model ──────────────────────────

export interface ToolHandlerEvent<I = unknown, C extends Context = Context> {
  ctx: C;
  emit: ProgressEmitter;
  input: I;
  request: ToolRequest;
  signal: AbortSignal;
  tool: string;
}

export interface ToolBeforeHookEvent<I = unknown, C extends Context = Context> {
  ctx: C;
  input: I;
  request: ToolRequest;
  tool: string;
}

export interface ToolAfterHookEvent<
  I = unknown,
  R = unknown,
  C extends Context = Context,
> extends ToolBeforeHookEvent<I, C> {
  result: R;
}

export type ToolHandler<I, O = unknown, C extends Context = Context> = (
  event: ToolHandlerEvent<I, C>
) => O | Promise<O>;

export type ToolNext<R = unknown> = () => Promise<R>;

export interface ToolMiddlewareEvent<
  I = unknown,
  C extends Context = Context,
  R = unknown,
> extends ToolHandlerEvent<I, C> {
  next: ToolNext<R>;
}

export type ToolMiddleware<
  I = unknown,
  R = unknown,
  C extends Context = Context,
> = (event: ToolMiddlewareEvent<I, C, R>) => R | Promise<R>;

export type ToolBeforeHook<I = unknown, C extends Context = Context> = (
  event: ToolBeforeHookEvent<I, C>
) => void | Promise<void>;

export type ToolAfterHook<
  I = unknown,
  R = unknown,
  C extends Context = Context,
> = (event: ToolAfterHookEvent<I, R, C>) => R | void | Promise<R | void>;

// ── Plugin model ──────────────────────────────

export interface PluginMeta {
  description?: string;
  name: string;
  version: string;
}

export interface PluginDefinition<Options, C extends Context = Context>
  extends PluginMeta {
  setup: (options: Options) => import("./redop").Redop<C>;
}

export interface PluginFactory<Options, C extends Context = Context> {
  meta: PluginMeta;
  (options: Options): import("./redop").Redop<C>;
}

// ── Hook event shapes ─────────────────────────

export interface BeforeHookEvent<C extends Context = Context, I = unknown> {
  ctx: C;
  input: I;
  request: ToolRequest;
  tool: string;
}

export interface AfterHookEvent<
  C extends Context = Context,
  R = unknown,
  I = unknown,
> {
  ctx: C;
  input: I;
  request: ToolRequest;
  result: R;
  tool: string;
}

export interface ErrorHookEvent<C extends Context = Context, I = unknown> {
  ctx: C;
  error: unknown;
  input: I;
  request: ToolRequest;
  tool: string;
}

export interface TransformHookEvent<C extends Context = Context> {
  ctx: C;
  params: Record<string, unknown>;
  request: ToolRequest;
  tool: string;
}

export interface ParseHookEvent<C extends Context = Context> {
  ctx: C;
  input: unknown;
  request: ToolRequest;
  tool: string;
}

// ── Hook types ────────────────────────────────

export type BeforeHook<C extends Context = Context> = (
  e: BeforeHookEvent<C>
) => void | Promise<void>;
export type AfterHook<C extends Context = Context, R = unknown> = (
  e: AfterHookEvent<C, R>
) => R | void | Promise<R | void>;
export type ErrorHook<C extends Context = Context> = (
  e: ErrorHookEvent<C>
) => void | Promise<void>;
export type TransformHook<C extends Context = Context> = (
  e: TransformHookEvent<C>
) => void | Record<string, unknown> | Promise<void | Record<string, unknown>>;
export type ParseHook<C extends Context = Context> = (
  e: ParseHookEvent<C>
) => unknown | Promise<unknown>;

// ── Schema ────────────────────────────────────

export interface StandardSchemaResultSuccess<o> {
  readonly issues?: undefined;
  readonly value: o;
}
export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[];
}
export interface StandardSchemaResultFailure {
  readonly issues: readonly StandardSchemaIssue[];
}
export interface StandardSchemaJsonOptions {
  readonly libraryOptions?: Record<string, unknown>;
  readonly target: string;
}

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly jsonSchema?: {
      readonly input: (o: StandardSchemaJsonOptions) => Record<string, unknown>;
      readonly output: (
        o: StandardSchemaJsonOptions
      ) => Record<string, unknown>;
    };
    readonly validate: (
      value: unknown,
      options?: { readonly libraryOptions?: Record<string, unknown> }
    ) =>
      | StandardSchemaResultSuccess<Output>
      | StandardSchemaResultFailure
      | Promise<
          StandardSchemaResultSuccess<Output> | StandardSchemaResultFailure
        >;
    readonly types?: { readonly input: Input; readonly output: Output };
    readonly vendor: string;
    readonly version: 1;
  };
}

export type InferSchemaOutput<S> =
  S extends StandardSchemaV1<any, infer O>
    ? O
    : S extends Record<string, unknown>
      ? Record<string, unknown>
      : unknown;

export interface SchemaAdapter<S = unknown, P = InferSchemaOutput<S>> {
  parse(schema: S, input: unknown): P | Promise<P>;
  toJsonSchema(schema: S): Record<string, unknown>;
}

// ── Shared shape types ────────────────────────

export interface ToolAnnotations {
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  readOnlyHint?: boolean;
  title?: string;
}

export interface ServerIcon {
  mimeType?: string;
  sizes?: string[];
  src: string;
  theme?: "light" | "dark";
}

// ── Tool definition ───────────────────────────

export interface ToolDef<
  S = unknown,
  I = InferSchemaOutput<S>,
  C extends Context = Context,
  O = unknown,
> {
  after?: ToolAfterHook<I, O, C>;
  annotations?: ToolAnnotations;
  before?: ToolBeforeHook<I, C>;
  description?: string;
  handler: ToolHandler<I, O, C>;
  icons?: ServerIcon[];
  input?: S;
  middleware?: ToolMiddleware<I, unknown, C>[];
  outputSchema?: Record<string, unknown>;
  taskSupport?: "forbidden" | "optional" | "required";
  title?: string;
}

export interface ResolvedTool {
  after?: ToolAfterHook<unknown, unknown>;
  annotations?: ToolAnnotations;
  before?: ToolBeforeHook<unknown>;
  description?: string;
  handler: ToolHandler<unknown>;
  icons?: ServerIcon[];
  inputSchema: Record<string, unknown>;
  middleware?: ToolMiddleware<unknown, unknown>[];
  name: string;
  outputSchema?: Record<string, unknown>;
  taskSupport?: "forbidden" | "optional" | "required";
  title?: string;
}

// ── Resource types ────────────────────────────

/**
 * Content returned by a resource handler.
 * Use "text" for UTF-8 content; "blob" for base64-encoded binary.
 */
export type ResourceContents =
  | { type: "text"; text: string; mimeType?: string }
  | { type: "blob"; blob: string; mimeType?: string };

export interface ResourceReadEvent {
  /** Parsed template variables when the URI is a URI template. */
  params?: Record<string, string>;
  request: ToolRequest;
  /** The exact URI that was requested. */
  uri: string;
}

/**
 * Resource definition. Pass to app.resource(uri, def).
 *
 * Static:   app.resource("file:///config.json", { ... })
 * Template: app.resource("users://{id}/profile", { ... })
 *
 * Template variables are matched from the URI pattern and injected
 * into event.params. The pattern uses {varName} syntax.
 */
export interface ResourceDef {
  description?: string;
  handler: (
    event: ResourceReadEvent
  ) => ResourceContents | Promise<ResourceContents>;
  icons?: ServerIcon[];
  mimeType?: string;
  name: string;
  /**
   * Opt-in to resources/subscribe change notifications.
   * Call app.notifyResourceChanged(uri) to push a notification.
   */
  subscribe?: boolean;
}

export interface ResolvedResource {
  description?: string;
  handler: ResourceDef["handler"];
  icons?: ServerIcon[];
  /** True when the URI contains {variable} template syntax. */
  isTemplate: boolean;
  mimeType?: string;
  name: string;
  subscribe?: boolean;
  uri: string;
}

// ── Prompt types ──────────────────────────────

export interface PromptArgument {
  description?: string;
  name: string;
  required?: boolean;
}

export interface PromptMessage {
  content:
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | {
        type: "resource";
        resource: {
          uri: string;
          text?: string;
          blob?: string;
          mimeType?: string;
        };
      };
  role: "user" | "assistant";
}

export interface PromptGetEvent {
  arguments?: Record<string, string>;
  name: string;
  request: ToolRequest;
}

export type PromptHandlerResult =
  | PromptMessage[]
  | { description?: string; messages: PromptMessage[] };

/**
 * Prompt definition. Pass to app.prompt(name, def).
 *
 * @example
 * app.prompt("summarise", {
 *   description: "Summarise a block of text",
 *   arguments: [
 *     { name: "text",   description: "Text to summarise", required: true },
 *     { name: "length", description: "Target length in words" },
 *   ],
 *   handler: ({ arguments: args }) => [
 *     { role: "user", content: { type: "text", text: `Summarise:\n${args?.text}` } },
 *   ],
 * });
 */
export interface PromptDef {
  arguments?: PromptArgument[];
  description?: string;
  handler: (
    event: PromptGetEvent
  ) => PromptHandlerResult | Promise<PromptHandlerResult>;
}

export interface ResolvedPrompt {
  arguments?: PromptArgument[];
  description?: string;
  handler: PromptDef["handler"];
  name: string;
}

// ── Capability options ────────────────────────

/**
 * Fine-grained control over which MCP capabilities are advertised.
 * Disabled capabilities are omitted from initialize and their handlers
 * return Method Not Found.
 */
export interface CapabilityOptions {
  /** @default true when any prompt is registered */
  prompts?: boolean;
  /** @default true when any resource is registered */
  resources?: boolean;
  /** @default true */
  tools?: boolean;
}

// ── App options ───────────────────────────────

export interface ServerInfoOptions {
  description?: string;
  icons?: ServerIcon[];
  instructions?: string;
  name?: string;
  title?: string;
  version?: string;
  websiteUrl?: string;
}

export interface RedopOptions {
  capabilities?: CapabilityOptions;
  description?: string;
  icons?: ServerIcon[];
  instructions?: string;
  name?: string;
  schemaAdapter?: SchemaAdapter;
  title?: string;
  version?: string;
  websiteUrl?: string;
}

export interface CorsOptions {
  credentials?: boolean;
  headers?: string[];
  methods?: string[];
  origins?: string | string[];
}

export type TlsOptions = import("bun").TLSOptions;

export interface HealthOptions {
  path?: string;
}

export interface ListenOptions {
  cors?: boolean | CorsOptions;
  debug?: boolean;
  devUI?: boolean;
  health?: boolean | HealthOptions;
  hostname?: string;
  maxBodySize?: number;
  onListen?: (info: { hostname: string; port: number; url: string }) => void;
  path?: string;
  port?: number | string;
  sessionTimeout?: number;
  tls?: TlsOptions;
  transport?: TransportKind;
}
