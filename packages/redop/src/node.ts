/**
 * Node.js adapter for Redop.
 *
 * @example
 * ```ts
 * import { Redop } from "@redopjs/redop"
 * import { listenNode } from "@redopjs/redop/node"
 *
 * const app = new Redop({ serverInfo: { name: "node-mcp", version: "0.1.0" } })
 *   .tool("ping", { handler: async () => ({ ok: true }) })
 *
 * listenNode(app, { port: 3000, hostname: "0.0.0.0" })
 * ```
 */

export { Redop, definePlugin, middleware } from "./redop";
export {
  incomingMessageToRequest,
  listenNode,
  nodeFetch,
  nodeListener,
  toNodeFetch,
  toNodeHandler,
  toNodeListener,
  writeNodeResponse,
  type NodeListenOptions,
} from "./adapters/node";
export type { HandlerOptions } from "./types";
export type { FetchRuntime, HttpFetch } from "./transports/runtime";
