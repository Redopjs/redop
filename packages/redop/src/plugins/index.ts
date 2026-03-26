// ─────────────────────────────────────────────
//  redop — built-in plugins
// ─────────────────────────────────────────────

import { middleware, Redop } from "../redop";
import type { Context, ToolBeforeHookEvent, ToolHandlerEvent } from "../types";

// ── logger() ──────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error";

interface LoggerOptions {
  /** Minimum log level to emit. Default: `"info"`. */
  level?: LogLevel;
  /** Custom write function. Defaults to console.log. */
  write?: (entry: Record<string, unknown>) => void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  error: 3,
  info: 1,
  warn: 2,
};

/**
 * Log tool lifecycle events using a simple structured logger.
 *
 * Default: logs `info` and above with `console.log`.
 */
export function logger(opts: LoggerOptions = {}): Redop {
  const minLevel = LOG_LEVELS[opts.level ?? "info"];
  const write = opts.write ?? ((e) => console.log(JSON.stringify(e)));

  const log = (level: LogLevel, data: Record<string, unknown>) => {
    if (LOG_LEVELS[level] >= minLevel) {
      write({ level, ts: new Date().toISOString(), ...data });
    }
  };

  return new Redop()
    .onBeforeHandle(({ tool, ctx, request }) => {
      log("info", {
        event: "tool.start",
        requestId: ctx.requestId,
        tool,
        transport: request.transport,
      });
    })
    .onAfterHandle(({ tool, ctx }) => {
      const ms = ctx.startedAt
        ? performance.now() - (ctx.startedAt as number)
        : undefined;
      log("info", {
        event: "tool.end",
        requestId: ctx.requestId,
        tool,
        ...(ms == null ? {} : { ms: +ms.toFixed(2) }),
      });
    })
    .onError(({ tool, error, ctx }) => {
      log("error", {
        error: error instanceof Error ? error.message : String(error),
        event: "tool.error",
        requestId: ctx.requestId,
        tool,
      });
    });
}

// ── analytics() ───────────────────────────────

type AnalyticsSink =
  | "console"
  | "posthog"
  | ((event: AnalyticsEvent) => void | Promise<void>);

interface AnalyticsEvent {
  durationMs: number;
  requestId: string;
  success: boolean;
  tool: string;
}

interface AnalyticsOptions {
  /** PostHog API key (required when sink = 'posthog') */
  apiKey?: string;
  /** Event sink. Default: `"console"`. */
  sink?: AnalyticsSink;
}

/**
 * Emit tool execution analytics to console, PostHog, or a custom sink.
 *
 * Default: writes analytics events to the console.
 */
