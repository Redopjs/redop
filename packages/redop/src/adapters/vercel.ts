import type { HandlerOptions } from "../types";
import type { Redop } from "../redop";
import type { FetchRuntime, HttpFetch } from "../transports/runtime";

/**
 * Vercel `waitUntil` compatible function.
 * Works with `@vercel/functions` `waitUntil` and similar helpers.
 */
export type VercelWaitUntil = (promise: Promise<unknown>) => void;

export type VercelAdapterOptions = HandlerOptions & {
  /**
   * Optional waitUntil binder. When omitted, Redop falls back to microtasks
   * (fine on long-lived Node, unreliable on short-lived serverless).
   *
   * Pass `waitUntil` from `@vercel/functions` in serverless deployments:
   *
   * ```ts
   * import { waitUntil } from "@vercel/functions"
   * export default toVercel(app, { waitUntil })
   * ```
   */
  waitUntil?: VercelWaitUntil;
};

/**
 * Wrap a Redop app as a Web-standard fetch handler for Vercel / Vercel Edge.
 *
 * @example
 * ```ts
 * import { Redop } from "@redopjs/redop"
 * import { toVercel } from "@redopjs/redop/vercel"
 * import { waitUntil } from "@vercel/functions"
 *
 * const app = new Redop({ serverInfo: { name: "demo", version: "0.1.0" } })
 *   .tool("ping", { handler: async () => ({ ok: true }) })
 *
 * export default toVercel(app, { waitUntil })
 * ```
 */
export function toVercel(app: Redop, opts: VercelAdapterOptions = {}): HttpFetch {
  const handler = app.handler(opts);
  const waitUntil = opts.waitUntil;

  return (request, runtime) => {
    const merged: FetchRuntime = {
      ...runtime,
      waitUntil: runtime?.waitUntil ?? waitUntil,
    };
    return handler(request, merged);
  };
}

/**
 * Edge-friendly alias — same fetch handler as `toVercel`.
 */
export function toVercelEdge(
  app: Redop,
  opts: VercelAdapterOptions = {}
): HttpFetch {
  return toVercel(app, opts);
}
