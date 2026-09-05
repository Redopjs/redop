// ─────────────────────────────────────────────
//  redop — Bun HTTP transport (Bun.serve wrapper)
// ─────────────────────────────────────────────

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

type BunServe = typeof Bun.serve;

function getBunServe(): BunServe {
  const bun = (globalThis as { Bun?: { serve: BunServe } }).Bun;
  if (!bun?.serve) {
    throw new Error(
      "[redop] HTTP `.listen()` requires the Bun runtime. For Cloudflare, Vercel, or Node, use `app.handler()` or `@redopjs/redop/cloudflare` / `@redopjs/redop/vercel` / `@redopjs/redop/node`."
    );
  }
  return bun.serve.bind(bun) as BunServe;
}

/**
 * Start the built-in Bun HTTP transport.
 *
 * Prefer `app.listen(...)` from application code. Runtime adapters should use
 * `createHttpApp` / `app.handler()` instead of this helper.
 *
 * Bun is resolved from `globalThis` at call time so Workers/edge bundles that
 * never call `.listen()` do not evaluate `Bun.serve` at module load.
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
  const serve = getBunServe();
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

  const useUnix = Boolean(opts.unix);
  const serveOptions = {
    idleTimeout: opts.idleTimeout ?? 255,
    development: opts.development ?? false,
    reusePort: opts.reusePort ?? false,
    tls: opts.tls,
    http1: opts.http1 ?? true,
    http2: opts.http2 ?? true,
    ...(opts.maxBodySize !== undefined
      ? { maxRequestBodySize: opts.maxBodySize }
      : {}),
    ...(Object.keys(app.staticRoutes).length > 0
      ? { routes: app.staticRoutes }
      : {}),
    error(error: unknown) {
      console.error("[redop:http] unhandled", error);
      return new Response("Internal Server Error", { status: 500 });
    },
    async fetch(req: Request, bunServer: { timeout(request: Request, seconds: number): void }) {
      return app.fetch(req, {
        disableIdleTimeout(request) {
          bunServer.timeout(request, 0);
        },
      });
    },
    ...(useUnix
      ? { unix: opts.unix as string }
      : {
          port,
          hostname,
          http3: opts.http3 ?? Boolean(opts.tls),
        }),
  };

  const server = serve(serveOptions as Parameters<BunServe>[0]);

  const boundPort = server.port ?? port;
  const listenUrl = useUnix
    ? `unix:${opts.unix}${mcpPath}`
    : `http${opts.tls ? "s" : ""}://${hostname}:${boundPort}${mcpPath}`;
  opts.onListen?.({ hostname: useUnix ? "unix" : hostname, port: boundPort, url: listenUrl });

  return {
    push(sessionId, payload, options) {
      return app.push(sessionId, payload, options);
    },
    broadcast(payload, options) {
      app.broadcast(payload, options);
    },
    stop() {
      const halted = Promise.resolve(server.stop()).then(() => {
        app.stop();
      });
      return halted;
    },
  };
}