export function analytics(opts: AnalyticsOptions = {}): Redop {
  const { sink = "console", apiKey } = opts;

  async function emit(event: AnalyticsEvent) {
    if (typeof sink === "function") {
      await sink(event);
      return;
    }

    if (sink === "console") {
      console.log("[redop:analytics]", event);
      return;
    }

    if (sink === "posthog" && apiKey) {
      fetch("https://app.posthog.com/capture/", {
        body: JSON.stringify({
          api_key: apiKey,
          event: "redop_tool_call",
          distinct_id: event.requestId,
          properties: event,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }).catch(() => {});
    }
  }

  return new Redop()
    .onBeforeHandle(({ ctx }) => {
      (ctx as Record<string, unknown>).startedAt = performance.now();
      (ctx as Record<string, unknown>).analyticsSuccess = true;
    })
    .onError(({ ctx }) => {
      (ctx as Record<string, unknown>).analyticsSuccess = false;
    })
    .onAfterHandle(({ tool, ctx }) => {
      const startedAt = ctx.startedAt as number | undefined;
      const durationMs =
        startedAt == null ? 0 : +(performance.now() - startedAt).toFixed(2);
      emit({
        durationMs,
        requestId: ctx.requestId,
        success:
          ((ctx as Record<string, unknown>).analyticsSuccess as boolean) ??
          true,
        tool,
      });
    });
}

// ── Header auth / api keys ────────────────────

interface HeaderAuthOptions {
  /** Context key to populate after successful validation. */
  contextKey?: string;
  /** Legacy alias for `contextKey`. */
  ctxKey?: string;
  /** Header to read from. Defaults vary by helper. */
  headerName?: string;
  /** Whether the header must be present. Default true for HTTP transport. */
  required?: boolean;
  /** Static secret to validate against. */
  secret?: string;
  /** Custom validate function — return true to allow. */
  validate?: (
    token: string,
    event: ToolBeforeHookEvent<unknown, Context>
  ) => boolean | Promise<boolean>;
}

interface ApiKeyOptions extends Omit<HeaderAuthOptions, "validate"> {
  /** Single allowed API key. Clearer alias for `secret`. */
  key?: string;
  /** Multiple allowed API keys. */
  keys?: string[];
  /** Legacy alias for `validateKey`. */
  validate?: (
    apiKey: string,
    event: ToolBeforeHookEvent<unknown, Context>
  ) => boolean | Promise<boolean>;
  /** Clearer alias for `validate`. */
  validateKey?: (
    apiKey: string,
    event: ToolBeforeHookEvent<unknown, Context>
  ) => boolean | Promise<boolean>;
}

interface BearerOptions extends Omit<HeaderAuthOptions, "headerName"> {
  /** Override the auth scheme prefix. Default: 'Bearer' */
  scheme?: string;
}

/**
 * Validate an API key header and store the value on `ctx`.
 *
 * Default header: `x-api-key`.
 *
 * @example
 * app.use(
 *   apiKey({
 *     key: process.env.API_SECRET,
 *   })
 * );
 */
export function apiKey(opts: ApiKeyOptions = {}): Redop {
  const allowedKeys = opts.keys ? new Set(opts.keys) : null;

  return createHeaderAuthPlugin({
    contextKey: opts.contextKey ?? opts.ctxKey ?? "apiKey",
    headerName: opts.headerName ?? "x-api-key",
    required: opts.required,
    secret: opts.key ?? opts.secret,
    validate:
      opts.validateKey ??
      opts.validate ??
      (allowedKeys ? (token) => allowedKeys.has(token) : undefined),
  });
}

/**
 * Validate `Authorization` bearer tokens and store the parsed token on `ctx`.
 *
 * Default header: `authorization`.
 * Default scheme: `"Bearer"`.
 */
export function bearer(opts: BearerOptions = {}): Redop {
  const scheme = opts.scheme ?? "Bearer";

  return createHeaderAuthPlugin({
    ...opts,
    aliases: ["authToken"],
    contextKey: opts.contextKey ?? opts.ctxKey ?? "token",
    headerName: "authorization",
    transform(value) {
      const [providedScheme, ...rest] = value.trim().split(/\s+/);
      if (
        !providedScheme ||
        providedScheme.toLowerCase() !== scheme.toLowerCase()
      ) {
        throw new Error(`Unauthorized: expected ${scheme} token`);
      }

      const token = rest.join(" ").trim();
      if (!token) {
        throw new Error(`Unauthorized: missing ${scheme} token`);
      }

      return token;
    },
  });
}

function createHeaderAuthPlugin(
  opts: HeaderAuthOptions & {
    aliases?: string[];
    transform?: (value: string) => string;
  }
): Redop {
  return middleware(async ({ ctx, request, input, tool, next }) => {
    if (request.transport !== "http") {
      return next();
    }

    const headerName = (opts.headerName ?? "authorization").toLowerCase();
    const headerValue = request.headers[headerName];

    if (!(opts.secret || opts.validate)) {
      throw new Error(
        `[redop] ${headerName} auth requires either a secret or validate()`
      );
    }

    if (!headerValue) {
      if (opts.required ?? true) {
        throw new Error(`Unauthorized: missing ${headerName} header`);
      }
      return next();
    }

    const token = opts.transform
      ? opts.transform(headerValue)
      : headerValue.trim();
    const valid = opts.validate
      ? await opts.validate(token, { ctx, input, request, tool })
      : token === opts.secret;

    if (!valid) {
      throw new Error(`Unauthorized: invalid ${headerName}`);
    }

    const contextKey = opts.contextKey ?? opts.ctxKey ?? "auth";
    (ctx as Record<string, unknown>)[contextKey] = token;
    for (const alias of opts.aliases ?? []) {
      (ctx as Record<string, unknown>)[alias] = token;
    }

    return next();
  });
}

// ── rateLimit() ───────────────────────────────

interface RateLimitOptions {
  /** Key to rate-limit on. Default: IP, session, then request ID fallback. */
  keyBy?: (event: ToolHandlerEvent<unknown, Context>) => string;
  /** Max calls per window. Default 60. */
  max?: number;
  /** Window duration as ms or string like '1m', '1h'. Default '1m'. */
  window?: number | string;
}

function parseWindow(w: number | string): number {
  if (typeof w === "number") {
    return w;
  }
  const match = w.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) {
    return 60_000;
  }
  const n = match[1];
  const unit = match[2];
  if (!(n && unit)) {
    return 60_000;
  }
  const multipliers: Record<string, number> = {
    d: 86_400_000,
    h: 3_600_000,
    m: 60_000,
    ms: 1,
    s: 1000,
  };
  return Number.parseInt(n) * (multipliers[unit] ?? 1);
}

function defaultRateLimitKey(
  event: ToolHandlerEvent<unknown, Context>
): string {
  return (
    event.request.ip ??
    event.request.headers["x-forwarded-for"]?.split(",")[0]?.trim() ??
    event.request.sessionId ??
    event.ctx.requestId.slice(0, 8)
  );
}

/**
 * Limit tool execution frequency in memory.
 *
 * Default: `60` calls per `"1m"` window.
 */
export function rateLimit(opts: RateLimitOptions = {}): Redop {
  const max = opts.max ?? 60;
  const windowMs = parseWindow(opts.window ?? "1m");
  const buckets = new Map<string, number[]>();

  return middleware(async (event) => {
    const key = opts.keyBy ? opts.keyBy(event) : defaultRateLimitKey(event);
    const now = Date.now();
    const timestamps = (buckets.get(key) ?? []).filter(
      (ts) => now - ts < windowMs
    );

    if (timestamps.length >= max) {
      throw new Error(`Rate limit exceeded: ${max} calls per ${windowMs}ms`);
    }

    timestamps.push(now);
    buckets.set(key, timestamps);
    return event.next();
  });
}

// ── cache() ───────────────────────────────────

interface CacheOptions {
  /** Tools to cache. Defaults to all. */
  tools?: string[];
  /** TTL in ms. Default 60_000 (1 min). */
  ttl?: number;
}

interface CacheEntry {
  expiresAt: number;
  result: unknown;
}

/**
 * Cache successful tool results in memory by tool name and parsed input.
 *
 * Default TTL: `60_000` ms.
 */
export function cache(opts: CacheOptions = {}): Redop {
  const ttl = opts.ttl ?? 60_000;
  const allowedTools = opts.tools ? new Set(opts.tools) : null;
  const store = new Map<string, CacheEntry>();

  function hashKey(tool: string, input: unknown): string {
    return `${tool}:${JSON.stringify(input)}`;
  }

  return middleware(async ({ tool, input, next }) => {
    if (allowedTools && !allowedTools.has(tool)) {
      return next();
    }

    const key = hashKey(tool, input);
    const entry = store.get(key);

    if (entry && Date.now() < entry.expiresAt) {
      return entry.result;
    }

    const result = await next();
    store.set(key, { expiresAt: Date.now() + ttl, result });
    return result;
  });
}
