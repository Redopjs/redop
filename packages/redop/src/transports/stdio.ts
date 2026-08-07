// ─────────────────────────────────────────────
//  redop — stdio transport
//
//  Reads newline-delimited JSON-RPC from stdin,
//  writes responses + notifications to stdout.
//  All logging MUST go to stderr — stdout is
//  exclusively for valid MCP messages.
//
//  Supports MCP 2026-07-28 (stateless) and legacy
//  initialize-based versions.
// ─────────────────────────────────────────────

import type {
  CapabilityOptions,
  JsonRpcRequest,
  PromptHandlerResult,
  RequestMeta,
  ResolvedPrompt,
  ResolvedResource,
  ResolvedTool,
  ResourceContents,
  ServerInfoOptions,
} from "../types";
import {
  buildServerCapabilities,
  DEFAULT_LIST_CACHE,
  inputRequiredResult,
  isInputRequiredError,
  isStatelessProtocol,
  negotiateProtocolVersion,
  PROTOCOL_LATEST,
  readProtocolMeta,
  SUPPORTED_PROTOCOL_VERSIONS,
  type SupportedProtocolVersion,
  withCacheHints,
  withResultType,
} from "./protocol";

// ── Types ─────────────────────────────────────

type ToolRunner = (
  name: string,
  args: Record<string, unknown>,
  meta: RequestMeta
) => Promise<DeferredExecution<unknown>>;

type ResourceReader = (
  uri: string,
  req: RequestMeta
) => Promise<DeferredExecution<ResourceContents>>;

type PromptGetter = (
  name: string,
  args: Record<string, string> | undefined,
  req: RequestMeta
) => Promise<DeferredExecution<PromptHandlerResult>>;

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

// ── Helpers ───────────────────────────────────

/**
 * Write a single JSON-RPC message to stdout as a newline-terminated line.
 *
 * Per spec: messages are delimited by newlines and MUST NOT contain
 * embedded newlines. JSON.stringify of well-formed objects never produces
 * embedded \n, but we defensively strip any that might come from unusual
 * string values in the payload.
 */
function send(msg: unknown): void {
  const line = JSON.stringify(msg).replace(/\n/g, "\\n") + "\n";
  process.stdout.write(line);
}

/** Write a JSON-RPC response with a result. */
function respond(id: string | number | null, result: unknown): void {
  send({ id, jsonrpc: "2.0", result });
}

/** Write a JSON-RPC error response. */
function respondError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): void {
  send({
    error: { code, message, ...(data === undefined ? {} : { data }) },
    id,
    jsonrpc: "2.0",
  });
}

/** Write a server-initiated notification (no id). */
function notify(method: string, params: unknown): void {
  send({ jsonrpc: "2.0", method, params });
}

/** Log to stderr — the only safe place for non-MCP output. */
function log(msg: string): void {
  process.stderr.write(`[redop:stdio] ${msg}\n`);
}

