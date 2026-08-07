// ─────────────────────────────────────────────
//  redop — core class
// ─────────────────────────────────────────────

import type { ProtectedResourceConfig } from "./types";
import { detectAdapter } from "./adapters/schema";
import { createHttpApp, type HttpApp } from "./transports/http-app";
import { getBunHttpTransport } from "./transports/http-registry";
import { startStdioTransport } from "./transports/stdio";
import type {
  AfterHook,
  AfterResponseHook,
  BeforeHook,
  CapabilityOptions,
  Context,
  ErrorHook,
  HandlerOptions,
  InferPromptInput,
  InferSchemaOutput,
  ListenOptions,
  Middleware,
  ParseHook,
  PluginDefinition,
  PluginFactory,
  PluginMeta,
  PromptArgument,
  PromptContext,
  PromptDef,
  PromptGetEvent,
  PromptHandlerResult,
  RedopOptions,
  RequestMeta,
  ResolvedPrompt,
  ResolvedResource,
  ResolvedTool,
  ResourceContents,
  ResourceContext,
  ResourceDef,
  ResourceReadEvent,
  ResourceUriParams,
  ServerInfoOptions,
  ToolDef,
  ToolHandlerEvent,
  TransformHook,
} from "./types";
import type { HttpFetch } from "./transports/runtime";

// ── Internal registry ─────────────────────────

interface HookRegistry {
  after: AfterHook[];
  afterResponse: AfterResponseHook[];
  before: BeforeHook[];
  error: ErrorHook[];
  parse: ParseHook[];
  transform: TransformHook[];
}

type DeferredExecution<R> =
  | {
      afterResponse: () => Promise<void>;
      ok: true;
      result: R;
    }
  | {
      afterResponse: () => Promise<void>;
      error: unknown;
      ok: false;
    };

type InputParser = (
  input: Record<string, unknown>
) => unknown | Promise<unknown>;
type DeriveFn<C extends Record<string, unknown>> = (
  base: { request: RequestMeta } & Context<C>
) => Record<string, unknown> | Promise<Record<string, unknown>>;

// SSE broadcast callback injected by the HTTP transport so resource change
// notifications can be pushed server-initiated without importing the transport.
type BroadcastFn = (sessionId: string, data: unknown) => void;

const DEFAULTS = { name: "redop", version: "0.1.0" } as const;
const MCP_IDENTIFIER = /^[A-Za-z0-9._/-]+$/;
const MAX_MCP_IDENTIFIER_LENGTH = 64;

function failValidation(message: string): never {
  throw new Error(`[redop] ${message}`);
}

function assertIdentifierLikeName(
  kind: "tool" | "prompt",
  value: string
): void {
  if (value.trim().length === 0) {
    failValidation(`${kind} name must not be empty.`);
  }
  if (value !== value.trim()) {
    failValidation(
      `${kind} name "${value}" must not start or end with whitespace.`
    );
  }
  if (value.length > MAX_MCP_IDENTIFIER_LENGTH) {
    failValidation(
      `${kind} name "${value}" must be ${MAX_MCP_IDENTIFIER_LENGTH} characters or fewer.`
    );
  }
  if (!MCP_IDENTIFIER.test(value)) {
    failValidation(
      `${kind} name "${value}" may only contain letters, numbers, underscores (_), dashes (-), dots (.), and forward slashes (/).`
    );
  }
}

function assertDisplayName(kind: "resource", value: string): void {
  if (value.trim().length === 0) {
    failValidation(`${kind} name must not be empty.`);
  }
  if (value !== value.trim()) {
    failValidation(
      `${kind} name "${value}" must not start or end with whitespace.`
    );
  }
}

function assertUniqueName(
  kind: "tool" | "prompt" | "resource",
  value: string,
  exists: boolean
): void {
  if (exists) {
    failValidation(`${kind} "${value}" is already registered.`);
  }
}

function assertValidResourceUri(uri: string): void {
  if (uri.trim().length === 0) {
    failValidation("resource URI must not be empty.");
  }
  if (uri !== uri.trim()) {
    failValidation(
      `resource URI "${uri}" must not start or end with whitespace.`
    );
  }
  if (/\s/.test(uri)) {
    failValidation(`resource URI "${uri}" must not contain whitespace.`);
  }

  let depth = 0;
  let lastOpen = -1;
  for (let i = 0; i < uri.length; i++) {
    const ch = uri[i];
    if (ch === "{") {
      if (depth > 0) {
        failValidation(
          `resource URI template "${uri}" must not contain nested template expressions.`
        );
      }
      depth = 1;
      lastOpen = i;
      continue;
    }
    if (ch === "}") {
      if (depth === 0) {
        failValidation(
          `resource URI template "${uri}" contains an unmatched closing brace.`
        );
      }
      if (i === lastOpen + 1) {
        failValidation(
          `resource URI template "${uri}" must not contain empty template expressions.`
        );
      }
      depth = 0;
    }
  }
  if (depth !== 0) {
    failValidation(
      `resource URI template "${uri}" contains an unmatched opening brace.`
    );
  }

  const normalized = uri.replace(/\{[^}]+\}/g, "x");
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)) {
    failValidation(
      `resource URI "${uri}" must be an absolute URI or URI template with a valid scheme.`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function promptArgumentsFromSchema(
  promptName: string,
  schema: Record<string, unknown>
): readonly PromptArgument[] {
  if (schema.type !== "object" && !isRecord(schema.properties)) {
    failValidation(
      `prompt "${promptName}" argumentsSchema must describe an object of named arguments.`
    );
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (value): value is string => typeof value === "string"
        )
      : []
  );

  return Object.entries(properties).map(([name, value]) => ({
    name,
    required: required.has(name) || undefined,
    ...(isRecord(value) && typeof value.description === "string"
      ? { description: value.description }
      : {}),
  }));
}

function normalizePromptArguments(
  promptName: string,
  definitions: readonly PromptArgument[] | undefined,
  args: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!definitions?.length) {
    return args;
  }

  const normalized = { ...(args ?? {}) };
  const missingRequired = definitions
    .filter(
      (argument) => argument.required && normalized[argument.name] === undefined
    )
    .map((argument) => argument.name);

  if (missingRequired.length > 0) {
    failValidation(
      `prompt "${promptName}" is missing required argument${missingRequired.length === 1 ? "" : "s"}: ${missingRequired.join(", ")}.`
    );
  }

  return normalized;
}

