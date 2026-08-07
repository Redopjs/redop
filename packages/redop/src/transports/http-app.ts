// ─────────────────────────────────────────────
//  redop — portable HTTP app (Streamable HTTP)
//  Supports MCP 2026-07-28 (stateless) plus legacy
//  sessioned versions (2025-11-25 / 2025-03-26 / 2024-11-05).
// ─────────────────────────────────────────────

import type {
  CapabilityOptions,
  JsonRpcRequest,
  JsonRpcResponse,
  ListenOptions,
  PromptHandlerResult,
  RequestMeta,
  ResolvedPrompt,
  ResolvedResource,
  ResolvedTool,
  ResourceContents,
  ServerInfoOptions,
} from "../types";
import {
  buildProtectedResourceDocument,
  isHttpAuthError,
  protectedResourceMetadataPaths,
  type HttpAuthError,
} from "../plugins/http-auth";
import {
  buildServerCapabilities,
  clientHasTasksExtension,
  DEFAULT_LIST_CACHE,
  DEFAULT_READ_CACHE,
  HEADER_MISMATCH,
  inputRequiredResult,
  isInputRequiredError,
  isStatelessProtocol,
  isSupportedProtocolVersion,
  MISSING_REQUIRED_CLIENT_CAPABILITY,
  negotiateProtocolVersion,
  PROTOCOL_LATEST,
  PROTOCOL_LEGACY_DEFAULT,
  readProtocolMeta,
  SUPPORTED_PROTOCOL_VERSIONS,
  type SupportedProtocolVersion,
  TASKS_EXTENSION_ID,
  UNSUPPORTED_PROTOCOL_VERSION,
  validateMcpHeaders,
  withCacheHints,
  withResultType,
} from "./protocol";
import {
  scheduleAfterResponse,
  type FetchRuntime,
  type HttpFetch,
} from "./runtime";
import { SseHub } from "./sse";

export type { FetchRuntime, HttpFetch } from "./runtime";

// ── Task types ────────────────────────────────

type TaskStatus =
  | "working"
  | "input_required"
  | "completed"
  | "failed"
  | "cancelled";

interface StoredTask {
  createdAt: string;
  inputRequests?: Record<string, unknown>;
  inputResponses?: Record<string, unknown>;
  lastUpdatedAt: string;
  pollInterval?: number;
  result?: Record<string, unknown>;
  rpcError?: { code: number; message: string };
  status: TaskStatus;
  statusMessage?: string;
  taskId: string;
  ttl: number | null;
  waiters: Array<() => void>;
}

// ── Helpers ───────────────────────────────────

function isoNow() {
  return new Date().toISOString();
}

function taskPublic(t: StoredTask) {
  const {
    waiters: _w,
    result: _r,
    rpcError: _e,
    inputResponses: _ir,
    ...pub
  } = t;
  const out: Record<string, unknown> = { ...pub };
  if (t.status === "input_required" && t.inputRequests) {
    out.inputRequests = t.inputRequests;
  } else {
    delete out.inputRequests;
  }
  return out;
}

const TERMINAL = new Set<TaskStatus>(["completed", "failed", "cancelled"]);
const isTerminal = (s: TaskStatus) => TERMINAL.has(s);

