import { describe, expect, test } from "bun:test";

import { jwt, Redop } from "../src/index";
import { callHandler, signHs256Jwt } from "./helpers";

describe("jwt plugin", () => {
  test("construction requires secret or jwksUri", () => {
    expect(() => jwt({} as any)).toThrow(/secret|jwks/i);
  });

  test("HS256 valid token populates ctx.jwtPayload", async () => {
    const token = await signHs256Jwt({ sub: "user-1", exp: Math.floor(Date.now() / 1000) + 60 }, "s3cret");
    const app = new Redop({
      serverInfo: { name: "jwt-ok", version: "0.1.0" },
    })
      .use(jwt({ secret: "s3cret" }))
      .tool("whoami", {
        handler: async ({ ctx }) => ({ sub: (ctx as any).jwtPayload.sub }),
      });

    const { body } = await callHandler(app, "tools/call", {
      name: "whoami",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(body.result.content[0].text).toContain("user-1");
  });

  test("missing Bearer is rejected", async () => {
    const app = new Redop({
      serverInfo: { name: "jwt-missing", version: "0.1.0" },
    })
      .use(jwt({ secret: "s3cret" }))
      .tool("ping", { handler: async () => ({ ok: true }) });

    const { body } = await callHandler(app, "tools/call", { name: "ping" });
    expect(body.error || body.result?.isError).toBeTruthy();
  });

  test("optional true allows missing Authorization", async () => {
    const app = new Redop({
      serverInfo: { name: "jwt-optional", version: "0.1.0" },
    })
      .use(jwt({ secret: "s3cret", optional: true }))
      .tool("ping", { handler: async () => ({ ok: true }) });

    const { body } = await callHandler(app, "tools/call", { name: "ping" });
    expect(body.result).toBeDefined();
  });

  test("expired token is rejected", async () => {
    const token = await signHs256Jwt(
      { sub: "user-1", exp: Math.floor(Date.now() / 1000) - 10 },
      "s3cret"
    );
    const app = new Redop({
      serverInfo: { name: "jwt-exp", version: "0.1.0" },
    })
      .use(jwt({ secret: "s3cret" }))
      .tool("ping", { handler: async () => ({ ok: true }) });

    const { body } = await callHandler(app, "tools/call", {
      name: "ping",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(body.error || body.result?.isError).toBeTruthy();
  });

  test("issuer and audience are enforced", async () => {
    const token = await signHs256Jwt(
      {
        sub: "user-1",
        iss: "https://auth.example",
        aud: "mcp",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "s3cret"
    );
    const app = new Redop({
      serverInfo: { name: "jwt-claims", version: "0.1.0" },
    })
      .use(
        jwt({
          secret: "s3cret",
          issuer: "https://auth.example",
          audience: "mcp",
        })
      )
      .tool("ping", { handler: async () => ({ ok: true }) });

    const ok = await callHandler(app, "tools/call", {
      name: "ping",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.body.result).toBeDefined();

    const bad = await callHandler(
      new Redop({ serverInfo: { name: "jwt-bad-aud", version: "0.1.0" } })
        .use(jwt({ secret: "s3cret", audience: "other" }))
        .tool("ping", { handler: async () => ({ ok: true }) }),
      "tools/call",
      { name: "ping", headers: { authorization: `Bearer ${token}` } }
    );
    expect(bad.body.error || bad.body.result?.isError).toBeTruthy();
  });

  test("requiredScopes are enforced", async () => {
    const token = await signHs256Jwt(
      {
        sub: "user-1",
        scope: "read",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "s3cret"
    );
    const app = new Redop({
      serverInfo: { name: "jwt-scopes", version: "0.1.0" },
    })
      .use(jwt({ secret: "s3cret", requiredScopes: ["read", "write"] }))
      .tool("ping", { handler: async () => ({ ok: true }) });

    const { body } = await callHandler(app, "tools/call", {
      name: "ping",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(body.error || body.result?.isError).toBeTruthy();
  });

  test("non-HTTP transport skips jwt", async () => {
    const app = new Redop()
      .use(jwt({ secret: "s3cret" }))
      .tool("ping", { handler: async () => ({ ok: true }) });
    const execution = await app._executeTool(
      "ping",
      {},
      { headers: {}, transport: "stdio" }
    );
    expect(execution.ok).toBe(true);
  });
});
