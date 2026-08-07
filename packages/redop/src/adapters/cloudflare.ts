import type { HandlerOptions } from "../types";
import type { Redop } from "../redop";
import type { FetchRuntime, HttpFetch } from "../transports/runtime";

/**
 * Minimal Cloudflare Workers execution context.
 * Compatible with the real `ExecutionContext.waitUntil`.
 */
export type CloudflareExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export type CloudflareFetchHandler = (
  request: Request,
  env: unknown,
  ctx: CloudflareExecutionContext
) => Promise<Response> | Response;

/**
 * Wrap a Redop app as a Cloudflare Workers `fetch` handler.
 *
 * `afterResponse` hooks are scheduled with `ctx.waitUntil(...)`.
 *
 * Prefer MCP `2026-07-28` (stateless) on Workers. Long-lived SSE / in-memory
 * sessions are not a good fit for the Workers request model.
 *
 * The underlying HTTP app is created on the first request so module evaluation
 * stays free of Workers-disallowed global timers.
 *
 * @example
 * ```ts
 * import { Redop, cloudflare } from "@redopjs/redop/cloudflare"
 *
 * const app = new Redop({ serverInfo: { name: "cf-mcp", version: "0.1.0" } })
 *   .tool("ping", { handler: async () => ({ ok: true }) })
 *
 * export default cloudflare(app)
 * ```
 */
export function cloudflare(
  app: Redop,
  opts: HandlerOptions = {}
): { fetch: CloudflareFetchHandler } {
  let handler: HttpFetch | null = null;

  return {
    fetch(request, _env, ctx) {
      if (!handler) {
        handler = app.handler(opts);
      }
      const runtime: FetchRuntime = {
        waitUntil(promise) {
          ctx.waitUntil(promise);
        },
      };
      return handler(request, runtime);
    },
  };
}

/**
 * @deprecated Prefer {@link cloudflare}. Kept for compatibility.
 */
export const toCloudflare = cloudflare;

/**
 * Lower-level helper when you already have a fetch handler.
 */
export function withCloudflareWaitUntil(
  handler: HttpFetch,
  ctx: CloudflareExecutionContext
): (request: Request) => Promise<Response> {
  return (request) =>
    handler(request, {
      waitUntil(promise) {
        ctx.waitUntil(promise);
      },
    });
}