function isOriginAllowed(origin: string | null, serverUrl: string): boolean {
  if (!origin) {
    return true;
  }
  try {
    const o = new URL(origin);
    const s = new URL(serverUrl);
    if (o.hostname === s.hostname) {
      return true;
    }
    const loopback = new Set(["localhost", "127.0.0.1", "::1"]);
    if (loopback.has(s.hostname) && loopback.has(o.hostname)) {
      return true;
    }
    if (o.hostname === "localhost" || o.hostname === "127.0.0.1") {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Session + task store ──────────────────────

const TASK_RESULT_TIMEOUT_MS = 30_000;

function createStore(sessionTimeoutMs: number) {
  const sessions = new Map<string, { lastSeen: number }>();
  const tasks = new Map<string, StoredTask>();

  // Cloudflare Workers forbid timers at module top-level. Start the sweeper
  // lazily on first use (typically the first request) instead.
  let timer: ReturnType<typeof setInterval> | null = null;

  const ensureTimer = () => {
    if (timer !== null || sessionTimeoutMs <= 0) {
      return;
    }
    timer = setInterval(() => {
      const now = Date.now();
      for (const [id, s] of sessions) {
        if (now - s.lastSeen > sessionTimeoutMs) {
          sessions.delete(id);
        }
      }
      for (const [, t] of tasks) {
        if (t.ttl === null) {
          continue;
        }
        if (now - new Date(t.createdAt).getTime() > t.ttl) {
          for (const w of t.waiters) {
            w();
          }
          tasks.delete(t.taskId);
        }
      }
    }, 30_000);

    if (
      typeof timer === "object" &&
      timer !== null &&
      "unref" in timer &&
      typeof timer.unref === "function"
    ) {
      timer.unref();
    }
  };

  return {
    sessions: {
      create() {
        ensureTimer();
        const id = crypto.randomUUID();
        sessions.set(id, { lastSeen: Date.now() });
        return id;
      },
      touch(id: string) {
        ensureTimer();
        const s = sessions.get(id);
        if (!s) {
          return false;
        }
        s.lastSeen = Date.now();
        return true;
      },
      has(id: string) {
        return sessions.has(id);
      },
      delete(id: string) {
        sessions.delete(id);
      },
      ids(): IterableIterator<string> {
        return sessions.keys();
      },
    },
    tasks: {
      create(ttl?: number): StoredTask {
        ensureTimer();
        const now = isoNow();
        const t: StoredTask = {
          taskId: crypto.randomUUID(),
          status: "working",
          createdAt: now,
          lastUpdatedAt: now,
          ttl: ttl ?? null,
          pollInterval: 2000,
          waiters: [],
        };
        tasks.set(t.taskId, t);
        return t;
      },
      get(id: string) {
        return tasks.get(id);
      },
      complete(id: string, result: Record<string, unknown>) {
        const t = tasks.get(id);
        if (!t || isTerminal(t.status)) {
          return;
        }
        t.status = "completed";
        t.lastUpdatedAt = isoNow();
        t.result = result;
        this._wake(t);
      },
      fail(id: string, error: string | { code: number; message: string }) {
        const t = tasks.get(id);
        if (!t || isTerminal(t.status)) {
          return;
        }
        t.status = "failed";
        t.lastUpdatedAt = isoNow();
        if (typeof error === "string") {
          t.statusMessage = error;
          t.result = {
            content: [{ type: "text", text: error }],
            isError: true,
          };
        } else {
          t.rpcError = error;
          t.statusMessage = error.message;
        }
        this._wake(t);
      },
      cancel(id: string) {
        const t = tasks.get(id);
        if (!t || isTerminal(t.status)) {
          return false;
        }
        t.status = "cancelled";
        t.lastUpdatedAt = isoNow();
        t.statusMessage = "Cancelled by request.";
        this._wake(t);
        return true;
      },
      requireInput(
        id: string,
        inputRequests: Record<string, unknown>,
        statusMessage?: string
      ) {
        const t = tasks.get(id);
        if (!t || isTerminal(t.status)) {
          return false;
        }
        t.status = "input_required";
        t.inputRequests = inputRequests;
        t.lastUpdatedAt = isoNow();
        if (statusMessage) {
          t.statusMessage = statusMessage;
        }
        this._wake(t);
        return true;
      },
      update(
        id: string,
        inputResponses?: Record<string, unknown>
      ): { ok: true; task: StoredTask } | { ok: false; error: string } {
        const t = tasks.get(id);
        if (!t) {
          return { ok: false, error: "Task not found" };
        }
        if (isTerminal(t.status)) {
          return {
            ok: false,
            error: `Already in terminal status '${t.status}'`,
          };
        }
        if (inputResponses && typeof inputResponses === "object") {
          t.inputResponses = {
            ...(t.inputResponses ?? {}),
            ...inputResponses,
          };
        }
        t.inputRequests = undefined;
        t.status = "working";
        t.lastUpdatedAt = isoNow();
        t.statusMessage = undefined;
        this._wake(t);
        return { ok: true, task: t };
      },
      list(cursor?: string, limit = 50) {
        const all = [...tasks.values()];
        const start = cursor ? Number.parseInt(cursor) : 0;
        const page = all.slice(start, start + limit);
        return {
          tasks: page.map(taskPublic),
          nextCursor:
            start + limit < all.length ? String(start + limit) : undefined,
        };
      },
      /**
       * Wait for a task to reach a terminal state, with a hard deadline.
       *
       * Returns the task (possibly still non-terminal if the deadline fires
       * before the task completes). Callers must check `task.status`.
       */
      waitForCompletion(
        id: string,
        timeoutMs = TASK_RESULT_TIMEOUT_MS
      ): Promise<StoredTask | null> {
        return new Promise((resolve) => {
          const t = tasks.get(id);
          if (!t) {
            return resolve(null);
          }
          if (isTerminal(t.status)) {
            return resolve(t);
          }

          const deadline = setTimeout(() => {
            resolve(tasks.get(id) ?? null);
          }, timeoutMs);

          t.waiters.push(() => {
            clearTimeout(deadline);
            resolve(tasks.get(id) ?? null);
          });
        });
      },
      _wake(t: StoredTask) {
        for (const w of t.waiters) {
          w();
        }
        t.waiters = [];
      },
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

// ── JSON-RPC Handlers Map ─────────────────────────

interface RpcContext {
  caps: Required<CapabilityOptions>;
  getPrompt: (
    name: string,
    args: Record<string, string> | undefined,
    req: RequestMeta
  ) => Promise<DeferredExecution<PromptHandlerResult>>;
  hub: SseHub;
  listCache: { cacheScope: "public" | "private"; ttlMs: number };
  prompts: Map<string, ResolvedPrompt>;
  protocolVersion: SupportedProtocolVersion;
  readResource: (
    uri: string,
    req: RequestMeta
  ) => Promise<DeferredExecution<ResourceContents>>;
  requestMeta: RequestMeta;
  resources: Map<string, ResolvedResource>;
  runTool: (
    name: string,
    args: Record<string, unknown>,
    meta: RequestMeta
  ) => Promise<DeferredExecution<unknown>>;
  serverInfo: Required<ServerInfoOptions>;
  sessionId: string;
  store: ReturnType<typeof createStore>;
  subscribeRes: (uri: string, sid: string) => void;
  tools: Map<string, ResolvedTool>;
  unsubscribeRes: (uri: string, sid: string) => void;
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

type RpcResponsePayload = {
  afterResponse?: () => Promise<void>;
  result?: any;
  error?: { code: number; message: string };
  /** Transport-level OAuth/JWT challenge — mapped to HTTP 401/403. */
  httpAuth?: HttpAuthError;
};
type RpcHandler = (
  params: any,
  ctx: RpcContext
) => Promise<RpcResponsePayload> | RpcResponsePayload;

// ── Notification handlers (client → server, no id, no response) ──────────────

type NotificationHandler = (params: any, ctx: RpcContext) => void;

const NOTIFICATION_HANDLERS: Record<string, NotificationHandler> = {
  "notifications/cancelled": (params, ctx) => {
    const taskId = params?.taskId as string | undefined;
    if (taskId) {
      ctx.store.tasks.cancel(taskId);
    }
  },
  "notifications/initialized": (_params, _ctx) => {
    // Client confirms it has processed initialize. No action required server-side.
  },
  "notifications/roots/list_changed": (_params, _ctx) => {
    // Future: trigger re-fetch of roots from client.
  },
};

// ── Request handlers ──────────────────────────

const RPC_HANDLERS: Record<string, RpcHandler> = {
  initialize: (params, ctx) => {
    // 2026-07-28 retired initialize; keep it for dual-mode clients that still
    // speak older revisions (or probe with initialize).
    if (isStatelessProtocol(ctx.protocolVersion)) {
      return {
        result: withResultType(
          withCacheHints(
            {
              supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
              capabilities: buildServerCapabilities(ctx.caps, ctx.protocolVersion),
              instructions: ctx.serverInfo.instructions,
              serverInfo: ctx.serverInfo,
            },
            ctx.listCache,
            ctx.protocolVersion
          ),
          ctx.protocolVersion
        ),
      };
    }

    return {
      result: {
        protocolVersion: ctx.protocolVersion,
        capabilities: buildServerCapabilities(ctx.caps, ctx.protocolVersion),
        serverInfo: ctx.serverInfo,
        instructions: ctx.serverInfo.instructions,
        sessionId: ctx.sessionId,
      },
    };
  },

  "server/discover": (_params, ctx) => {
    return {
      result: withResultType(
        withCacheHints(
          {
            supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
            capabilities: buildServerCapabilities(ctx.caps, ctx.protocolVersion),
            instructions: ctx.serverInfo.instructions,
            serverInfo: {
              name: ctx.serverInfo.name,
              version: ctx.serverInfo.version,
              ...(ctx.serverInfo.title ? { title: ctx.serverInfo.title } : {}),
              ...(ctx.serverInfo.description
                ? { description: ctx.serverInfo.description }
                : {}),
              ...(ctx.serverInfo.websiteUrl
                ? { websiteUrl: ctx.serverInfo.websiteUrl }
                : {}),
              ...(ctx.serverInfo.icons?.length
                ? { icons: ctx.serverInfo.icons }
                : {}),
            },
          },
          ctx.listCache,
          // Always include cache hints on discover — it is a 2026-07-28 RPC.
          PROTOCOL_LATEST
        ),
        PROTOCOL_LATEST
      ),
    };
  },

  ping: () => ({ result: {} }),

  "tools/list": (_params, ctx) => {
    if (!ctx.caps.tools) {
      return {
        error: { code: -32_601, message: "Tools capability not enabled" },
      };
    }
    return {
      result: withResultType(
        withCacheHints(
          {
            tools: [...ctx.tools.values()].map((t) => ({
              name: t.name,
              description: t.description ?? "",
              inputSchema: t.inputSchema,
              ...(t.title ? { title: t.title } : {}),
              ...(t.icons?.length ? { icons: t.icons } : {}),
              ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
              ...(t.annotations ? { annotations: t.annotations } : {}),
              execution: { taskSupport: t.taskSupport ?? "optional" },
            })),
          },
          ctx.listCache,
          ctx.protocolVersion
        ),
        ctx.protocolVersion
      ),
    };
  },

  "tools/call": async (params, ctx) => {
    if (!ctx.caps.tools) {
      return {
        error: { code: -32_601, message: "Tools capability not enabled" },
      };
    }
    const p = params as {
      name: string;
      arguments?: unknown;
      task?: { ttl?: number };
      inputResponses?: Record<string, unknown>;
      requestState?: string;
      _meta?: { progressToken?: string | number };
    };
    const tool = ctx.tools.get(p.name);
    if (!tool) {
      return { error: { code: -32_602, message: `Unknown tool: ${p.name}` } };
    }

    const stateless = isStatelessProtocol(ctx.protocolVersion);
    const wantsTask =
      !stateless && p.task !== undefined
        ? true
        : Boolean(
            stateless &&
              clientHasTasksExtension(ctx.requestMeta.clientCapabilities) &&
              tool.taskSupport === "required"
          );

    if (wantsTask) {
      const task = ctx.store.tasks.create(
        !stateless ? p.task?.ttl : undefined
      );
      (async () => {
        try {
          const execution = await ctx.runTool(
            p.name,
            (p.arguments ?? {}) as Record<string, unknown>,
            ctx.requestMeta
          );
          if (!execution.ok) {
            if (
              isInputRequiredError(execution.error) &&
              isStatelessProtocol(ctx.protocolVersion)
            ) {
              ctx.store.tasks.requireInput(
                task.taskId,
                (execution.error.inputRequests ?? {}) as Record<
                  string,
                  unknown
                >,
                execution.error.message
              );
              queueMicrotask(() => {
                void execution.afterResponse().catch(() => {});
              });
              return;
            }
            ctx.store.tasks.fail(task.taskId, String(execution.error));
            queueMicrotask(() => {
              void execution.afterResponse().catch(() => {});
            });
            return;
          }
          const raw = execution.result;
          const result: Record<string, unknown> = {
            content: [{ type: "text", text: JSON.stringify(raw) }],
            _meta: {
              "io.modelcontextprotocol/related-task": { taskId: task.taskId },
            },
          };
          if (tool.outputSchema && raw !== null && typeof raw === "object") {
            result.structuredContent = raw;
          }
          ctx.store.tasks.complete(task.taskId, result);
          queueMicrotask(() => {
            void execution.afterResponse().catch(() => {});
          });
        } catch (e) {
          ctx.store.tasks.fail(task.taskId, String(e));
        }
      })();
      return {
        result: withResultType(
          { task: taskPublic(task) },
          ctx.protocolVersion,
          "task"
        ),
      };
    }

    try {
      const execution = await ctx.runTool(
        p.name,
        (p.arguments ?? {}) as Record<string, unknown>,
        ctx.requestMeta
      );
      if (!execution.ok) {
        if (
          isInputRequiredError(execution.error) &&
          isStatelessProtocol(ctx.protocolVersion)
        ) {
          return {
            afterResponse: execution.afterResponse,
            result: inputRequiredResult(execution.error),
          };
        }
        if (isHttpAuthError(execution.error)) {
          return {
            afterResponse: execution.afterResponse,
            httpAuth: execution.error,
          };
        }
        return {
          afterResponse: execution.afterResponse,
          result: withResultType(
            {
              content: [{ type: "text", text: String(execution.error) }],
              isError: true,
            },
            ctx.protocolVersion
          ),
        };
      }
      const raw = execution.result;
      const result: Record<string, unknown> = {
        content: [{ type: "text", text: JSON.stringify(raw) }],
      };
      if (tool.outputSchema && raw !== null && typeof raw === "object") {
        result.structuredContent = raw;
      }
      return {
        afterResponse: execution.afterResponse,
        result: withResultType(result, ctx.protocolVersion),
      };
    } catch (e) {
      if (isInputRequiredError(e) && isStatelessProtocol(ctx.protocolVersion)) {
        return { result: inputRequiredResult(e) };
      }
      if (isHttpAuthError(e)) {
        return { httpAuth: e };
      }
      return {
        result: withResultType(
          { content: [{ type: "text", text: String(e) }], isError: true },
          ctx.protocolVersion
        ),
      };
    }
  },

  "resources/list": (_params, ctx) => {
    if (!ctx.caps.resources) {
      return {
        error: { code: -32_601, message: "Resources capability not enabled" },
      };
    }
    const staticRes = [...ctx.resources.values()].filter((r) => !r.isTemplate);
    return {
      result: withResultType(
        withCacheHints(
          {
            resources: staticRes.map((r) => ({
              uri: r.uri,
              name: r.name,
              ...(r.description ? { description: r.description } : {}),
              ...(r.mimeType ? { mimeType: r.mimeType } : {}),
              ...(r.icons?.length ? { icons: r.icons } : {}),
            })),
          },
          ctx.listCache,
          ctx.protocolVersion
        ),
        ctx.protocolVersion
      ),
    };
  },

  "resources/templates/list": (_params, ctx) => {
    if (!ctx.caps.resources) {
      return {
        error: { code: -32_601, message: "Resources capability not enabled" },
      };
    }
    const templateRes = [...ctx.resources.values()].filter((r) => r.isTemplate);
    return {
      result: withResultType(
        withCacheHints(
          {
            resourceTemplates: templateRes.map((r) => ({
              uriTemplate: r.uri,
              name: r.name,
              ...(r.description ? { description: r.description } : {}),
              ...(r.mimeType ? { mimeType: r.mimeType } : {}),
            })),
          },
          ctx.listCache,
          ctx.protocolVersion
        ),
        ctx.protocolVersion
      ),
    };
  },

  "resources/read": async (params, ctx) => {
    if (!ctx.caps.resources) {
      return {
        error: { code: -32_601, message: "Resources capability not enabled" },
      };
    }
    const uri = params?.uri as string | undefined;
    if (!uri) {
      return { error: { code: -32_602, message: "Missing uri param" } };
    }
    try {
      const execution = await ctx.readResource(uri, ctx.requestMeta);
      if (!execution.ok) {
        if (
          isInputRequiredError(execution.error) &&
          isStatelessProtocol(ctx.protocolVersion)
        ) {
          return {
            afterResponse: execution.afterResponse,
            result: inputRequiredResult(execution.error),
          };
        }
        if (isHttpAuthError(execution.error)) {
          return {
            afterResponse: execution.afterResponse,
            httpAuth: execution.error,
          };
        }
        return {
          afterResponse: execution.afterResponse,
          error: {
            code: -32_602,
            message:
              execution.error instanceof Error
                ? execution.error.message
                : String(execution.error),
          },
        };
      }
      const contents = execution.result;
      const wireContent =
        contents.type === "text"
          ? { uri, mimeType: contents.mimeType, text: contents.text }
          : { uri, mimeType: contents.mimeType, blob: contents.blob };
      return {
        afterResponse: execution.afterResponse,
        result: withResultType(
          withCacheHints(
            { contents: [wireContent] },
            DEFAULT_READ_CACHE,
            ctx.protocolVersion
          ),
          ctx.protocolVersion
        ),
      };
    } catch (e) {
      if (isInputRequiredError(e) && isStatelessProtocol(ctx.protocolVersion)) {
        return { result: inputRequiredResult(e) };
      }
      if (isHttpAuthError(e)) {
        return { httpAuth: e };
      }
      return { error: { code: -32_602, message: String(e) } };
    }
  },

  "resources/subscribe": (params, ctx) => {
    if (isStatelessProtocol(ctx.protocolVersion)) {
      return {
        error: {
          code: -32_601,
          message:
            "resources/subscribe is replaced by subscriptions/listen in MCP 2026-07-28",
        },
      };
    }
    if (!ctx.caps.resources) {
      return {
        error: { code: -32_601, message: "Resources capability not enabled" },
      };
    }
    const uri = params?.uri as string | undefined;
    if (!uri) {
      return { error: { code: -32_602, message: "Missing uri" } };
    }
    ctx.subscribeRes(uri, ctx.sessionId);
    return { result: {} };
  },

  "resources/unsubscribe": (params, ctx) => {
    if (isStatelessProtocol(ctx.protocolVersion)) {
      return {
        error: {
          code: -32_601,
          message:
            "resources/unsubscribe is replaced by subscriptions/listen in MCP 2026-07-28",
        },
      };
    }
    if (!ctx.caps.resources) {
      return {
        error: { code: -32_601, message: "Resources capability not enabled" },
      };
    }
    const uri = params?.uri as string | undefined;
    if (!uri) {
      return { error: { code: -32_602, message: "Missing uri" } };
    }
    ctx.unsubscribeRes(uri, ctx.sessionId);
    return { result: {} };
  },

  "prompts/list": (_params, ctx) => {
    if (!ctx.caps.prompts) {
      return {
        error: { code: -32_601, message: "Prompts capability not enabled" },
      };
    }
    return {
      result: withResultType(
        withCacheHints(
          {
            prompts: [...ctx.prompts.values()].map((p) => ({
              name: p.name,
              ...(p.description ? { description: p.description } : {}),
              ...(p.arguments?.length ? { arguments: p.arguments } : {}),
            })),
          },
          ctx.listCache,
          ctx.protocolVersion
        ),
        ctx.protocolVersion
      ),
    };
  },

  "prompts/get": async (params, ctx) => {
    if (!ctx.caps.prompts) {
      return {
        error: { code: -32_601, message: "Prompts capability not enabled" },
      };
    }
    const name = params?.name as string | undefined;
    const args = params?.arguments as Record<string, string> | undefined;
    if (!name) {
      return { error: { code: -32_602, message: "Missing name" } };
    }
    try {
      const execution = await ctx.getPrompt(name, args, ctx.requestMeta);
      if (!execution.ok) {
        if (
          isInputRequiredError(execution.error) &&
          isStatelessProtocol(ctx.protocolVersion)
        ) {
          return {
            afterResponse: execution.afterResponse,
            result: inputRequiredResult(execution.error),
          };
        }
        if (isHttpAuthError(execution.error)) {
          return {
            afterResponse: execution.afterResponse,
            httpAuth: execution.error,
          };
        }
        return {
          afterResponse: execution.afterResponse,
          error: {
            code: -32_602,
            message:
              execution.error instanceof Error
                ? execution.error.message
                : String(execution.error),
          },
        };
      }
      const raw = execution.result;
      const result = Array.isArray(raw) ? { messages: raw } : raw;
      return {
        afterResponse: execution.afterResponse,
        result: withResultType(
          result as Record<string, unknown>,
          ctx.protocolVersion
        ),
      };
    } catch (e) {
      if (isInputRequiredError(e) && isStatelessProtocol(ctx.protocolVersion)) {
        return { result: inputRequiredResult(e) };
      }
      if (isHttpAuthError(e)) {
        return { httpAuth: e };
      }
      return { error: { code: -32_602, message: String(e) } };
    }
  },

  "tasks/get": (params, ctx) => {
    if (
      isStatelessProtocol(ctx.protocolVersion) &&
      !clientHasTasksExtension(ctx.requestMeta.clientCapabilities)
    ) {
      return {
        error: {
          code: MISSING_REQUIRED_CLIENT_CAPABILITY,
          message: `Missing required client capability: extensions.${TASKS_EXTENSION_ID}`,
        },
      };
    }
    const task = ctx.store.tasks.get(params?.taskId);
    if (!task) {
      return { error: { code: -32_602, message: "Task not found" } };
    }
    return {
      result: withResultType(taskPublic(task), ctx.protocolVersion),
    };
  },

  "tasks/update": (params, ctx) => {
    if (isStatelessProtocol(ctx.protocolVersion)) {
      if (!clientHasTasksExtension(ctx.requestMeta.clientCapabilities)) {
        return {
        error: {
          code: MISSING_REQUIRED_CLIENT_CAPABILITY,
          message: `Missing required client capability: extensions.${TASKS_EXTENSION_ID}`,
        },
      };
      }
    }
    const taskId = params?.taskId as string | undefined;
    if (!taskId) {
      return { error: { code: -32_602, message: "Missing taskId" } };
    }
    const updated = ctx.store.tasks.update(
      taskId,
      params?.inputResponses as Record<string, unknown> | undefined
    );
    if (!updated.ok) {
      return { error: { code: -32_602, message: updated.error } };
    }
    return {
      result: withResultType({}, ctx.protocolVersion),
    };
  },

  "tasks/result": async (params, ctx) => {
    if (isStatelessProtocol(ctx.protocolVersion)) {
      return {
        error: {
          code: -32_601,
          message:
            "tasks/result was removed in MCP 2026-07-28; poll with tasks/get",
        },
      };
    }
    const taskId = params?.taskId as string | undefined;
    if (!taskId) {
      return { error: { code: -32_602, message: "Missing taskId" } };
    }

    const task = ctx.store.tasks.get(taskId);
    if (!task) {
      return { error: { code: -32_602, message: "Task not found" } };
    }

    // waitForCompletion has a hard 30s deadline — it returns the task regardless
    // of its status, so we must check whether it actually completed.
    const final = await ctx.store.tasks.waitForCompletion(taskId);
    if (!final) {
      return { error: { code: -32_602, message: "Task expired" } };
    }

    if (!isTerminal(final.status)) {
      // Deadline fired before completion — tell the client to try again.
      return {
        error: {
          code: -32_001,
          message: `Task still ${final.status}. Poll again via tasks/get or retry tasks/result.`,
        },
      };
    }

    if (final.rpcError) {
      return { error: final.rpcError };
    }

    return {
      result: {
        ...final.result,
        _meta: { "io.modelcontextprotocol/related-task": { taskId } },
      },
    };
  },

  "tasks/list": (params, ctx) => {
    if (isStatelessProtocol(ctx.protocolVersion)) {
      return {
        error: {
          code: -32_601,
          message: "tasks/list is not part of the io.modelcontextprotocol/tasks extension",
        },
      };
    }
    const { tasks: taskList, nextCursor } = ctx.store.tasks.list(
      params?.cursor
    );
    return {
      result: nextCursor
        ? { tasks: taskList, nextCursor }
        : { tasks: taskList },
    };
  },

  "tasks/cancel": (params, ctx) => {
    if (
      isStatelessProtocol(ctx.protocolVersion) &&
      !clientHasTasksExtension(ctx.requestMeta.clientCapabilities)
    ) {
      return {
        error: {
          code: MISSING_REQUIRED_CLIENT_CAPABILITY,
          message: `Missing required client capability: extensions.${TASKS_EXTENSION_ID}`,
        },
      };
    }
    const taskId = params?.taskId as string | undefined;
    if (!taskId) {
      return { error: { code: -32_602, message: "Missing taskId" } };
    }

    const task = ctx.store.tasks.get(taskId);
    if (!task) {
      return { error: { code: -32_602, message: "Task not found" } };
    }

    if (isTerminal(task.status)) {
      return {
        error: {
          code: -32_602,
          message: `Already in terminal status '${task.status}'`,
        },
      };
    }

    ctx.store.tasks.cancel(taskId);
    return {
      result: withResultType(
        taskPublic(ctx.store.tasks.get(taskId)!),
        ctx.protocolVersion
      ),
    };
  },
};

// ── JSON-RPC dispatcher ───────────────────────

async function handleJsonRpc(
  body: JsonRpcRequest,
  ctx: RpcContext
): Promise<
  JsonRpcResponse & {
    afterResponse?: () => Promise<void>;
    httpAuth?: HttpAuthError;
  }
> {
  const { id, method, params } = body;
  const handler = RPC_HANDLERS[method];

  if (!handler) {
    return {
      id,
      jsonrpc: "2.0",
      error: { code: -32_601, message: "Method not found" },
    };
  }

  try {
    const payload = await handler(params, ctx);
    return { id, jsonrpc: "2.0", ...payload };
  } catch (err) {
    if (isHttpAuthError(err)) {
      return { id, jsonrpc: "2.0", httpAuth: err };
    }
    return {
      id,
      jsonrpc: "2.0",
      error: { code: -32_603, message: `Internal error: ${err}` },
    };
  }
}

// ── Portable HTTP app ─────────────────────────

export interface TransportHandle {
  /**
   * Broadcast to all sessions that have an open SSE stream.
   * Use for notifications/tools/list_changed, notifications/resources/list_changed, etc.
   */
  broadcast(payload: unknown, options?: { event?: string }): void;
  /**
   * Push a server-initiated notification or request to a specific session.
   * Returns false if the session has no open SSE stream (message is dropped).
   */
  push(
    sessionId: string,
    payload: unknown,
    options?: { event?: string }
  ): boolean;
  stop(): void;
}

export interface HttpApp extends TransportHandle {
  /** Portable MCP fetch handler. */
  fetch: HttpFetch;
}

export type HttpAppOptions = Pick<
  ListenOptions,
  | "cors"
  | "debug"
  | "health"
  | "maxBodySize"
  | "path"
  | "sessionTimeout"
  | "listCache"
  | "protectedResource"
>;

export function createHttpApp(
  tools: Map<string, ResolvedTool>,
  resources: Map<string, ResolvedResource>,
  prompts: Map<string, ResolvedPrompt>,
  runTool: (
    name: string,
    args: Record<string, unknown>,
    meta: RequestMeta
  ) => Promise<DeferredExecution<unknown>>,
  readResource: (
    uri: string,
    req: RequestMeta
  ) => Promise<DeferredExecution<ResourceContents>>,
  getPrompt: (
    name: string,
    args: Record<string, string> | undefined,
    req: RequestMeta
  ) => Promise<DeferredExecution<PromptHandlerResult>>,
  subscribeRes: (uri: string, sid: string) => void,
  unsubscribeRes: (uri: string, sid: string) => void,
  opts: HttpAppOptions,
  serverInfo: Required<ServerInfoOptions>,
  caps: Required<CapabilityOptions>
): HttpApp {
  const debug = opts.debug ?? false;
  const store = createStore(opts.sessionTimeout ?? 60_000);
  const mcpPath = opts.path ?? "/mcp";
  const hub = new SseHub();
  const listCache = {
    ttlMs: opts.listCache?.ttlMs ?? DEFAULT_LIST_CACHE.ttlMs,
    cacheScope: opts.listCache?.cacheScope ?? DEFAULT_LIST_CACHE.cacheScope,
  };

  let healthPath: string | null = null;
  if (opts.health === true) {
    healthPath = "/health";
  } else if (opts.health && typeof opts.health === "object") {
    const p = opts.health.path?.trim() || "/health";
    healthPath = p.startsWith("/") ? p : `/${p}`;
  }

  if (healthPath && healthPath === mcpPath) {
    throw new Error("[redop:http] health path cannot match the MCP path");
  }

  function debugLog(event: string, data: Record<string, unknown>) {
    if (!debug) {
      return;
    }
    console.error(`[redop:http] ${event}`, data);
  }

  const fetch: HttpFetch = async (req, runtime) => {
      const url = new URL(req.url);
      const origin = req.headers.get("origin");
      const ver = req.headers.get("mcp-protocol-version");

      debugLog("request", {
        method: req.method,
        url: req.url,
        protocolVersion: ver,
        sessionId: req.headers.get("mcp-session-id"),
        mcpMethod: req.headers.get("mcp-method"),
        accept: req.headers.get("accept"),
        origin,
      });

      // ── Origin guard (DNS-rebinding) ─────────
      if (!isOriginAllowed(origin, req.url)) {
        debugLog("forbidden_origin", { origin, url: req.url });
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32_600, message: "Forbidden" },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }

      // ── CORS preflight ────────────────────────
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": origin ?? "*",
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, Accept, Authorization, MCP-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID",
            "Access-Control-Expose-Headers":
              "WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id",
          },
        });
      }

      // ── Health ────────────────────────────────
      if (
        healthPath &&
        (req.method === "GET" || req.method === "HEAD") &&
        url.pathname === healthPath
      ) {
        if (req.method === "HEAD") {
          return new Response(null, { status: 200 });
        }
        return Response.json({
          ok: true,
          mcpPath,
          service: serverInfo.name,
          transport: "http",
        });
      }

      // ── OAuth Protected Resource Metadata (RFC 9728) ─
      if (
        opts.protectedResource &&
        (req.method === "GET" || req.method === "HEAD")
      ) {
        const paths = protectedResourceMetadataPaths(mcpPath);
        if (
          url.pathname === paths.root ||
          url.pathname === paths.suffixed
        ) {
          if (req.method === "HEAD") {
            return new Response(null, {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": origin ?? "*",
              },
            });
          }
          return Response.json(
            buildProtectedResourceDocument(opts.protectedResource),
            {
              headers: {
                "Access-Control-Allow-Origin": origin ?? "*",
                "Cache-Control": "public, max-age=3600",
              },
            }
          );
        }
      }

      // ── Protocol version guard ────────────────
      if (ver && !isSupportedProtocolVersion(ver)) {
        debugLog("unsupported_version", { url: req.url, protocolVersion: ver });
        return Response.json(
          {
            jsonrpc: "2.0",
            id: null,
            error: {
              code: UNSUPPORTED_PROTOCOL_VERSION,
              message: "Unsupported MCP-Protocol-Version",
              data: {
                supported: [...SUPPORTED_PROTOCOL_VERSIONS],
                requested: ver,
              },
            },
          },
          { status: 400 }
        );
      }

      if (url.pathname !== mcpPath) {
        return new Response("Not Found", { status: 404 });
      }

      // ── DELETE — session termination (legacy) ─
      if (req.method === "DELETE") {
        if (isStatelessProtocol(ver ?? undefined)) {
          return Response.json(
            {
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32_600,
                message:
                  "Sessions are not used in MCP 2026-07-28; DELETE is not applicable",
              },
            },
            { status: 400 }
          );
        }
        const sid = req.headers.get("mcp-session-id");
        if (!(sid && store.sessions.has(sid))) {
          debugLog("session_close_missing", { sessionId: sid });
          return Response.json({ error: "Session not found" }, { status: 404 });
        }
        debugLog("session_closed", { sessionId: sid });
        store.sessions.delete(sid);
        hub.closeSession(sid);
        return Response.json({ ok: true, sessionId: sid, terminated: true });
      }

      // ── GET — legacy SSE stream ───────────────
      if (req.method === "GET") {
        if (isStatelessProtocol(ver ?? undefined)) {
          return Response.json(
            {
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32_600,
                message:
                  "Use POST subscriptions/listen for notifications in MCP 2026-07-28",
              },
            },
            { status: 400 }
          );
        }
        if (!(req.headers.get("accept") ?? "").includes("text/event-stream")) {
          return new Response("Not Acceptable", { status: 406 });
        }

        const sid = req.headers.get("mcp-session-id");
        if (!(sid && store.sessions.has(sid))) {
          debugLog("sse_invalid_session", { sessionId: sid });
          return Response.json({ error: "Session not found" }, { status: 404 });
        }

        // Long-lived SSE: adapters (e.g. Bun) disable idle timeouts via runtime.
        runtime?.disableIdleTimeout?.(req);

        debugLog("sse_open", { sessionId: sid });

        const { stream } = hub.open(sid, req.headers.get("last-event-id"));

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Mcp-Session-Id": sid,
            "Access-Control-Allow-Origin": origin ?? "*",
            // nginx: prevent proxy buffering from holding SSE frames
            "X-Accel-Buffering": "no",
          },
        });
      }

      // ── POST — JSON-RPC ───────────────────────
      if (req.method === "POST") {
        let body: JsonRpcRequest;
        try {
          body = (await req.json()) as JsonRpcRequest;
        } catch {
          debugLog("parse_error", { url: req.url });
          return Response.json(
            {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32_700, message: "Parse error" },
            },
            { status: 400 }
          );
        }

        const metaInfo = readProtocolMeta(
          body.params as Record<string, unknown> | undefined
        );
        const headerVersion = ver ?? undefined;
        const metaVersion = metaInfo.protocolVersion;

        if (
          headerVersion &&
          metaVersion &&
          headerVersion !== metaVersion
        ) {
          return Response.json(
            {
              jsonrpc: "2.0",
              id: body.id ?? null,
              error: {
                code: HEADER_MISMATCH,
                message: `Header mismatch: MCP-Protocol-Version header value '${headerVersion}' does not match body _meta value '${metaVersion}'`,
              },
            },
            { status: 400 }
          );
        }

        const requestedVersion =
          headerVersion ??
          metaVersion ??
          (body.method === "initialize"
            ? ((body.params as { protocolVersion?: string } | undefined)
                ?.protocolVersion ?? undefined)
            : undefined);

        if (requestedVersion && !isSupportedProtocolVersion(requestedVersion)) {
          return Response.json(
            {
              jsonrpc: "2.0",
              id: body.id ?? null,
              error: {
                code: UNSUPPORTED_PROTOCOL_VERSION,
                message: "Unsupported MCP-Protocol-Version",
                data: {
                  supported: [...SUPPORTED_PROTOCOL_VERSIONS],
                  requested: requestedVersion,
                },
              },
            },
            { status: 400 }
          );
        }

        const protocolVersion = negotiateProtocolVersion(
          requestedVersion,
          body.method === "server/discover"
            ? PROTOCOL_LATEST
            : PROTOCOL_LEGACY_DEFAULT
        );
        const stateless = isStatelessProtocol(protocolVersion);

        // ── Client-sent notifications (no id) ────
        if (body.id === undefined || body.id === null) {
          if (body.method) {
            const notifHandler = NOTIFICATION_HANDLERS[body.method];
            if (notifHandler) {
              const sid = req.headers.get("mcp-session-id");
              const activeSession =
                !stateless && sid && store.sessions.has(sid) ? sid : "";
              const ctx: RpcContext = buildCtx(
                activeSession,
                protocolVersion,
                undefined,
                req
              );
              try {
                notifHandler(body.params, ctx);
              } catch (e) {
                debugLog("notification_handler_error", {
                  method: body.method,
                  error: String(e),
                });
              }
            } else {
              debugLog("ignored_notification", { method: body.method });
            }
          }
          return new Response(null, { status: 202 });
        }

        if (!body.method) {
          return new Response(null, { status: 202 });
        }

        // ── Header validation (2026-07-28) ───────
        if (stateless) {
          const headerError = validateMcpHeaders({
            method: body.method,
            params: body.params as Record<string, unknown> | undefined,
            mcpMethodHeader: req.headers.get("mcp-method"),
            mcpNameHeader: req.headers.get("mcp-name"),
          });
          if (headerError) {
            debugLog("header_mismatch", {
              method: body.method,
              error: headerError,
            });
            return Response.json(
              {
                jsonrpc: "2.0",
                id: body.id,
                error: { code: HEADER_MISMATCH, message: headerError },
              },
              { status: 400 }
            );
          }
        }

        // ── subscriptions/listen (SSE over POST) ─
        if (body.method === "subscriptions/listen") {
          if (!stateless) {
            return Response.json(
              {
                jsonrpc: "2.0",
                id: body.id,
                error: {
                  code: -32_601,
                  message:
                    "subscriptions/listen requires MCP-Protocol-Version 2026-07-28",
                },
              },
              { status: 404 }
            );
          }

          const filter =
            ((body.params as { notifications?: Record<string, unknown> })
              ?.notifications as {
              toolsListChanged?: boolean;
              promptsListChanged?: boolean;
              resourcesListChanged?: boolean;
              resourceSubscriptions?: string[];
            }) ?? {};

          const subscriptionId = String(body.id);
          runtime?.disableIdleTimeout?.(req);

          for (const uri of filter.resourceSubscriptions ?? []) {
            subscribeRes(uri, subscriptionId);
          }

          debugLog("subscriptions_listen_open", {
            subscriptionId,
            filter,
          });

          const { stream } = hub.open(subscriptionId, null, {
            onOpen() {
              // Spec: first event acknowledges the subscription.
              hub.send(subscriptionId, {
                jsonrpc: "2.0",
                method: "notifications/subscriptions/acknowledged",
                params: {
                  _meta: {
                    "io.modelcontextprotocol/subscriptionId": body.id,
                  },
                },
              });
            },
            filter: {
              toolsListChanged: Boolean(filter.toolsListChanged),
              promptsListChanged: Boolean(filter.promptsListChanged),
              resourcesListChanged: Boolean(filter.resourcesListChanged),
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "MCP-Protocol-Version": protocolVersion,
              "Access-Control-Allow-Origin": origin ?? "*",
              "X-Accel-Buffering": "no",
            },
          });
        }

        // ── Session resolution (legacy only) ─────
        const sid = req.headers.get("mcp-session-id");
        let activeSession = "";

        if (stateless) {
          // Stateless core: ignore Mcp-Session-Id entirely.
          activeSession = "";
        } else if (body.method === "initialize") {
          if (sid && store.sessions.has(sid)) {
            store.sessions.touch(sid);
            activeSession = sid;
          } else {
            activeSession = store.sessions.create();
            debugLog("session_minted", { sessionId: activeSession });
          }
        } else if (sid && store.sessions.has(sid)) {
          store.sessions.touch(sid);
          activeSession = sid;
        } else if (sid) {
          debugLog("post_unknown_session", {
            sessionId: sid,
            method: body.method,
          });
          return Response.json({ error: "Session not found" }, { status: 404 });
        } else {
          debugLog("post_missing_session", { method: body.method });
          return Response.json(
            { error: "Missing MCP-Session-Id header" },
            { status: 400 }
          );
        }

        debugLog("rpc_request", {
          requestId: body.id,
          method: body.method,
          sessionId: activeSession || undefined,
          protocolVersion,
          stateless,
        });

        const progressToken = (body.params as any)?._meta?.progressToken as
          | string
          | number
          | undefined;

        const progressCallback =
          progressToken === undefined
            ? undefined
            : (p: { progress: number; total?: number; message?: string }) => {
                if (!activeSession) {
                  return;
                }
                hub.send(activeSession, {
                  jsonrpc: "2.0",
                  method: "notifications/progress",
                  params: { progressToken, ...p },
                });
              };

        const requestMeta: RequestMeta = {
          clientCapabilities: metaInfo.clientCapabilities,
          headers: Object.fromEntries(req.headers.entries()),
          inputResponses: (body.params as { inputResponses?: Record<string, unknown> })
            ?.inputResponses,
          method: req.method,
          progressCallback,
          protocolVersion,
          raw: req,
          requestState: (body.params as { requestState?: string })?.requestState,
          sessionId: activeSession || undefined,
          transport: "http",
          url: req.url,
          abortSignal: (req as any).signal,
        };

        const ctx = buildCtx(
          activeSession,
          protocolVersion,
          requestMeta,
          req
        );
        const response = await handleJsonRpc(body, ctx);
        const { afterResponse, httpAuth, ...wireResponse } = response;

        debugLog("rpc_response", {
          requestId: body.id,
          method: body.method,
          sessionId: activeSession || undefined,
          protocolVersion,
          hasError: "error" in wireResponse,
          httpAuth: Boolean(httpAuth),
        });

        scheduleAfterResponse(
          afterResponse,
          runtime,
          (error) => {
            debugLog("after_response_error", {
              requestId: body.id,
              method: body.method,
              sessionId: activeSession || undefined,
              error: String(error),
            });
          }
        );

        if (httpAuth) {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id,
              error: {
                code: -32_000,
                message: httpAuth.message,
              },
            }),
            {
              status: httpAuth.status,
              headers: {
                "Content-Type": "application/json",
                "WWW-Authenticate": httpAuth.wwwAuthenticate,
                "MCP-Protocol-Version": protocolVersion,
                "Access-Control-Allow-Origin": origin ?? "*",
                "Access-Control-Expose-Headers":
                  "WWW-Authenticate, MCP-Protocol-Version, Mcp-Session-Id",
              },
            }
          );
        }

        const responseHeaders: Record<string, string> = {
          "MCP-Protocol-Version": protocolVersion,
          "Access-Control-Allow-Origin": origin ?? "*",
        };
        if (!stateless && activeSession) {
          responseHeaders["Mcp-Session-Id"] = activeSession;
        }

        // Method not found → HTTP 404 for 2026-07-28 (spec).
        const httpStatus =
          stateless &&
          "error" in wireResponse &&
          (wireResponse as JsonRpcResponse).error?.code === -32_601
            ? 404
            : 200;

        return Response.json(wireResponse, {
          status: httpStatus,
          headers: responseHeaders,
        });
      }

      return new Response("Method Not Allowed", { status: 405 });
  };

  // ── Context factory ───────────────────────
  function buildCtx(
    sessionId: string,
    protocolVersion: SupportedProtocolVersion,
    requestMeta?: RequestMeta,
    req?: Request
  ): RpcContext {
    return {
      tools,
      resources,
      prompts,
      runTool,
      readResource,
      getPrompt,
      subscribeRes,
      unsubscribeRes,
      requestMeta: requestMeta ?? {
        headers: {},
        method: "POST",
        raw: req as Request,
        sessionId: sessionId || undefined,
        transport: "http",
        url: req?.url ?? "",
        protocolVersion,
      },
      serverInfo,
      caps,
      store,
      hub,
      sessionId,
      protocolVersion,
      listCache,
    };
  }

  return {
    fetch,
    push(sessionId, payload, options) {
      return hub.send(sessionId, payload, options);
    },
    broadcast(payload, options) {
      // Fan out once to every open stream (legacy sessions and
      // subscriptions/listen). Stream filters decide delivery.
      hub.broadcastFiltered(payload, options);
    },
    stop() {
      store.stop();
      hub.closeAll();
    },
  };
}
