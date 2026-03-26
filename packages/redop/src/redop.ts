// ─────────────────────────────────────────────
//  redop — core class
// ─────────────────────────────────────────────

import { detectAdapter } from "./adapters/schema";
import { startHttpTransport } from "./transports/http";
import { startStdioTransport } from "./transports/stdio";
import type {
  AfterHook,
  BeforeHook,
  CapabilityOptions,
  Context,
  ErrorHook,
  InferSchemaOutput,
  ListenOptions,
  ParseHook,
  PluginDefinition,
  PluginFactory,
  PluginMeta,
  PromptDef,
  PromptGetEvent,
  PromptHandlerResult,
  RedopOptions,
  RequestMeta,
  ResolvedPrompt,
  ResolvedResource,
  ResolvedTool,
  ResourceDef,
  ResourceReadEvent,
  SchemaAdapter,
  ServerInfoOptions,
  ToolDef,
  ToolHandlerEvent,
  ToolMiddleware,
  TransformHook,
} from "./types";

// ── Internal registry ─────────────────────────

interface HookRegistry {
  after: AfterHook[];
  before: BeforeHook[];
  error: ErrorHook[];
  parse: ParseHook[];
  transform: TransformHook[];
}

type InputParser = (
  input: Record<string, unknown>
) => unknown | Promise<unknown>;
type DeriveFn<C extends Context> = (
  base: { request: RequestMeta } & Context
) => Record<string, unknown> | Promise<Record<string, unknown>>;

// SSE broadcast callback injected by the HTTP transport so resource change
// notifications can be pushed server-initiated without importing the transport.
type BroadcastFn = (sessionId: string, data: unknown) => void;

const DEFAULTS = { name: "redop", version: "0.1.0" } as const;

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

export class Redop<C extends Context = Context> {
  private _hooks: HookRegistry = {
    after: [],
    before: [],
    error: [],
    parse: [],
    transform: [],
  };
  private _tools = new Map<string, ResolvedTool>();
  private _resources = new Map<string, ResolvedResource>();
  private _prompts = new Map<string, ResolvedPrompt>();
  private _middlewares: ToolMiddleware<unknown, unknown, C>[] = [];
  private _inputParsers = new Map<string, InputParser>();
  private _schemaAdapter?: SchemaAdapter;
  private _deriveFns: DeriveFn<C>[] = [];
  private _capabilities: Required<CapabilityOptions>;
  private _serverInfo: Required<ServerInfoOptions>;
  private _prefix = "";
  private _broadcast?: BroadcastFn;
  private _subscribedSessions = new Map<string, Set<string>>(); // uri → sessions