// ── URI template helpers ──────────────────────

/** Returns true when the URI contains at least one {variable} placeholder. */
function isTemplate(uri: string): boolean {
  return /\{[^}]+\}/.test(uri);
}

/**
 * Converts a URI template like "users://{id}/profile" to a RegExp and
 * returns the variable names in capture-group order.
 */
function templateToRegex(template: string): { regex: RegExp; vars: string[] } {
  const vars: string[] = [];
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, (c) => {
    if (c === "{") {
      return "OPEN_BRACE";
    }
    if (c === "}") {
      return "CLOSE_BRACE";
    }
    return `\\${c}`;
  });
  const pattern = escaped.replace(
    /OPEN_BRACE([^C]+?)CLOSE_BRACE/g,
    (_, name) => {
      vars.push(name);
      return "([^/]+)";
    }
  );
  return { regex: new RegExp(`^${pattern}$`), vars };
}

/**
 * Match a concrete URI against a URI template.
 * Returns null if it doesn't match; otherwise returns the variable map.
 */
function matchTemplate(
  template: string,
  uri: string
): Record<string, string> | null {
  if (!isTemplate(template)) {
    return template === uri ? {} : null;
  }
  const { regex, vars } = templateToRegex(template);
  const m = uri.match(regex);
  if (!m) {
    return null;
  }
  const result: Record<string, string> = {};
  vars.forEach((v, i) => {
    result[v] = m[i + 1]!;
  });
  return result;
}

// ── Redop class ───────────────────────────────

export class Redop<C extends Record<string, unknown> = {}> {
  private _hooks: HookRegistry = {
    after: [],
    afterResponse: [],
    before: [],
    error: [],
    parse: [],
    transform: [],
  };
  private _tools = new Map<string, ResolvedTool>();
  private _resources = new Map<string, ResolvedResource>();
  private _prompts = new Map<string, ResolvedPrompt>();
  private _middlewares: Middleware<unknown, unknown, C>[] = [];
  private _inputParsers = new Map<string, InputParser>();
  private _promptArgumentParsers = new Map<string, InputParser>();
  private _deriveFns: DeriveFn<C>[] = [];
  private _capabilities: Required<CapabilityOptions>;
  private _serverInfo: Required<ServerInfoOptions>;
  private _broadcast?: BroadcastFn;
  private _subscribedSessions = new Map<string, Set<string>>(); // uri → sessions
  private _httpApp: HttpApp | null = null;
  private _protectedResource?: ProtectedResourceConfig;

  constructor(options: RedopOptions = {}) {
    const serverInfo = options.serverInfo ?? {};
    this._serverInfo = {
      description: serverInfo.description ?? options.description ?? "",
      icons: serverInfo.icons ?? options.icons ?? [],
      instructions: serverInfo.instructions ?? options.instructions ?? "",
      name: serverInfo.name ?? options.name ?? DEFAULTS.name,
      title: serverInfo.title ?? options.title ?? "",
      version: serverInfo.version ?? options.version ?? DEFAULTS.version,
      websiteUrl: serverInfo.websiteUrl ?? options.websiteUrl ?? "",
    };
    this._capabilities = {
      tools: options.capabilities?.tools ?? true,
      resources: options.capabilities?.resources ?? true,
      prompts: options.capabilities?.prompts ?? true,
    };
  }

  // ── Derive ────────────────────────────────────────────────────────────────

  /**
   * Extend the request context with values computed at request time.
   * The returned object is merged into `ctx` before any hooks fire.
   * The type of `C` is widened by `D` for all subsequent registrations.
   *
   * @example
   * const app = new Redop()
   *   .derive(async ({ request }) => ({
   *     userId: await auth(request.headers.authorization ?? ""),
   *   }));
   * // ctx.userId is typed everywhere below
   */
  derive<D extends Record<string, unknown>>(
    fn: (base: { request: RequestMeta } & Context<C>) => D | Promise<D>
  ): Redop<C & D> {
    this._deriveFns.push(fn as DeriveFn<C>);
    return this as unknown as Redop<C & D>;
  }

  // ── Lifecycle hooks ───────────────────────────────────────────────────────

  /** Fires before middleware and the handler. */
  onBeforeHandle(hook: BeforeHook<C>): this {
    this._hooks.before.push(hook as BeforeHook);
    return this;
  }

  /**
   * Fires after the handler succeeds.
   * Return a non-undefined value to replace the result.
   * Errors thrown here are isolated — they fire error hooks but the
   * tool call still succeeds from the client's perspective.
   */
  onAfterHandle(hook: AfterHook<C>): this {
    this._hooks.after.push(hook as AfterHook);
    return this;
  }

  /** Fires after the response has been written. Best-effort and non-mutable. */
  onAfterResponse(hook: AfterResponseHook<C>): this {
    this._hooks.afterResponse.push(hook as AfterResponseHook);
    return this;
  }

