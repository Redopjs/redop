import { describe, expect, test } from "bun:test";

import { Redop } from "../src/index";
import { startHttpTransport } from "../src/transports/http";
import { PROTOCOL_LATEST } from "../src/transports/protocol";

describe("listen optimizations", () => {
  test("Bun listen serves health via native routes and MCP via fetch", async () => {
    const app = new Redop({
      serverInfo: { name: "opt-listen", version: "0.1.0" },
    }).tool("ping", { handler: async () => ({ ok: true }) });

    let url = "";
    const transport = startHttpTransport(
      (app as any)._tools,
      (app as any)._resources,
      (app as any)._prompts,
      (name, args, meta) => (app as any)._executeTool(name, args, meta),
      (uri, meta) => (app as any)._executeResource(uri, meta),
      (name, args, meta) => (app as any)._executePrompt(name, args, meta),
      (uri, sid) => (app as any)._subscribeResource(uri, sid),
      (uri, sid) => (app as any)._unsubscribeResource(uri, sid),
      {
        hostname: "127.0.0.1",
        port: 0,
        health: true,
        reusePort: true,
        idleTimeout: 30,
        development: false,
        http1: true,
        http2: true,
        onListen: (info) => {
          url = info.url;
        },
      },
      app.serverInfo as any,
      (app as any)._resolvedCapabilities()
    );

    try {
      const health = await fetch(url.replace(/\/mcp$/, "/health"));
      expect(health.status).toBe(200);
      expect((await health.json()).service).toBe("opt-listen");

      const mcp = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "server/discover",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "server/discover",
          params: {},
        }),
      });
      expect(mcp.status).toBe(200);
      expect((await mcp.json()).result.serverInfo.name).toBe("opt-listen");
    } finally {
      await transport.stop();
    }
  });
});
