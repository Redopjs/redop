import { describe, expect, test } from "bun:test";

import { Redop } from "../src/index";
import { PROTOCOL_LATEST } from "../src/transports/protocol";
import { callHandler, mcpRequest } from "./helpers";

describe("HTTP CORS, health, and path", () => {
  test("OPTIONS returns 204 with CORS allow headers", async () => {
    const app = new Redop({
      serverInfo: { name: "cors", version: "0.1.0" },
    }).tool("ping", { handler: async () => ({ ok: true }) });
    const handler = app.handler({ health: true });
    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "OPTIONS",
        headers: { origin: "http://127.0.0.1:3000" },
      })
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
      "POST"
    );
  });

  test("responses include Access-Control-Allow-Origin", async () => {
    const app = new Redop({
      serverInfo: { name: "cors2", version: "0.1.0" },
    }).tool("ping", { handler: async () => ({ ok: true }) });
    const { response } = await callHandler(app, "server/discover");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
  });

  test("health true serves GET /health JSON", async () => {
    const app = new Redop({
      serverInfo: { name: "health-app", version: "0.1.0" },
    }).tool("ping", { handler: async () => ({ ok: true }) });
    const handler = app.handler({ health: true });
    const response = await handler(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("health-app");
  });

  test("custom health path works and HEAD returns empty 200", async () => {
    const app = new Redop({
      serverInfo: { name: "health-custom", version: "0.1.0" },
    }).tool("ping", { handler: async () => ({ ok: true }) });
    const handler = app.handler({ health: { path: "/readyz" } });

    const get = await handler(new Request("http://localhost/readyz"));
    expect(get.status).toBe(200);

    const head = await handler(
      new Request("http://localhost/readyz", { method: "HEAD" })
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("health path cannot match MCP path", () => {
    const app = new Redop().tool("ping", { handler: async () => ({ ok: true }) });
    expect(() => app.handler({ path: "/mcp", health: { path: "/mcp" } })).toThrow(
      /health path cannot match/i
    );
  });

  test("custom MCP path serves there and 404s elsewhere", async () => {
    const app = new Redop({
      serverInfo: { name: "custom-path", version: "0.1.0" },
    }).tool("ping", { handler: async () => ({ ok: true }) });
    const handler = app.handler({ path: "/v1/mcp", health: true });

    const ok = await handler(
      mcpRequest("server/discover", { path: "/v1/mcp" })
    );
    expect(ok.status).toBe(200);

    const missing = await handler(new Request("http://localhost/mcp", {
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
    }));
    expect(missing.status).toBe(404);
  });
});

describe("HTTP errors and list cache", () => {
  test("invalid JSON body returns -32700", async () => {
    const app = new Redop({
      serverInfo: { name: "bad-json", version: "0.1.0" },
    }).tool("ping", { handler: async () => ({ ok: true }) });
    const handler = app.handler();
    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "server/discover",
        },
        body: "{not-json",
      })
    );
    const body = await response.json();
    expect(body.error.code).toBe(-32700);
  });

  test("unknown tool call returns error payload", async () => {
    const app = new Redop({
      serverInfo: { name: "unknown-tool", version: "0.1.0" },
    }).tool("ping", { handler: async () => ({ ok: true }) });

    const { body } = await callHandler(app, "tools/call", { name: "missing" });
    expect(body.error || body.result?.isError).toBeTruthy();
  });

  test("tool throw becomes isError tool result", async () => {
    const app = new Redop({
      serverInfo: { name: "tool-throw", version: "0.1.0" },
    }).tool("boom", {
      handler: async () => {
        throw new Error("explode");
      },
    });
    const { body } = await callHandler(app, "tools/call", { name: "boom" });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/explode/);
  });

  test("resource throw becomes JSON-RPC error", async () => {
    const app = new Redop({
      serverInfo: { name: "res-throw", version: "0.1.0" },
    }).resource("config://server", {
      name: "Server",
      handler: async () => {
        throw new Error("res-boom");
      },
    });
    const { body } = await callHandler(app, "resources/read", {
      name: "config://server",
    });
    expect(body.error).toBeDefined();
    expect(body.error.message).toMatch(/res-boom/);
  });

  test("custom listCache ttlMs appears on discover", async () => {
    const app = new Redop({
      serverInfo: { name: "cache", version: "0.1.0" },
    }).tool("ping", { handler: async () => ({ ok: true }) });
    const { body } = await callHandler(
      app,
      "server/discover",
      {},
      { listCache: { ttlMs: 12_000, cacheScope: "private" } }
    );
    expect(body.result.ttlMs).toBe(12_000);
    expect(body.result.cacheScope).toBe("private");
  });

  test("capability disabled tools returns method not found style error", async () => {
    const app = new Redop({
      serverInfo: { name: "no-tools", version: "0.1.0" },
      capabilities: { tools: false, resources: true, prompts: true },
    });
    const { body } = await callHandler(app, "tools/list");
    expect(body.error).toBeDefined();
  });
});
