/**
 * Vercel / Vercel Edge adapter for Redop.
 *
 * @example
 * ```ts
 * import { Redop } from "@redopjs/redop"
 * import { vercel } from "@redopjs/redop/vercel"
 * import { waitUntil } from "@vercel/functions"
 *
 * const app = new Redop({ serverInfo: { name: "vercel-mcp", version: "0.1.0" } })
 *   .tool("ping", { handler: async () => ({ ok: true }) })
 *
 * export default vercel(app, { waitUntil })
 * ```
 */

export { Redop, definePlugin, middleware } from "./redop";
export {
  vercel,
  vercelEdge,
  toVercel,
  toVercelEdge,
  type VercelAdapterOptions,
  type VercelWaitUntil,
} from "./adapters/vercel";
export type { HandlerOptions } from "./types";
export type { FetchRuntime, HttpFetch } from "./transports/runtime";
