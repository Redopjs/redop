import { describe, expect, test } from "bun:test";

import {
  HttpAuthError,
  oauth,
  Redop,
  requireScopes,
} from "../src/index";
import { callHandler, mcpRequest, signHs256Jwt } from "./helpers";
import { jwt } from "../src/plugins/auth";

describe("MCP OAuth protected resource + challenges", () => {
  test("serves RFC 9728 protected resource metadata", async () => {
    const app = new Redop({
      serverInfo: { name: "prm", version: "0.1.0" },
    })
      .use(
        oauth({
          issuer: "https://auth.example.com",
          resource: "https://mcp.example.com/mcp",
          requiredScopes: ["mcp:tools"],
        })
      )
      .tool("ping", { handler: async () => ({ ok: true }) });

    const handler = app.handler();
    const root = await handler(
      new Request("http://localhost/.well-known/oauth-protected-resource")
    );
    const suffixed = await handler(
      new Request(
        "http://localhost/.well-known/oauth-protected-resource/mcp"
      )
    );

    expect(root.status).toBe(200);
    expect(suffixed.status).toBe(200);
    const body = await root.json();
    expect(body).toMatchObject({
      resource: "https://mcp.example.com/mcp",
      authorization_servers: ["https://auth.example.com"],
      scopes_supported: ["mcp:tools"],
      bearer_methods_supported: ["header"],
    });
  });

  test("unauthenticated tools/call returns HTTP 401 with WWW-Authenticate", async () => {
    const app = new Redop({
      serverInfo: { name: "oauth-401", version: "0.1.0" },
    })
      .use(
        oauth({
          issuer: "https://auth.example.com",
          resource: "https://mcp.example.com/mcp",
          requiredScopes: ["mcp:tools"],
        })
      )
      .tool("ping", { handler: async () => ({ ok: true }) });

    const { response, body } = await callHandler(app, "tools/call", {
      name: "ping",
    });

    expect(response.status).toBe(401);
    const www = response.headers.get("www-authenticate") ?? "";
    expect(www).toContain("Bearer");
    expect(www).toContain(
      'resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"'
    );
    expect(www).toContain('scope="mcp:tools"');
    expect(www).toContain('error="invalid_token"');
    expect(body.error?.message).toMatch(/Unauthorized|Bearer/i);
  });

  test("initialize and tools/list stay public without a token", async () => {
    const app = new Redop({
      serverInfo: { name: "oauth-public", version: "0.1.0" },
    })
      .use(
        oauth({
          issuer: "https://auth.example.com",
          resource: "https://mcp.example.com/mcp",
        })
      )
      .tool("ping", { handler: async () => ({ ok: true }) });

    const discover = await callHandler(app, "server/discover");
    expect(discover.response.status).toBe(200);
    expect(discover.body.result.serverInfo.name).toBe("oauth-public");

    const list = await callHandler(app, "tools/list");
    expect(list.response.status).toBe(200);
    expect(list.body.result.tools.some((t: any) => t.name === "ping")).toBe(
      true
    );
  });

  test("jwt({ resource }) also serves PRM and challenges", async () => {
    const app = new Redop({
      serverInfo: { name: "jwt-prm", version: "0.1.0" },
    })
      .use(
        jwt({
          secret: "s3cret",
          issuer: "https://auth.example.com",
          resource: "https://mcp.example.com/mcp",
          requiredScopes: ["read"],
        })
      )
      .tool("ping", { handler: async () => ({ ok: true }) });

    const handler = app.handler();
    const prm = await handler(
      new Request(
        "http://localhost/.well-known/oauth-protected-resource/mcp"
      )
    );
    expect(prm.status).toBe(200);
    expect((await prm.json()).authorization_servers).toEqual([
      "https://auth.example.com",
    ]);

    const denied = await callHandler(app, "tools/call", { name: "ping" });
    expect(denied.response.status).toBe(401);
    expect(denied.response.headers.get("www-authenticate")).toContain(
      "resource_metadata="
    );
  });

  test("valid JWT bearer succeeds on tools/call", async () => {
    const token = await signHs256Jwt(
      {
        sub: "user-1",
        iss: "https://auth.example.com",
        aud: "https://mcp.example.com/mcp",
        scope: "mcp:tools",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "s3cret"
    );

    const app = new Redop({
      serverInfo: { name: "jwt-ok", version: "0.1.0" },
    })
      .use(
        jwt({
          secret: "s3cret",
          issuer: "https://auth.example.com",
          resource: "https://mcp.example.com/mcp",
          requiredScopes: ["mcp:tools"],
        })
      )
      .tool("whoami", {
        handler: async ({ ctx }) => ({
          sub: (ctx as any).jwtPayload.sub,
        }),
      });

    const { response, body } = await callHandler(app, "tools/call", {
      name: "whoami",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(body.result.isError).toBeFalsy();
    expect(JSON.parse(body.result.content[0].text)).toEqual({ sub: "user-1" });
  });

  test("missing required scope returns HTTP 403 insufficient_scope", async () => {
    const token = await signHs256Jwt(
      {
        sub: "user-1",
        iss: "https://auth.example.com",
        aud: "https://mcp.example.com/mcp",
        scope: "read",
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      "s3cret"
    );

    const app = new Redop({
      serverInfo: { name: "jwt-scope", version: "0.1.0" },
    })
      .use(
        jwt({
          secret: "s3cret",
          issuer: "https://auth.example.com",
          resource: "https://mcp.example.com/mcp",
          requiredScopes: ["mcp:tools"],
        })
      )
      .tool("ping", { handler: async () => ({ ok: true }) });

    const { response } = await callHandler(app, "tools/call", {
      name: "ping",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(403);
    const www = response.headers.get("www-authenticate") ?? "";
    expect(www).toContain('error="insufficient_scope"');
    expect(www).toContain('scope="mcp:tools"');
  });

  test("requireScopes throws HttpAuthError 403", () => {
    try {
      requireScopes({ jwtPayload: { scope: "read" } }, ["write"]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpAuthError);
      expect((e as HttpAuthError).status).toBe(403);
      expect((e as HttpAuthError).wwwAuthenticate).toContain(
        "insufficient_scope"
      );
    }
  });

  test("Claude-style challenge points clients at PRM then AS", async () => {
    const app = new Redop({
      serverInfo: { name: "claude-shape", version: "0.1.0" },
    })
      .use(
        oauth({
          issuer: "https://clerk.example.com",
          resource: "https://mcp.example.com/mcp",
          scopesSupported: ["openid", "mcp:tools"],
          requiredScopes: ["mcp:tools"],
        })
      )
      .tool("ping", { handler: async () => ({ ok: true }) });

    const handler = app.handler();
    const denied = await handler(
      mcpRequest("tools/call", { name: "ping" })
    );
    expect(denied.status).toBe(401);
    const www = denied.headers.get("www-authenticate")!;
    const match = www.match(/resource_metadata="([^"]+)"/);
    expect(match?.[1]).toBe(
      "http://localhost/.well-known/oauth-protected-resource/mcp"
    );

    const prm = await handler(new Request(match![1]!));
    expect(prm.status).toBe(200);
    const doc = await prm.json();
    expect(doc.authorization_servers).toEqual(["https://clerk.example.com"]);
    expect(doc.resource).toBe("https://mcp.example.com/mcp");
  });
});

describe("oauth without resource (validate-only)", () => {
  test("still returns HTTP 401 for missing bearer", async () => {
    const app = new Redop({
      serverInfo: { name: "oauth-plain", version: "0.1.0" },
    })
      .use(
        oauth({
          issuer: "https://auth.example.com",
          audience: "https://mcp.example.com",
        })
      )
      .tool("ping", { handler: async () => ({ ok: true }) });

    const { response } = await callHandler(app, "tools/call", {
      name: "ping",
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(response.headers.get("www-authenticate")).not.toContain(
      "resource_metadata="
    );
  });
});
