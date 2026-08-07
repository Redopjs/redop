/**
 * Cloudflare Workers adapter for Redop.
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

export { Redop, definePlugin, middleware } from "./redop";
export {
  cloudflare,
  toCloudflare,
  withCloudflareWaitUntil,
  type CloudflareExecutionContext,
  type CloudflareFetchHandler,
} from "./adapters/cloudflare";
export type { HandlerOptions } from "./types";
export type { FetchRuntime, HttpFetch } from "./transports/runtime";