  constructor(options: RedopOptions = {}) {
    this._serverInfo = {
      description: options.description ?? "",
      icons: options.icons ?? [],
      instructions: options.instructions ?? "",
      name: options.name ?? DEFAULTS.name,
      title: options.title ?? "",
      version: options.version ?? DEFAULTS.version,
      websiteUrl: options.websiteUrl ?? "",
    };
    this._capabilities = {
      tools: options.capabilities?.tools ?? true,
      resources: options.capabilities?.resources ?? true,
      prompts: options.capabilities?.prompts ?? true,
    };
    if (options.schemaAdapter) {
      this._schemaAdapter = options.schemaAdapter;
    }
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
    fn: (base: { request: RequestMeta } & Context) => D | Promise<D>
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

  /** Global middleware — fires for every tool in this instance. */
  middleware<I = unknown>(mw: ToolMiddleware<I, unknown, C>): this {
    this._middlewares.push(mw as ToolMiddleware<unknown, unknown, C>);
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
   *   input:       z.object({ city: z.string() }),
   *   handler:     async ({ input }) => fetchWeather(input.city),
   * });
   */
  tool<S, I = InferSchemaOutput<S>, O = unknown>(
    name: string,
    def: ToolDef<S, I, C, O>
  ): this {
    const fullName = this._prefix ? `${this._prefix}_${name}` : name;

    let inputSchema: Record<string, unknown> = {
      additionalProperties: false,
      properties: {},
      type: "object",
    };

    if (def.input) {
      const adapter = this._schemaAdapter ?? detectAdapter(def.input);
      inputSchema = adapter.toJsonSchema(def.input);
      this._inputParsers.set(fullName, (input) =>
        adapter.parse(def.input as S, input)
      );
    }

    this._tools.set(fullName, {
      after: def.after as ResolvedTool["after"],
      annotations: def.annotations,
      before: def.before as ResolvedTool["before"],
      description: def.description,
      handler: def.handler as ResolvedTool["handler"],
      icons: def.icons,
      inputSchema,
      middleware: def.middleware as ResolvedTool["middleware"],
      name: fullName,
      outputSchema: def.outputSchema,
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
   *   handler: ({ params }) => fetchUser(params!.id),
   * });
   */
  resource(uri: string, def: ResourceDef): this {
    this._resources.set(uri, {
      uri,
      name: def.name,
      description: def.description,
      mimeType: def.mimeType,
      subscribe: def.subscribe,
      icons: def.icons,
      handler: def.handler,
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
   *     { role: "user", content: { type: "text", text: `Review this ${args?.language ?? ""} code:\n${args?.code}` } },
   *   ],
   * });
   */
  prompt(name: string, def: PromptDef): this {
    const fullName = this._prefix ? `${this._prefix}_${name}` : name;
    this._prompts.set(fullName, {
      name: fullName,
      description: def.description,
      arguments: def.arguments,
      handler: def.handler,
    });
    return this;
  }

  // ── Group ─────────────────────────────────────────────────────────────────

  /**
   * Register multiple tools, resources, and prompts under a shared prefix.
   * Hooks and middleware registered inside the callback are scoped to this
   * group — they do NOT bleed into the parent.
   */
  group(prefix: string, callback: (scoped: Redop<C>) => void): this {
    const scoped = new Redop<C>({
      name: this._serverInfo.name,
      schemaAdapter: this._schemaAdapter,
      version: this._serverInfo.version,
    });

    scoped._prefix = this._prefix ? `${this._prefix}_${prefix}` : prefix;

    // Snapshot — not shared references
    scoped._hooks = {
      after: [...this._hooks.after],
      before: [...this._hooks.before],
      error: [...this._hooks.error],
      parse: [...this._hooks.parse],
      transform: [...this._hooks.transform],
    };
    scoped._middlewares = [...this._middlewares];
    scoped._deriveFns = [...this._deriveFns];

    callback(scoped);

    for (const [n, t] of scoped._tools) {
      this._tools.set(n, t);
    }
    for (const [n, p] of scoped._inputParsers) {
      this._inputParsers.set(n, p);
    }
    for (const [u, r] of scoped._resources) {
      this._resources.set(u, r);
    }
    for (const [n, p] of scoped._prompts) {
      this._prompts.set(n, p);
    }

    return this;
  }

  /**
   * Merge another Redop instance as a plugin.
   * All hooks, middleware, tools, resources, and prompts are merged globally.
   */
  use(plugin: Redop): this {
    this._hooks.before.push(...plugin._hooks.before);
    this._hooks.after.push(...plugin._hooks.after);
    this._hooks.error.push(...plugin._hooks.error);
    this._hooks.transform.push(...plugin._hooks.transform);
    this._hooks.parse.push(...plugin._hooks.parse);
    this._middlewares.push(
      ...(plugin._middlewares as ToolMiddleware<unknown, unknown, C>[])
    );
    for (const [n, t] of plugin._tools) {
      this._tools.set(n, t);
    }
    for (const [n, p] of plugin._inputParsers) {
      this._inputParsers.set(n, p);
    }
    for (const [u, r] of plugin._resources) {
      this._resources.set(u, r);
    }
    for (const [n, p] of plugin._prompts) {
      this._prompts.set(n, p);
    }
    return this;
  }

  // ── Tool runner ───────────────────────────────────────────────────────────

  async _runTool(
    toolName: string,
    rawArgs: Record<string, unknown>,
    request: RequestMeta
  ): Promise<unknown> {
    const tool = this._tools.get(toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    // 1. Base context
    const ctx: Context = {
      headers: request.headers ?? {},
      rawParams: rawArgs,
      requestId: crypto.randomUUID(),
      sessionId: request.sessionId,
      tool: toolName,
      transport: request.transport,
    };

    // 2. Derive fns
    for (const fn of this._deriveFns) {
      Object.assign(ctx, await fn({ ...ctx, request }));
    }
    const typedCtx = ctx as C;

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
        throw ve;
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
      const chain: ToolMiddleware<unknown, unknown, C>[] = [
        ...this._middlewares,
        ...((tool.middleware ?? []) as ToolMiddleware<unknown, unknown, C>[]),
      ];
      const dispatch = async (i: number): Promise<unknown> => {
        if (i >= chain.length) {
          return tool.handler(handlerEvent);
        }
        return chain[i]!({ ...handlerEvent, next: () => dispatch(i + 1) });
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

      return result;
    } catch (err) {
      for (const h of this._hooks.error) {
        await h({ ctx: typedCtx, error: err, input, request, tool: toolName });
      }
      throw err;
    }
  }

  // ── Resource runner ───────────────────────────────────────────────────────

  async _readResource(uri: string, request: RequestMeta) {
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
      throw new Error(`Resource not found: ${uri}`);
    }

    const event: ResourceReadEvent = { uri, params: templateParams, request };
    return resolved.handler(event);
  }

  // ── Prompt runner ─────────────────────────────────────────────────────────

  async _getPrompt(
    name: string,
    args: Record<string, string> | undefined,
    request: RequestMeta
  ): Promise<PromptHandlerResult> {
    const prompt = this._prompts.get(name);
    if (!prompt) {
      throw new Error(`Prompt not found: ${name}`);
    }
    const event: PromptGetEvent = { name, arguments: args, request };
    return prompt.handler(event);
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

    const runner = (
      name: string,
      args: Record<string, unknown>,
      meta: RequestMeta
    ) => this._runTool(name, args, meta);
    const transport = opts.transport ?? (opts.port ? "http" : "stdio");

    if (transport === "stdio") {
      startStdioTransport(
        this._tools,
        this._resources,
        this._prompts,
        runner,
        (uri, req) => this._readResource(uri, req),
        (name, args, req) => this._getPrompt(name, args, req),
        this._serverInfo,
        this._resolvedCapabilities()
      );
      return this;
    }

    if (transport === "http") {
      const { broadcast } = startHttpTransport(
        this._tools,
        this._resources,
        this._prompts,
        runner,
        (uri, req) => this._readResource(uri, req),
        (name, args, req) => this._getPrompt(name, args, req),
        (uri, sid) => this._subscribeResource(uri, sid),
        (uri, sid) => this._unsubscribeResource(uri, sid),
        opts,
        this._serverInfo,
        this._resolvedCapabilities()
      );
      this._setBroadcast(broadcast);
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

export function middleware<I = unknown, C extends Context = Context>(
  fn: ToolMiddleware<I, unknown, C>
): Redop<C> {
  return new Redop<C>().middleware(fn);
}

export function definePlugin<Options, C extends Context = Context>(
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
