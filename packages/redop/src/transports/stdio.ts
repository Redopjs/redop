// ─────────────────────────────────────────────
//  redop — stdio transport (MCP 2025-11-25)
//
//  Reads newline-delimited JSON-RPC from stdin,
//  writes responses + notifications to stdout.
//  All logging MUST go to stderr — stdout is
//  exclusively for valid MCP messages.
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

// ── Types ─────────────────────────────────────

type ToolRunner = (
  name: string,
  args: Record<string, unknown>,
  meta: RequestMeta
) => Promise<unknown>;

type ResourceReader = (
  uri: string,
  req: RequestMeta
) => Promise<ResourceContents>;

type PromptGetter = (
  name: string,
  args: Record<string, string> | undefined,
  req: RequestMeta
) => Promise<PromptHandlerResult>;

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
const SUPPORTED_VERSIONS = ["2025-11-25", "2024-11-05"] as const;
type SupportedVersion = (typeof SUPPORTED_VERSIONS)[number];

function negotiateVersion(clientVersion: string): SupportedVersion {
  // Echo back the client's version if we support it; otherwise our latest.
  const match = SUPPORTED_VERSIONS.find((v) => v === clientVersion);
  return match ?? SUPPORTED_VERSIONS[0];
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
      // Advertise task support on tools/call
      capabilities.tasks = {
        list: {},
        cancel: {},
        requests: { tools: { call: {} } },
      };

      respond(id, {
        protocolVersion: negotiatedVersion,
        capabilities,
        serverInfo: {
          name: serverInfo.name,
          version: serverInfo.version,
          title: serverInfo.title || undefined,
          description: serverInfo.description || undefined,
          icons: serverInfo.icons?.length ? serverInfo.icons : undefined,
          websiteUrl: serverInfo.websiteUrl || undefined,
        },
        instructions: serverInfo.instructions || undefined,
      });
      return;
    }

    // ── ping ───────────────────────────────────────────────────────────────
    if (method === "ping") {
      respond(id, {});
      return;
    }

    // ── tools/list ─────────────────────────────────────────────────────────
    if (method === "tools/list") {
      if (!caps.tools) {
        respondError(id, -32_601, "Tools capability not enabled");
        return;
      }
      respond(id, { tools: buildToolList(tools) });
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

      const requestMeta: RequestMeta = {
        abortSignal: signal,
        headers: {},
        progressCallback,
        transport: "stdio",
      };

      checkAbort();

      try {
        const raw = await runTool(toolName!, p.arguments ?? {}, requestMeta);
        checkAbort();

        const result: Record<string, unknown> = {
          content: [{ type: "text", text: JSON.stringify(raw) }],
        };
        // Emit structuredContent when the tool declares an outputSchema
        if (tool.outputSchema && raw !== null && typeof raw === "object") {
          result.structuredContent = raw;
        }
        respond(id, result);
      } catch (err) {
        if (signal.aborted) {
          return; // Cancelled — no response per spec
        }
        respond(id, {
          content: [
            {
              type: "text",
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        });
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
      respond(id, {
        resources: staticRes.map((r) => ({
          uri: r.uri,
          name: r.name,
          ...(r.description ? { description: r.description } : {}),
          ...(r.mimeType ? { mimeType: r.mimeType } : {}),
          ...(r.icons?.length ? { icons: r.icons } : {}),
        })),
      });
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
        const contents = await readResource(uri, {
          abortSignal: signal,
          headers: {},
          transport: "stdio",
        });
        checkAbort();

        const wireContent =
          contents.type === "text"
            ? { uri, mimeType: contents.mimeType, text: contents.text }
            : { uri, mimeType: contents.mimeType, blob: contents.blob };

        respond(id, { contents: [wireContent] });
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
      respond(id, {
        prompts: [...prompts.values()].map((p) => ({
          name: p.name,
          ...(p.description ? { description: p.description } : {}),
          ...(p.arguments?.length ? { arguments: p.arguments } : {}),
        })),
      });
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
        const raw = await getPrompt(name, args, {
          abortSignal: signal,
          headers: {},
          transport: "stdio",
        });
        checkAbort();

        const result = Array.isArray(raw) ? { messages: raw } : raw;
        respond(id, result);
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
