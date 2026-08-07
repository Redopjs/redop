// ─────────────────────────────────────────────
//  redop — Bun HTTP transport (Bun.serve wrapper)
// ─────────────────────────────────────────────

import { serve } from "bun";
import type {
  CapabilityOptions,
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
  createHttpApp,
  type HttpApp,
  type TransportHandle,
} from "./http-app";

export type {
  FetchRuntime,
  HttpApp,
  HttpAppOptions,
  HttpFetch,
  TransportHandle,
} from "./http-app";
export { createHttpApp } from "./http-app";

/**
 * Start the built-in Bun HTTP transport.
 *
 * Prefer `app.listen(...)` from application code. Runtime adapters should use
 * `createHttpApp` / `app.handler()` instead of this helper.
 */
export function startHttpTransport(
  tools: Map<string, ResolvedTool>,
  resources: Map<string, ResolvedResource>,
  prompts: Map<string, ResolvedPrompt>,
  runTool: (
    name: string,
    args: Record<string, unknown>,
    meta: RequestMeta
  ) => Promise<
    | { afterResponse: () => Promise<void>; ok: true; result: unknown }
    | { afterResponse: () => Promise<void>; error: unknown; ok: false }
  >,
  readResource: (
    uri: string,
    req: RequestMeta
  ) => Promise<
    | {
        afterResponse: () => Promise<void>;
        ok: true;
        result: ResourceContents;
      }
    | { afterResponse: () => Promise<void>; error: unknown; ok: false }
  >,
  getPrompt: (
    name: string,
    args: Record<string, string> | undefined,
    req: RequestMeta
  ) => Promise<
    | {
        afterResponse: () => Promise<void>;
        ok: true;
        result: PromptHandlerResult;
      }
    | { afterResponse: () => Promise<void>; error: unknown; ok: false }
  >,
  subscribeRes: (uri: string, sid: string) => void,
  unsubscribeRes: (uri: string, sid: string) => void,
  opts: ListenOptions,
  serverInfo: Required<ServerInfoOptions>,
  caps: Required<CapabilityOptions>
): TransportHandle {
  const port = Number(opts.port ?? 3000);
  const hostname = opts.hostname ?? "127.0.0.1";
  const mcpPath = opts.path ?? "/mcp";

  const app: HttpApp = createHttpApp(
    tools,
    resources,
    prompts,
    runTool,
    readResource,
    getPrompt,
    subscribeRes,
    unsubscribeRes,
    opts,
    serverInfo,
    caps
  );

  const server = serve({
    port,
    hostname,
    idleTimeout: 255,
    tls: opts.tls,
    async fetch(req, bunServer) {
      return app.fetch(req, {
        disableIdleTimeout(request) {
          bunServer.timeout(request, 0);
        },
      });
    },
  });

  const listenUrl = `http${opts.tls ? "s" : ""}://${hostname}:${port}${mcpPath}`;
  opts.onListen?.({ hostname, port, url: listenUrl });

  return {
    push(sessionId, payload, options) {
      return app.push(sessionId, payload, options);
    },
    broadcast(payload, options) {
      app.broadcast(payload, options);
    },
    stop() {
      server.stop();
      app.stop();
    },
  };
}