  /** Fires when middleware or the handler throws. */
  onError(hook: ErrorHook<C>): this {
    this._hooks.error.push(hook as ErrorHook);
    return this;
  }

  /** Mutate raw params before schema parsing. */
  onTransform(hook: TransformHook<C>): this {
    this._hooks.transform.push(hook as TransformHook);
    return this;
  }

  /**
   * Fires after schema parsing, before before-hooks.
   * Return a value to replace the parsed input.
   */
  onParse(hook: ParseHook<C>): this {
    this._hooks.parse.push(hook as ParseHook);
    return this;
  }

  /** Global middleware — fires for every tool, resource, and prompt execution. */
  middleware<I = unknown>(mw: Middleware<I, unknown, C>): this {
    this._middlewares.push(mw as Middleware<unknown, unknown, C>);
    return this;
  }

  // ── Tool registration ─────────────────────────────────────────────────────

  /**
   * Register an MCP tool.
   *
   * @example
   * app.tool("get_weather", {
   *   title:       "Get current weather",
   *   description: "Retrieves weather for a city",
   *   inputSchema: z.object({ city: z.string() }),
   *   handler:     async ({ input }) => fetchWeather(input.city),
   * });
   */
  tool<S, I = InferSchemaOutput<S>, O = unknown, OS = Record<string, unknown>>(
    name: string,
    def: ToolDef<S, I, C, O, OS>
  ): this {
    assertIdentifierLikeName("tool", name);
    assertUniqueName("tool", name, this._tools.has(name));

    let inputSchema: Record<string, unknown> = {
      additionalProperties: false,
      properties: {},
      type: "object",
    };
    let outputSchema: Record<string, unknown> | undefined;
    const declaredInputSchema = def.inputSchema ?? def.input;

    if (declaredInputSchema) {
      const adapter = detectAdapter(declaredInputSchema);
      inputSchema = adapter.toJsonSchema(declaredInputSchema);
      this._inputParsers.set(name, (input) =>
        adapter.parse(declaredInputSchema as S, input)
      );
    }

    if (def.outputSchema) {
      const adapter = detectAdapter(def.outputSchema);
      outputSchema = adapter.toJsonSchema(def.outputSchema);
    }

    this._tools.set(name, {
      after: def.after as ResolvedTool["after"],
      afterResponse: def.afterResponse as ResolvedTool["afterResponse"],
      annotations: def.annotations,
      before: def.before as ResolvedTool["before"],
      description: def.description,
      handler: def.handler as ResolvedTool["handler"],
      icons: def.icons,
      inputSchema,
      middleware: def.middleware as ResolvedTool["middleware"],
      name,
      outputSchema,
      taskSupport: def.taskSupport,
      title: def.title,
    });

    return this;
  }

  // ── Resource registration ─────────────────────────────────────────────────

  /**
   * Register a static or template MCP resource.
   *
   * Static resources are identified by an exact URI match.
   * Template resources use {variable} placeholders in the URI.
   *
   * @example Static
   * app.resource("config://server", {
   *   name:    "Server config",
   *   mimeType: "application/json",
   *   handler: () => ({ type: "text", text: JSON.stringify(cfg) }),
   * });
   *
   * @example Template
   * app.resource("users://{id}/profile", {
   *   name:    "User profile",
   *   mimeType: "application/json",
   *   handler: ({ params }) => fetchUser(params.id),
   * });
   */
  resource<const U extends string>(
    uri: U,
    def: ResourceDef<C, ResourceUriParams<U>>
  ): this {
    assertValidResourceUri(uri);
    assertDisplayName("resource", def.name);
    assertUniqueName("resource", uri, this._resources.has(uri));
    this._resources.set(uri, {
      after: def.after as ResolvedResource["after"],
      afterResponse: def.afterResponse as ResolvedResource["afterResponse"],
      before: def.before as ResolvedResource["before"],
      uri,
      name: def.name,
      description: def.description,
      mimeType: def.mimeType,
      subscribe: def.subscribe,
      icons: def.icons,
      middleware: def.middleware as ResolvedResource["middleware"],
      handler: def.handler as ResolvedResource["handler"],
      isTemplate: isTemplate(uri),
    });
    return this;
  }

  /**
   * Push a resources/updated notification to all sessions subscribed to `uri`.
   * Call this whenever the underlying data for a resource changes.
   */
  notifyResourceChanged(uri: string): void {
    const sessions = this._subscribedSessions.get(uri);
    if (!(sessions && this._broadcast)) {
      return;
    }
    for (const sid of sessions) {
      this._broadcast(sid, {
        jsonrpc: "2.0",
        method: "notifications/resources/updated",
        params: { uri },
      });
    }
  }

  // ── Prompt registration ───────────────────────────────────────────────────

  /**
   * Register an MCP prompt.
   *
   * @example
   * app.prompt("code_review", {
   *   description: "Review code for issues",
   *   arguments: [
   *     { name: "code",     required: true },
   *     { name: "language", required: false },
   *   ],
   *   handler: ({ arguments: args }) => [
   *     { role: "user", content: { type: "text", text: `Review this ${args.language ?? ""} code:\n${args.code}` } },
   *   ],
   * });
   */
  prompt<
    const A extends readonly PromptArgument[] | undefined = undefined,
    S = undefined,
    I = InferPromptInput<S, A>,
  >(name: string, def: PromptDef<C, A, S, I>): this {
    assertIdentifierLikeName("prompt", name);
    assertUniqueName("prompt", name, this._prompts.has(name));

    let argumentsMetadata: readonly PromptArgument[] | undefined =
      def.arguments;
    if (def.argumentsSchema) {
      const adapter = detectAdapter(def.argumentsSchema);
      const jsonSchema = adapter.toJsonSchema(def.argumentsSchema);
      this._promptArgumentParsers.set(name, (input) =>
        adapter.parse(def.argumentsSchema as S, input)
      );
      if (!argumentsMetadata) {
        argumentsMetadata = promptArgumentsFromSchema(name, jsonSchema);
      }
    }

    this._prompts.set(name, {
      after: def.after as ResolvedPrompt["after"],
      afterResponse: def.afterResponse as ResolvedPrompt["afterResponse"],
      name,
      description: def.description,
      arguments: argumentsMetadata,
      before: def.before as ResolvedPrompt["before"],
      handler: def.handler as ResolvedPrompt["handler"],
      middleware: def.middleware as ResolvedPrompt["middleware"],
    });
    return this;
  }

