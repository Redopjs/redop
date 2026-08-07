import { describe, expect, test } from "bun:test";

import { oauth, Redop } from "../src/index";
import { requireScopes } from "../src/plugins/auth";
import { callHandler } from "./helpers";

describe("oauth plugin and requireScopes", () => {
  test("missing Bearer is rejected on HTTP", async () => {
    const app = new Redop({
      serverInfo: { name: "oauth-missing", version: "0.1.0" },
    })
      .use(
        oauth({
          issuer: "https://auth.example.com",
          audience: "https://mcp.example.com",
        })
      )
      .tool("ping", { handler: async () => ({ ok: true }) });

    const { response, body } = await callHandler(app, "tools/call", {
      name: "ping",
    });
    expect(response.status).toBe(401);
    expect(body.error || body.result?.isError).toBeTruthy();
  });

  test("non-HTTP transport skips oauth", async () => {
    const app = new Redop()
      .use(
        oauth({
          issuer: "https://auth.example.com",
          audience: "https://mcp.example.com",
        })
      )
      .tool("ping", { handler: async () => ({ ok: true }) });

    const execution = await app._executeTool("ping", {}, {
      headers: {},
      transport: "stdio",
    });
    expect(execution.ok).toBe(true);
  });

  test("discovery failure surfaces as auth error", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("nope", { status: 500 })) as typeof fetch;

    try {
      const app = new Redop({
        serverInfo: { name: "oauth-disc", version: "0.1.0" },
      })
        .use(
          oauth({
            issuer: "https://auth.example.com",
            audience: "https://mcp.example.com",
            discoveryTtl: 1,
          })
        )
        .tool("ping", { handler: async () => ({ ok: true }) });

      const { response, body } = await callHandler(app, "tools/call", {
        name: "ping",
        headers: { authorization: "Bearer tok" },
      });
      expect(response.status).toBe(401);
      expect(body.error || body.result?.isError).toBeTruthy();
      const msg = String(
        body.error?.message ?? body.result?.content?.[0]?.text ?? ""
      );
      expect(msg).toMatch(/discovery|OAuth|Unauthorized|failed|token/i);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("requireScopes enforces granted scopes", () => {
    expect(() =>
      requireScopes({ jwtPayload: { scope: "read" } }, ["write"])
    ).toThrow(/missing scope 'write'/);

    expect(() =>
      requireScopes({ jwtPayload: { scope: "read write" } }, ["write"])
    ).not.toThrow();

    expect(() => requireScopes({}, ["read"])).toThrow(/no auth payload/);
  });

  test("requireScopes can read custom payload key", () => {
    expect(() =>
      requireScopes(
        { oauthPayload: { scope: "admin" } },
        ["admin"],
        "oauthPayload"
      )
    ).not.toThrow();
  });
});