function scheduleAfterResponse(
  afterResponse: () => Promise<void> | void,
  label: string
): void {
  queueMicrotask(() => {
    void Promise.resolve()
      .then(() => afterResponse())
      .catch((error) => {
        log(
          `afterResponse error (${label}): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
  });
}

/**
 * Build the tools list for tools/list responses.
 * Mirrors the HTTP transport's shape exactly.
 */
function buildToolList(tools: Map<string, ResolvedTool>) {
  return [...tools.values()].map((t) => {
    const entry: Record<string, unknown> = {
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema,
      execution: { taskSupport: t.taskSupport ?? "optional" },
    };
    if (t.title) {
      entry.title = t.title;
    }
    if (t.icons?.length) {
      entry.icons = t.icons;
    }
    if (t.outputSchema) {
      entry.outputSchema = t.outputSchema;
    }
    if (t.annotations) {
      entry.annotations = t.annotations;
    }
    return entry;
  });
}

// Supported protocol versions in preference order.
const SUPPORTED_VERSIONS = [...SUPPORTED_PROTOCOL_VERSIONS] as const;
type SupportedVersion = SupportedProtocolVersion;

function negotiateVersion(clientVersion: string): SupportedVersion {
  return negotiateProtocolVersion(clientVersion, PROTOCOL_LATEST);
}

// ── Transport ─────────────────────────────────

/**
 * Start the stdio MCP transport.
 *
 * Returns a broadcast function that the Redop class can use to push
 * server-initiated notifications (e.g. resources/updated) to the client.
 * Since stdio has exactly one client, the sessionId argument is ignored.
 */
export function startStdioTransport(
  tools: Map<string, ResolvedTool>,
  resources: Map<string, ResolvedResource>,
  prompts: Map<string, ResolvedPrompt>,
  runTool: ToolRunner,
  readResource: ResourceReader,
  getPrompt: PromptGetter,
  serverInfo: Required<ServerInfoOptions>,
  caps: Required<CapabilityOptions>
): { broadcast: (_sessionId: string, data: unknown) => void } {
  // ── State ────────────────────────────────────────────────────────────────

  /**
   * In-flight request tracking.
   * Maps request id → AbortController so notifications/cancelled can abort them.
   */
  const inFlight = new Map<string | number, AbortController>();

  /**
   * Subscribed resource URIs.
   * For stdio there is only one client, so we track them in a simple Set.
   */
  const subscribedUris = new Set<string>();

  /** The negotiated protocol version — set during initialize. */
  let negotiatedVersion: SupportedVersion = SUPPORTED_VERSIONS[0];

  /** Whether initialization has completed (initialized notification received). */
  let initialized = false;

  // ── Message dispatcher ────────────────────────────────────────────────────

  /**
   * Dispatch a single parsed JSON-RPC message.
   *
   * Requests (have an id) are dispatched concurrently — we do NOT await them
   * in the message loop. This prevents a slow tool from blocking ping, list,
   * or cancellation messages.
   *
   * Notifications (no id, per JSON-RPC) receive no response.
   */
  function dispatch(msg: JsonRpcRequest): void {
    const { id, method, params } = msg;

    // ── Notifications (no id) — fire and forget ─────────────────────────
    if (id === undefined || id === null) {
      handleNotification(method, params ?? {});
      return;
    }

    // ── Requests — run concurrently, don't await ─────────────────────────
    const ac = new AbortController();
    inFlight.set(id, ac);

    handleRequest(id, method, params ?? {}, ac.signal)
      .catch((err) => {
        // Unexpected handler crash — report as internal error.
        // Check if this was an abort before reporting.
        if (!ac.signal.aborted) {
          respondError(
            id,
            -32_603,
            `Internal error: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      })
      .finally(() => {
        inFlight.delete(id);
      });
  }

  // ── Notification handler ──────────────────────────────────────────────────

  function handleNotification(
    method: string,
    params: Record<string, unknown>
  ): void {
    switch (method) {
      // Per spec: no response is sent for this notification.
      // The server is now allowed to send requests (other than pings/logging).
      case "notifications/initialized":
        initialized = true;
        return;

      // Cancel an in-flight request.
      // Per spec: SHOULD stop processing, free resources, NOT send a response.
      case "notifications/cancelled": {
        const requestId = params.requestId as string | number | undefined;
        if (requestId === undefined) {
          return;
        }
        const ac = inFlight.get(requestId);
        if (ac) {
          ac.abort(
            new Error(
              typeof params.reason === "string"
                ? params.reason
                : "Cancelled by client"
            )
          );
          // Do NOT send a response — per spec.
        }
        return;
      }

      default:
        // Unknown notifications are silently ignored per JSON-RPC spec.
        return;
    }
  }

  // ── Request handler ───────────────────────────────────────────────────────

  async function handleRequest(
    id: string | number,
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<void> {
    // Helper: check if the signal has fired and bail early.
    const checkAbort = () => {
      if (signal.aborted) {
        throw signal.reason ?? new Error("Cancelled");
      }
    };

    // ── initialize ─────────────────────────────────────────────────────────
    if (method === "initialize") {
      const clientVersion = (params as any)?.protocolVersion as
        | string
        | undefined;
      negotiatedVersion = clientVersion
        ? negotiateVersion(clientVersion)
        : SUPPORTED_VERSIONS[0];

      respond(
        id,
        withResultType(
          {
            protocolVersion: negotiatedVersion,
            capabilities: buildServerCapabilities(caps, negotiatedVersion),
            serverInfo: {
              name: serverInfo.name,
              version: serverInfo.version,
              title: serverInfo.title || undefined,
              description: serverInfo.description || undefined,
              icons: serverInfo.icons?.length ? serverInfo.icons : undefined,
              websiteUrl: serverInfo.websiteUrl || undefined,
            },
            instructions: serverInfo.instructions || undefined,
          },
          negotiatedVersion
        )
      );
      return;
    }

    // ── server/discover ────────────────────────────────────────────────────
    if (method === "server/discover") {
      const meta = readProtocolMeta(params);
      if (meta.protocolVersion) {
        negotiatedVersion = negotiateVersion(meta.protocolVersion);
      } else {
        negotiatedVersion = PROTOCOL_LATEST;
      }
      initialized = true;
      respond(
        id,
        withResultType(
          withCacheHints(
            {
              supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
              capabilities: buildServerCapabilities(caps, negotiatedVersion),
              instructions: serverInfo.instructions,
              serverInfo: {
                name: serverInfo.name,
                version: serverInfo.version,
                ...(serverInfo.title ? { title: serverInfo.title } : {}),
                ...(serverInfo.description
                  ? { description: serverInfo.description }
                  : {}),
                ...(serverInfo.websiteUrl
                  ? { websiteUrl: serverInfo.websiteUrl }
                  : {}),
                ...(serverInfo.icons?.length
                  ? { icons: serverInfo.icons }
                  : {}),
              },
            },
            DEFAULT_LIST_CACHE,
            PROTOCOL_LATEST
          ),
          PROTOCOL_LATEST
        )
      );
      return;
    }

    // Per-request version from _meta (2026-07-28) — no initialize required.
    {
      const meta = readProtocolMeta(params);
      if (meta.protocolVersion) {
        negotiatedVersion = negotiateVersion(meta.protocolVersion);
        if (isStatelessProtocol(negotiatedVersion)) {
          initialized = true;
        }
      }
    }

    // ── ping ───────────────────────────────────────────────────────────────
    if (method === "ping") {
      respond(id, withResultType({}, negotiatedVersion));
      return;
    }

    // ── tools/list ─────────────────────────────────────────────────────────
    if (method === "tools/list") {
      if (!caps.tools) {
        respondError(id, -32_601, "Tools capability not enabled");
        return;
      }
      respond(
        id,
        withResultType(
          withCacheHints(
            { tools: buildToolList(tools) },
            DEFAULT_LIST_CACHE,
            negotiatedVersion
          ),
          negotiatedVersion
        )
      );
      return;
    }

    // ── tools/call ─────────────────────────────────────────────────────────
    if (method === "tools/call") {
      if (!caps.tools) {
        respondError(id, -32_601, "Tools capability not enabled");
        return;
      }

      const p = params as {
        name?: string;
        arguments?: Record<string, unknown>;
        inputResponses?: Record<string, unknown>;
        requestState?: string;
        _meta?: { progressToken?: string | number };
      };
      const toolName = p.name;
      const tool = toolName ? tools.get(toolName) : undefined;

      if (!tool) {
        respondError(id, -32_602, `Unknown tool: ${toolName ?? "(none)"}`);
        return;
      }

      // Wire progress notifications — write to stdout as per MCP spec.
      const progressToken = p._meta?.progressToken;
      const progressCallback =
        progressToken === undefined
          ? undefined
          : (pg: { progress: number; total?: number; message?: string }) => {
              notify("notifications/progress", {
                progressToken,
                progress: pg.progress,
                ...(pg.total === undefined ? {} : { total: pg.total }),
                ...(pg.message === undefined ? {} : { message: pg.message }),
              });
            };

      const metaInfo = readProtocolMeta(params);
      const requestMeta: RequestMeta = {
        abortSignal: signal,
        clientCapabilities: metaInfo.clientCapabilities,
        headers: {},
        inputResponses: p.inputResponses,
        progressCallback,
        protocolVersion: negotiatedVersion,
        requestState: p.requestState,
        transport: "stdio",
      };

      checkAbort();

      try {
        const execution = await runTool(
          toolName!,
          p.arguments ?? {},
          requestMeta
        );
        checkAbort();
        if (!execution.ok) {
          if (
            isInputRequiredError(execution.error) &&
            isStatelessProtocol(negotiatedVersion)
          ) {
            respond(id, inputRequiredResult(execution.error));
            scheduleAfterResponse(execution.afterResponse, `tool:${toolName}`);
            return;
          }
          respond(
            id,
            withResultType(
              {
                content: [
                  {
                    type: "text",
                    text:
                      execution.error instanceof Error
                        ? execution.error.message
                        : String(execution.error),
                  },
                ],
                isError: true,
              },
              negotiatedVersion
            )
          );
          scheduleAfterResponse(execution.afterResponse, `tool:${toolName}`);
          return;
        }
        const raw = execution.result;

        const result: Record<string, unknown> = {
          content: [{ type: "text", text: JSON.stringify(raw) }],
        };
        // Emit structuredContent when the tool declares an outputSchema
        if (tool.outputSchema && raw !== null && typeof raw === "object") {
          result.structuredContent = raw;
        }
        respond(id, withResultType(result, negotiatedVersion));
        scheduleAfterResponse(execution.afterResponse, `tool:${toolName}`);
      } catch (err) {
        if (signal.aborted) {
          return; // Cancelled — no response per spec
        }
        if (isInputRequiredError(err) && isStatelessProtocol(negotiatedVersion)) {
          respond(id, inputRequiredResult(err));
          return;
        }
        respond(
          id,
          withResultType(
            {
              content: [
                {
                  type: "text",
                  text: err instanceof Error ? err.message : String(err),
                },
              ],
              isError: true,
            },
            negotiatedVersion
          )
        );
      }
      return;
    }

    // ── resources/list ─────────────────────────────────────────────────────
    if (method === "resources/list") {
      if (!caps.resources) {
        respondError(id, -32_601, "Resources capability not enabled");
        return;
      }
      const staticRes = [...resources.values()].filter((r) => !r.isTemplate);
      respond(
        id,
        withResultType(
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
            DEFAULT_LIST_CACHE,
            negotiatedVersion
          ),
          negotiatedVersion
        )
      );
      return;
    }

    // ── resources/templates/list ────────────────────────────────────────────
    if (method === "resources/templates/list") {
      if (!caps.resources) {
        respondError(id, -32_601, "Resources capability not enabled");
        return;
      }
      const templateRes = [...resources.values()].filter((r) => r.isTemplate);
      respond(id, {
        resourceTemplates: templateRes.map((r) => ({
          uriTemplate: r.uri,
          name: r.name,
          ...(r.description ? { description: r.description } : {}),
          ...(r.mimeType ? { mimeType: r.mimeType } : {}),
        })),
      });
      return;
    }

    // ── resources/read ──────────────────────────────────────────────────────
    if (method === "resources/read") {
      if (!caps.resources) {
        respondError(id, -32_601, "Resources capability not enabled");
        return;
      }
      const uri = (params as any)?.uri as string | undefined;
      if (!uri) {
        respondError(id, -32_602, "Missing uri param");
        return;
      }

      checkAbort();

      try {
        const execution = await readResource(uri, {
          abortSignal: signal,
          headers: {},
          transport: "stdio",
        });
        checkAbort();
        if (!execution.ok) {
          respondError(
            id,
            -32_602,
            execution.error instanceof Error
              ? execution.error.message
              : String(execution.error)
          );
          scheduleAfterResponse(execution.afterResponse, `resource:${uri}`);
          return;
        }
        const contents = execution.result;

        const wireContent =
          contents.type === "text"
            ? { uri, mimeType: contents.mimeType, text: contents.text }
            : { uri, mimeType: contents.mimeType, blob: contents.blob };

        respond(id, { contents: [wireContent] });
        scheduleAfterResponse(execution.afterResponse, `resource:${uri}`);
      } catch (err) {
        if (signal.aborted) {
          return;
        }
        respondError(
          id,
          -32_602,
          err instanceof Error ? err.message : String(err)
        );
      }
      return;
    }

    // ── resources/subscribe ─────────────────────────────────────────────────
    if (method === "resources/subscribe") {
      if (!caps.resources) {
        respondError(id, -32_601, "Resources capability not enabled");
        return;
      }
      const uri = (params as any)?.uri as string | undefined;
      if (!uri) {
        respondError(id, -32_602, "Missing uri");
        return;
      }
      subscribedUris.add(uri);
      respond(id, {});
      return;
    }

    // ── resources/unsubscribe ───────────────────────────────────────────────
    if (method === "resources/unsubscribe") {
      if (!caps.resources) {
        respondError(id, -32_601, "Resources capability not enabled");
        return;
      }
      const uri = (params as any)?.uri as string | undefined;
      if (!uri) {
        respondError(id, -32_602, "Missing uri");
        return;
      }
      subscribedUris.delete(uri);
      respond(id, {});
      return;
    }

    // ── prompts/list ────────────────────────────────────────────────────────
    if (method === "prompts/list") {
      if (!caps.prompts) {
        respondError(id, -32_601, "Prompts capability not enabled");
        return;
      }
      respond(
        id,
        withResultType(
          withCacheHints(
            {
              prompts: [...prompts.values()].map((p) => ({
                name: p.name,
                ...(p.description ? { description: p.description } : {}),
                ...(p.arguments?.length ? { arguments: p.arguments } : {}),
              })),
            },
            DEFAULT_LIST_CACHE,
            negotiatedVersion
          ),
          negotiatedVersion
        )
      );
      return;
    }

    // ── prompts/get ─────────────────────────────────────────────────────────
    if (method === "prompts/get") {
      if (!caps.prompts) {
        respondError(id, -32_601, "Prompts capability not enabled");
        return;
      }
      const name = (params as any)?.name as string | undefined;
      const args = (params as any)?.arguments as
        | Record<string, string>
        | undefined;
      if (!name) {
        respondError(id, -32_602, "Missing name");
        return;
      }

      checkAbort();

      try {
        const execution = await getPrompt(name, args, {
          abortSignal: signal,
          headers: {},
          transport: "stdio",
        });
        checkAbort();
        if (!execution.ok) {
          respondError(
            id,
            -32_602,
            execution.error instanceof Error
              ? execution.error.message
              : String(execution.error)
          );
          scheduleAfterResponse(execution.afterResponse, `prompt:${name}`);
          return;
        }
        const raw = execution.result;

        const result = Array.isArray(raw) ? { messages: raw } : raw;
        respond(id, result);
        scheduleAfterResponse(execution.afterResponse, `prompt:${name}`);
      } catch (err) {
        if (signal.aborted) {
          return;
        }
        respondError(
          id,
          -32_602,
          err instanceof Error ? err.message : String(err)
        );
      }
      return;
    }

    // ── logging/setLevel ────────────────────────────────────────────────────
    // Servers may receive this from clients. We acknowledge but don't filter
    // stderr output — log routing is handled by the logger plugin if installed.
    if (method === "logging/setLevel") {
      respond(id, {});
      return;
    }

    // ── Method not found ────────────────────────────────────────────────────
    respondError(id, -32_601, `Method not found: ${method}`);
  }

  // ── stdin reader ──────────────────────────────────────────────────────────

  process.stdin.setEncoding("utf8");

  let buffer = "";

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;

    // Split on newlines — each complete line is one JSON-RPC message.
    const lines = buffer.split("\n");
    // Keep any incomplete trailing line in the buffer.
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let msg: JsonRpcRequest;
      try {
        msg = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        // Per spec: parse errors get a response with id null.
        respondError(null, -32_700, "Parse error");
        continue;
      }

      dispatch(msg);
    }
  });

  // ── Shutdown ──────────────────────────────────────────────────────────────

  // Per spec §Lifecycle/Shutdown/stdio:
  //   When stdin closes (client closed its end), the server should exit.
  process.stdin.on("end", () => {
    log("stdin closed — shutting down");
    process.exit(0);
  });

  process.stdin.on("error", (err) => {
    log(`stdin error: ${err.message}`);
    process.exit(1);
  });

  // Handle graceful shutdown signals.
  // SIGTERM: client asked us to stop (e.g. timeout). Exit cleanly.
  // SIGINT:  Ctrl-C in a terminal. Exit cleanly.
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      log(`received ${sig} — shutting down`);
      // Abort all in-flight requests so they can clean up.
      for (const ac of inFlight.values()) {
        ac.abort(new Error(`Server shutting down (${sig})`));
      }
      process.exit(0);
    });
  }

  process.stdin.resume();

  // ── Broadcast (server-initiated notifications) ────────────────────────────

  /**
   * Push a server-initiated notification to the client.
   *
   * Used by Redop.notifyResourceChanged() to deliver
   * notifications/resources/updated when subscribed resources change.
   *
   * For stdio there is only one client and no session IDs,
   * so the sessionId argument is ignored.
   *
   * Only sends if the URI is currently subscribed.
   */
  function broadcast(_sessionId: string, data: unknown): void {
    // For resource update notifications: check subscription before sending.
    const d = data as any;
    if (
      d?.method === "notifications/resources/updated" &&
      typeof d?.params?.uri === "string" &&
      !subscribedUris.has(d.params.uri)
    ) {
      return;
    }
    send(data);
  }

  return { broadcast };
}