  /**
   * Merge another Redop instance as a plugin.
   * All hooks, middleware, tools, resources, and prompts are merged globally.
   */
  use<P extends Record<string, unknown>>(plugin: Redop<P>): Redop<C & P> {
    this._hooks.before.push(...plugin._hooks.before);
    this._hooks.after.push(...plugin._hooks.after);
    this._hooks.afterResponse.push(...plugin._hooks.afterResponse);
    this._hooks.error.push(...plugin._hooks.error);
    this._hooks.transform.push(...plugin._hooks.transform);
    this._hooks.parse.push(...plugin._hooks.parse);
    this._deriveFns.push(...(plugin._deriveFns as unknown as DeriveFn<C>[]));
    this._middlewares.push(
      ...(plugin._middlewares as unknown as Middleware<unknown, unknown, C>[])
    );
    for (const [n, t] of plugin._tools) {
      this._tools.set(n, t);
    }
    for (const [n, p] of plugin._inputParsers) {
      this._inputParsers.set(n, p);
    }
    for (const [n, p] of plugin._promptArgumentParsers) {
      this._promptArgumentParsers.set(n, p);
    }
    for (const [u, r] of plugin._resources) {
      this._resources.set(u, r);
    }
    for (const [n, p] of plugin._prompts) {
      this._prompts.set(n, p);
    }
    if (plugin._protectedResource) {
      this._protectedResource = plugin._protectedResource;
    }
    return this as unknown as Redop<C & P>;
  }

  /**
   * Attach RFC 9728 Protected Resource Metadata for MCP OAuth clients.
   * Called by `oauth()` / `jwt({ resource })` plugins.
   */
  _setProtectedResource(config: ProtectedResourceConfig): this {
    this._protectedResource = config;
    return this;
  }

  _getProtectedResource(): ProtectedResourceConfig | undefined {
    return this._protectedResource;
  }

  // ── Tool runner ───────────────────────────────────────────────────────────

  private async _emitErrorHooks(
    event: Parameters<ErrorHook<C>>[0]
  ): Promise<void> {
    for (const hook of this._hooks.error) {
      try {
        await hook(event);
      } catch {
        // Ignore secondary error hook failures.
      }
    }
  }

  async _executeTool(
    toolName: string,
    rawArgs: Record<string, unknown>,
    request: RequestMeta
  ): Promise<DeferredExecution<unknown>> {
    const tool = this._tools.get(toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    // 1. Base context
    const ctx = {
      headers: request.headers ?? {},
      rawParams: rawArgs,
      requestId: crypto.randomUUID(),
      sessionId: request.sessionId,
      tool: toolName,
      transport: request.transport,
    } as Context<C>;

    // 2. Derive fns
    for (const fn of this._deriveFns) {
      Object.assign(ctx, await fn({ ...ctx, request }));
    }
    const typedCtx = ctx;

    // 3. Transform hooks
    let params = { ...rawArgs };
    for (const hook of this._hooks.transform) {
      const out = await hook({
        ctx: typedCtx,
        params,
        request,
        tool: toolName,
      });
      if (out && typeof out === "object") {
        params = out as Record<string, unknown>;
      }
    }

    // 4. Schema parse
    let input: unknown = params;
    const parser = this._inputParsers.get(toolName);
    if (parser) {
      try {
        input = await parser(params);
      } catch (err) {
        const ve = new Error(
          `Validation failed for "${toolName}": ${err instanceof Error ? err.message : String(err)}`
        ) as Error & { cause?: unknown; issues?: unknown };
        ve.cause = err;
        if (typeof err === "object" && err !== null && "issues" in err) {
          ve.issues = (err as any).issues;
        }

        const afterResponse = async () => {
          if (tool.afterResponse) {
            try {
              await tool.afterResponse({
                ctx: typedCtx,
                error: ve,
                input,
                request,
                tool: toolName,
              });
            } catch (error) {
              await this._emitErrorHooks({
                ctx: typedCtx,
                error,
                input,
                request,
                tool: toolName,
              });
            }
          }

          for (const hook of this._hooks.afterResponse) {
            try {
              await hook({
                ctx: typedCtx,
                error: ve,
                input,
                kind: "tool",
                name: toolName,
                request,
                tool: toolName,
              });
            } catch (error) {
              await this._emitErrorHooks({
                ctx: typedCtx,
                error,
                input,
                request,
                tool: toolName,
              });
            }
          }
        };

        return { afterResponse, error: ve, ok: false };
      }
    }

    // 5. Parse hooks
    for (const hook of this._hooks.parse) {
      const out = await hook({ ctx: typedCtx, input, request, tool: toolName });
      if (out !== undefined) {
        input = out;
      }
    }

    // 6. Emit + signal
    const emit = {
      progress(value: number, total?: number, message?: string) {
        request.progressCallback?.({ message, progress: value, total });
      },
    };
    const signal = request.abortSignal ?? new AbortController().signal;

    const handlerEvent: ToolHandlerEvent<unknown, C> = {
      ctx: typedCtx,
      emit,
      input,
      request,
      signal,
      tool: toolName,
    };

    try {
      // 7. Global before hooks
      for (const h of this._hooks.before) {
        await h({ ctx: typedCtx, input, request, tool: toolName });
      }
      // 8. Tool-local before
      if (tool.before) {
        await tool.before(handlerEvent);
      }

      // 9. Middleware chain (global → per-tool)
      const chain: Middleware<unknown, unknown, C>[] = [
        ...this._middlewares,
        ...((tool.middleware ?? []) as Middleware<unknown, unknown, C>[]),
      ];
      const dispatch = async (i: number): Promise<unknown> => {
        if (i >= chain.length) {
          return tool.handler(handlerEvent);
        }
        return chain[i]!({
          ...handlerEvent,
          kind: "tool",
          name: toolName,
          next: () => dispatch(i + 1),
        });
      };
      let result = await dispatch(0);

      // 10. Tool-local after (isolated)
      if (tool.after) {
        try {
          const out = await tool.after({ ...handlerEvent, result });
          if (out !== undefined) {
            result = out as unknown;
          }
        } catch (e) {
          for (const h of this._hooks.error) {
            await h({
              ctx: typedCtx,
              error: e,
              input,
              request,
              tool: toolName,
            });
          }
        }
      }

      // 11. Global after hooks (isolated, return value replaces result)
      for (const hook of this._hooks.after) {
        try {
          const out = await hook({
            ctx: typedCtx,
            input,
            request,
            result,
            tool: toolName,
          });
          if (out !== undefined) {
            result = out as unknown;
          }
        } catch (e) {
          for (const h of this._hooks.error) {
            await h({
              ctx: typedCtx,
              error: e,
              input,
              request,
              tool: toolName,
            });
          }
        }
      }

      const afterResponse = async () => {
        if (tool.afterResponse) {
          try {
            await tool.afterResponse({
              ctx: typedCtx,
              input,
              request,
              result,
              tool: toolName,
            });
          } catch (error) {
            await this._emitErrorHooks({
              ctx: typedCtx,
              error,
              input,
              request,
              tool: toolName,
            });
          }
        }

        for (const hook of this._hooks.afterResponse) {
          try {
            await hook({
              ctx: typedCtx,
              input,
              kind: "tool",
              name: toolName,
              request,
              result,
              tool: toolName,
            });
          } catch (error) {
            await this._emitErrorHooks({
              ctx: typedCtx,
              error,
              input,
              request,
              tool: toolName,
            });
          }
        }
      };

      return { afterResponse, ok: true, result };
    } catch (err) {
      await this._emitErrorHooks({
        ctx: typedCtx,
        error: err,
        input,
        request,
        tool: toolName,
      });

      const afterResponse = async () => {
        if (tool.afterResponse) {
          try {
            await tool.afterResponse({
              ctx: typedCtx,
              error: err,
              input,
              request,
              tool: toolName,
            });
          } catch (error) {
            await this._emitErrorHooks({
              ctx: typedCtx,
              error,
              input,
              request,
              tool: toolName,
            });
          }
        }

        for (const hook of this._hooks.afterResponse) {
          try {
            await hook({
              ctx: typedCtx,
              error: err,
              input,
              kind: "tool",
              name: toolName,
              request,
              tool: toolName,
            });
          } catch (error) {
            await this._emitErrorHooks({
              ctx: typedCtx,
              error,
              input,
              request,
              tool: toolName,
            });
          }
        }
      };

      return { afterResponse, error: err, ok: false };
    }
  }

  async _runTool(
    toolName: string,
    rawArgs: Record<string, unknown>,
    request: RequestMeta
  ): Promise<unknown> {
    const execution = await this._executeTool(toolName, rawArgs, request);
    if (!execution.ok) {
      throw execution.error;
    }
    return execution.result;
  }

  // ── Resource runner ───────────────────────────────────────────────────────

  async _executeResource(
    uri: string,
    request: RequestMeta
  ): Promise<DeferredExecution<ResourceContents>> {
    const ctx = {
      headers: request.headers ?? {},
      rawParams: {},
      requestId: crypto.randomUUID(),
      resource: uri,
      sessionId: request.sessionId,
      transport: request.transport,
    } as ResourceContext<C>;

    // Try exact match first, then template match
    let resolved = this._resources.get(uri);
    let templateParams: Record<string, string> | undefined;

    if (!resolved) {
      for (const [pattern, res] of this._resources) {
        if (!res.isTemplate) {
          continue;
        }
        const params = matchTemplate(pattern, uri);
        if (params !== null) {
          resolved = res;
          templateParams = params;
          break;
        }
      }
    }

    if (!resolved) {
      return {
        afterResponse: async () => {},
        error: new Error(`Resource not found: ${uri}`),
        ok: false,
      };
    }

    ctx.resource = resolved.uri;
    ctx.rawParams = templateParams ?? {};

    const event: ResourceReadEvent<ResourceContext<C>> = {
      ctx,
      uri,
      params: templateParams,
      request,
    };
    const globalCtx = {
      ...ctx,
      tool: resolved.uri,
    } as Context<C>;
    const globalInput = templateParams ?? {};

    try {
      for (const hook of this._hooks.before) {
        await hook({
          ctx: globalCtx,
          input: globalInput,
          request,
          tool: resolved.uri,
        });
      }
      if (resolved.before) {
        await resolved.before(event);
      }

      const localChain = resolved.middleware ?? [];
      const dispatchLocal = async (i: number): Promise<ResourceContents> => {
        if (i >= localChain.length) {
          return resolved.handler(event);
        }
        return localChain[i]!({ ...event, next: () => dispatchLocal(i + 1) });
      };

      const signal = request.abortSignal ?? new AbortController().signal;
      const dispatchGlobal = async (i: number): Promise<ResourceContents> => {
        if (i >= this._middlewares.length) {
          return dispatchLocal(0);
        }
        return this._middlewares[i]!({
          ctx: globalCtx,
          emit: {
            progress(value: number, total?: number, message?: string) {
              request.progressCallback?.({ message, progress: value, total });
            },
          },
          input: globalInput,
          kind: "resource",
          name: resolved.uri,
          next: () => dispatchGlobal(i + 1),
          params: templateParams,
          request,
          resource: resolved.uri,
          signal,
          tool: resolved.uri,
          uri,
        }) as Promise<ResourceContents>;
      };

      let result = await dispatchGlobal(0);

      if (resolved.after) {
        try {
          const out = await resolved.after({ ...event, result });
          if (out !== undefined) {
            result = out as typeof result;
          }
        } catch (error) {
          for (const errHook of this._hooks.error) {
            await errHook({
              ctx: globalCtx,
              error,
              input: globalInput,
              request,
              tool: resolved.uri,
            });
          }
        }
      }

      for (const hook of this._hooks.after) {
        try {
          const out = await hook({
            ctx: globalCtx,
            input: globalInput,
            request,
            result,
            tool: resolved.uri,
          });
          if (out !== undefined) {
            result = out as typeof result;
          }
        } catch (error) {
          for (const errHook of this._hooks.error) {
            await errHook({
              ctx: globalCtx,
              error,
              input: globalInput,
              request,
              tool: resolved.uri,
            });
          }
        }
      }

      const afterResponse = async () => {
        if (resolved.afterResponse) {
          try {
            await resolved.afterResponse({ ...event, result });
          } catch (error) {
            await this._emitErrorHooks({
              ctx: globalCtx,
              error,
              input: globalInput,
              request,
              tool: resolved.uri,
            });
          }
        }

        for (const hook of this._hooks.afterResponse) {
          try {
            await hook({
              ctx: globalCtx,
              input: globalInput,
              kind: "resource",
              name: resolved.uri,
              request,
              result,
              tool: resolved.uri,
            });
          } catch (error) {
            await this._emitErrorHooks({
              ctx: globalCtx,
              error,
              input: globalInput,
              request,
              tool: resolved.uri,
            });
          }
        }
      };

      return { afterResponse, ok: true, result };
    } catch (error) {
      await this._emitErrorHooks({
        ctx: globalCtx,
        error,
        input: globalInput,
        request,
        tool: resolved.uri,
      });

      const afterResponse = async () => {
        if (resolved.afterResponse) {
          try {
            await resolved.afterResponse({ ...event, error });
          } catch (postError) {
            await this._emitErrorHooks({
              ctx: globalCtx,
              error: postError,
              input: globalInput,
              request,
              tool: resolved.uri,
            });
          }
        }

        for (const hook of this._hooks.afterResponse) {
          try {
            await hook({
              ctx: globalCtx,
              error,
              input: globalInput,
              kind: "resource",
              name: resolved.uri,
              request,
              tool: resolved.uri,
            });
          } catch (postError) {
            await this._emitErrorHooks({
              ctx: globalCtx,
              error: postError,
              input: globalInput,
              request,
              tool: resolved.uri,
            });
          }
        }
      };

      return { afterResponse, error, ok: false };
    }
  }

  async _readResource(uri: string, request: RequestMeta) {
    const execution = await this._executeResource(uri, request);
    if (!execution.ok) {
      throw execution.error;
    }
    return execution.result;
  }

  // ── Prompt runner ─────────────────────────────────────────────────────────

  async _executePrompt(
    name: string,
    args: Record<string, string> | undefined,
    request: RequestMeta
  ): Promise<DeferredExecution<PromptHandlerResult>> {
    const ctx = {
      headers: request.headers ?? {},
      rawParams: (args ?? {}) as Record<string, unknown>,
      prompt: name,
      requestId: crypto.randomUUID(),
      sessionId: request.sessionId,
      transport: request.transport,
    } as PromptContext<C>;
    const prompt = this._prompts.get(name);
    if (!prompt) {
      return {
        afterResponse: async () => {},
        error: new Error(`Prompt not found: ${name}`),
        ok: false,
      };
    }
    ctx.prompt = prompt.name;
    const rawPromptArgs = normalizePromptArguments(
      name,
      prompt.arguments,
      args
    );
    let promptInput: unknown = rawPromptArgs;
    const parser = this._promptArgumentParsers.get(name);

    if (parser) {
      try {
        promptInput = await parser(
          (rawPromptArgs ?? {}) as Record<string, unknown>
        );
      } catch (err) {
        const ve = new Error(
          `Validation failed for prompt "${name}": ${err instanceof Error ? err.message : String(err)}`
        ) as Error & { cause?: unknown; issues?: unknown };
        ve.cause = err;
        if (typeof err === "object" && err !== null && "issues" in err) {
          ve.issues = (err as any).issues;
        }

        const afterResponse = async () => {
          if (prompt.afterResponse) {
            try {
              await prompt.afterResponse({
                ctx,
                error: ve,
                arguments: promptInput as never,
                name,
                request,
              });
            } catch (error) {
              await this._emitErrorHooks({
                ctx: {
                  ...ctx,
                  tool: prompt.name,
                } as Context<C>,
                error,
                input: (rawPromptArgs ?? {}) as Record<string, unknown>,
                request,
                tool: prompt.name,
              });
            }
          }

          for (const hook of this._hooks.afterResponse) {
            try {
              await hook({
                ctx: {
                  ...ctx,
                  tool: prompt.name,
                } as Context<C>,
                error: ve,
                input: (rawPromptArgs ?? {}) as Record<string, unknown>,
                kind: "prompt",
                name: prompt.name,
                request,
                tool: prompt.name,
              });
            } catch (error) {
              await this._emitErrorHooks({
                ctx: {
                  ...ctx,
                  tool: prompt.name,
                } as Context<C>,
                error,
                input: (rawPromptArgs ?? {}) as Record<string, unknown>,
                request,
                tool: prompt.name,
              });
            }
          }
        };

        return { afterResponse, error: ve, ok: false };
      }
    }

    ctx.rawParams = isRecord(promptInput)
      ? promptInput
      : ((rawPromptArgs ?? {}) as Record<string, unknown>);

    const event: PromptGetEvent<PromptContext<C>, typeof promptInput> = {
      ctx,
      name,
      arguments: promptInput as never,
      request,
    };
    const globalCtx = {
      ...ctx,
      tool: prompt.name,
    } as Context<C>;
    const globalInput = isRecord(promptInput)
      ? promptInput
      : ((rawPromptArgs ?? {}) as Record<string, unknown>);

    try {
      for (const hook of this._hooks.before) {
        await hook({
          ctx: globalCtx,
          input: globalInput,
          request,
          tool: prompt.name,
        });
      }
      if (prompt.before) {
        await prompt.before(event);
      }

      const localChain = prompt.middleware ?? [];
      const dispatchLocal = async (i: number): Promise<PromptHandlerResult> => {
        if (i >= localChain.length) {
          return prompt.handler(event);
        }
        return localChain[i]!({ ...event, next: () => dispatchLocal(i + 1) });
      };

      const signal = request.abortSignal ?? new AbortController().signal;
      const dispatchGlobal = async (
        i: number
      ): Promise<PromptHandlerResult> => {
        if (i >= this._middlewares.length) {
          return dispatchLocal(0);
        }
        return this._middlewares[i]!({
          arguments: rawPromptArgs,
          ctx: globalCtx,
          emit: {
            progress(value: number, total?: number, message?: string) {
              request.progressCallback?.({ message, progress: value, total });
            },
          },
          input: globalInput,
          kind: "prompt",
          name: prompt.name,
          next: () => dispatchGlobal(i + 1),
          prompt: prompt.name,
          request,
          signal,
          tool: prompt.name,
        }) as Promise<PromptHandlerResult>;
      };

      let result = await dispatchGlobal(0);

      if (prompt.after) {
        try {
          const out = await prompt.after({ ...event, result });
          if (out !== undefined) {
            result = out as PromptHandlerResult;
          }
        } catch (error) {
          for (const errHook of this._hooks.error) {
            await errHook({
              ctx: globalCtx,
              error,
              input: globalInput,
              request,
              tool: prompt.name,
            });
          }
        }
      }

      for (const hook of this._hooks.after) {
        try {
          const out = await hook({
            ctx: globalCtx,
            input: globalInput,
            request,
            result,
            tool: prompt.name,
          });
          if (out !== undefined) {
            result = out as PromptHandlerResult;
          }
        } catch (error) {
          for (const errHook of this._hooks.error) {
            await errHook({
              ctx: globalCtx,
              error,
              input: globalInput,
              request,
              tool: prompt.name,
            });
          }
        }
      }

      const afterResponse = async () => {
        if (prompt.afterResponse) {
          try {
            await prompt.afterResponse({ ...event, result });
          } catch (error) {
            await this._emitErrorHooks({
              ctx: globalCtx,
              error,
              input: globalInput,
              request,
              tool: prompt.name,
            });
          }
        }

        for (const hook of this._hooks.afterResponse) {
          try {
            await hook({
              ctx: globalCtx,
              input: globalInput,
              kind: "prompt",
              name: prompt.name,
              request,
              result,
              tool: prompt.name,
            });
          } catch (error) {
            await this._emitErrorHooks({
              ctx: globalCtx,
              error,
              input: globalInput,
              request,
              tool: prompt.name,
            });
          }
        }
      };

      return { afterResponse, ok: true, result };
    } catch (error) {
      await this._emitErrorHooks({
        ctx: globalCtx,
        error,
        input: globalInput,
        request,
        tool: prompt.name,
      });

      const afterResponse = async () => {
        if (prompt.afterResponse) {
          try {
            await prompt.afterResponse({ ...event, error });
          } catch (postError) {
            await this._emitErrorHooks({
              ctx: globalCtx,
              error: postError,
              input: globalInput,
              request,
              tool: prompt.name,
            });
          }
        }

        for (const hook of this._hooks.afterResponse) {
          try {
            await hook({
              ctx: globalCtx,
              error,
              input: globalInput,
              kind: "prompt",
              name: prompt.name,
              request,
              tool: prompt.name,
            });
          } catch (postError) {
            await this._emitErrorHooks({
              ctx: globalCtx,
              error: postError,
              input: globalInput,
              request,
              tool: prompt.name,
            });
          }
        }
      };

      return { afterResponse, error, ok: false };
    }
  }

  async _getPrompt(
    name: string,
    args: Record<string, string> | undefined,
    request: RequestMeta
  ): Promise<PromptHandlerResult> {
    const execution = await this._executePrompt(name, args, request);
    if (!execution.ok) {
      throw execution.error;
    }
    return execution.result;
  }

  // ── Subscription management ───────────────────────────────────────────────

  _subscribeResource(uri: string, sessionId: string): void {
    if (!this._subscribedSessions.has(uri)) {
      this._subscribedSessions.set(uri, new Set());
    }
    this._subscribedSessions.get(uri)!.add(sessionId);
  }

  _unsubscribeResource(uri: string, sessionId: string): void {
    this._subscribedSessions.get(uri)?.delete(sessionId);
  }

  _setBroadcast(fn: BroadcastFn): void {
    this._broadcast = fn;
  }

  // ── Capability resolution ─────────────────────────────────────────────────

  _resolvedCapabilities(): Required<CapabilityOptions> {
    return {
      tools: this._capabilities.tools,
      resources: this._capabilities.resources && this._resources.size > 0,
      prompts: this._capabilities.prompts && this._prompts.size > 0,
    };
  }

  // ── Start server ──────────────────────────────────────────────────────────

  /**
   * Return a portable `fetch`-compatible MCP handler.
   *
   * Use this with Cloudflare, Vercel, Node, or any runtime that accepts a
   * Web-standard `(Request) => Response` function. Bun apps can keep using
   * `.listen(...)` which remains the default long-running path.
   *
   * Pass a platform `waitUntil` through the second `runtime` argument (or via
   * `@redopjs/redop/cloudflare` / `@redopjs/redop/vercel`) so `afterResponse`
   * hooks still run on serverless isolates.
   */
  handler(opts: HandlerOptions = {}): HttpFetch {
    if (!this._httpApp) {
      const runTool = (
        name: string,
        args: Record<string, unknown>,
        meta: RequestMeta
      ) => this._executeTool(name, args, meta);
      const readResource = (uri: string, req: RequestMeta) =>
        this._executeResource(uri, req);
      const getPrompt = (
        name: string,
        args: Record<string, string> | undefined,
        req: RequestMeta
      ) => this._executePrompt(name, args, req);

      this._httpApp = createHttpApp(
        this._tools,
        this._resources,
        this._prompts,
        runTool,
        readResource,
        getPrompt,
        (uri, sid) => this._subscribeResource(uri, sid),
        (uri, sid) => this._unsubscribeResource(uri, sid),
        { ...opts, protectedResource: this._protectedResource },
        this._serverInfo,
        this._resolvedCapabilities()
      );
      this._setBroadcast((sessionId, data) => {
        this._httpApp!.push(sessionId, data);
      });
    }

    return (req, runtime) => this._httpApp!.fetch(req, runtime);
  }

  listen(): this;
  listen(port: number | string, hostname?: string): this;
  listen(opts: ListenOptions): this;
  listen(
    portOrOptions: ListenOptions | number | string = {},
    hostname?: string
  ) {
    const opts: ListenOptions =
      typeof portOrOptions === "number" || typeof portOrOptions === "string"
        ? {
            port: portOrOptions,
            ...(hostname ? { hostname } : {}),
          }
        : portOrOptions;

    const runTool = (
      name: string,
      args: Record<string, unknown>,
      meta: RequestMeta
    ) => this._executeTool(name, args, meta);
    const readResource = (uri: string, req: RequestMeta) =>
      this._executeResource(uri, req);
    const getPrompt = (
      name: string,
      args: Record<string, string> | undefined,
      req: RequestMeta
    ) => this._executePrompt(name, args, req);
    const transport =
      opts.transport ??
      (opts.port !== undefined && opts.port !== null && opts.port !== ""
        ? "http"
        : "stdio");

    if (transport === "stdio") {
      startStdioTransport(
        this._tools,
        this._resources,
        this._prompts,
        runTool,
        readResource,
        getPrompt,
        this._serverInfo,
        this._resolvedCapabilities()
      );
      return this;
    }

    if (transport === "http") {
      const startHttpTransport = getBunHttpTransport();
      if (!startHttpTransport) {
        throw new Error(
          "[redop] HTTP `.listen()` requires the Bun runtime entry (`@redopjs/redop`). For Cloudflare, Vercel, or Node, use `app.handler()` or `@redopjs/redop/cloudflare` / `@redopjs/redop/vercel` / `@redopjs/redop/node`."
        );
      }
      const { push } = startHttpTransport(
        this._tools,
        this._resources,
        this._prompts,
        runTool,
        readResource,
        getPrompt,
        (uri, sid) => this._subscribeResource(uri, sid),
        (uri, sid) => this._unsubscribeResource(uri, sid),
        { ...opts, protectedResource: this._protectedResource },
        this._serverInfo,
        this._resolvedCapabilities()
      );
      this._setBroadcast(push);
      return this;
    }

    throw new Error(`[redop] Unknown transport: ${transport}`);
  }

  // ── Introspection ─────────────────────────────────────────────────────────

  get toolNames(): string[] {
    return [...this._tools.keys()];
  }
  get resourceUris(): string[] {
    return [...this._resources.keys()];
  }
  get promptNames(): string[] {
    return [...this._prompts.keys()];
  }
  get serverInfo() {
    return { ...this._serverInfo };
  }

  getTool(name: string): ResolvedTool | undefined {
    return this._tools.get(name);
  }
  getResource(uri: string): ResolvedResource | undefined {
    return this._resources.get(uri);
  }
  getPrompt(name: string): ResolvedPrompt | undefined {
    return this._prompts.get(name);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function middleware<I = unknown, C extends Record<string, unknown> = {}>(
  fn: Middleware<I, unknown, C>
): Redop<C> {
  return new Redop<C>().middleware(fn);
}

export function definePlugin<Options, C extends Record<string, unknown> = {}>(
  definition: PluginDefinition<Options, C>
): PluginFactory<Options, C> {
  const factory = ((options: Options) =>
    definition.setup(options)) as PluginFactory<Options, C>;
  factory.meta = {
    name: definition.name,
    version: definition.version,
    ...(definition.description ? { description: definition.description } : {}),
  } as PluginMeta;
  return factory;
}
