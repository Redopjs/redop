import { describe, expect, test } from "bun:test";

import type { RequestMeta } from "../src/index";
import { apiKey, bearer, middleware, Redop, rateLimit } from "../src/index";

async function runTool(
  app: Redop,
  name: string,
  args: Record<string, unknown>,
  requestMeta: RequestMeta
) {
  return (
    app as unknown as {
      _runTool: (
        toolName: string,
        rawArgs: Record<string, unknown>,
        meta: RequestMeta
      ) => Promise<unknown>;
    }
  )._runTool(name, args, requestMeta);
}

describe("auth plugins", () => {
  test("apiKey validates x-api-key headers and injects the key on ctx", async () => {
    const app = new Redop().use(apiKey({ secret: "top-secret" })).tool("ping", {
      handler: ({ ctx, request }) => {
        expect(request.headers["x-api-key"]).toBe("top-secret");
        return {
          apiKey: (ctx as Record<string, unknown>).apiKey,
          ok: true,
        };
      },
    });

    expect(
      await runTool(
        app,
        "ping",
        {},
        {
          headers: { "x-api-key": "top-secret" },
          ip: "127.0.0.1",
          method: "POST",
          raw: new Request("http://localhost:3000/mcp", { method: "POST" }),
          transport: "http",
          url: "http://localhost:3000/mcp",
        }
      )
    ).toEqual({ apiKey: "top-secret", ok: true });
  });

  test("apiKey rejects missing required headers over http", async () => {
    const app = new Redop().use(apiKey({ secret: "top-secret" })).tool("ping", {
      handler: () => ({ ok: true }),
    });

    await expect(
      runTool(app, "ping", {}, { headers: {}, transport: "http" })
    ).rejects.toThrow("Unauthorized: missing x-api-key header");
  });

  test("bearer parses Authorization headers and strips the scheme", async () => {
    const app = new Redop().use(bearer({ secret: "dev-secret" })).tool("ping", {
      handler: ({ ctx }) => ({
        ok: true,
        token: (ctx as Record<string, unknown>).token,
      }),
    });

    expect(
      await runTool(
        app,
        "ping",
        {},
        {
          headers: { authorization: "Bearer dev-secret" },
          transport: "http",
        }
      )
    ).toEqual({ ok: true, token: "dev-secret" });
  });

  test("header auth is skipped for stdio transport", async () => {
    const app = new Redop().use(apiKey({ secret: "top-secret" })).tool("ping", {
      handler: ({ request }) => ({
        hasIp: request.ip ?? null,
        hasRaw: request.raw ?? null,
        transport: request.transport,
      }),
    });

    expect(
      await runTool(app, "ping", {}, { headers: {}, transport: "stdio" })
    ).toEqual({
      hasIp: null,
      hasRaw: null,
      transport: "stdio",
    });
  });

  test("custom middleware can short-circuit before the handler", async () => {
    let handlerRan = false;

    const app = new Redop()
      .use(
        middleware(async ({ request, next }) => {
          if (request.ip === "blocked") {
            throw new Error("blocked");
          }
          return next();
        })
      )
      .tool("ping", {
        handler: () => {
          handlerRan = true;
          return { ok: true };
        },
      });

    await expect(
      runTool(
        app,
        "ping",
        {},
        {
          headers: {},
          ip: "blocked",
          transport: "http",
        }
      )
    ).rejects.toThrow("blocked");
    expect(handlerRan).toBe(false);
  });

  test("built-in rateLimit can key off request metadata", async () => {
    const app = new Redop()
      .use(
        rateLimit({
          keyBy: ({ request }) => request.ip ?? "unknown",
          max: 1,
          window: "1m",
        })
      )
      .tool("ping", {
        handler: () => ({ ok: true }),
      });

    await expect(
      runTool(
        app,
        "ping",
        {},
        {
          headers: {},
          ip: "10.0.0.1",
          transport: "http",
        }
      )
    ).resolves.toEqual({ ok: true });

    await expect(
      runTool(
        app,
        "ping",
        {},
        {
          headers: {},
          ip: "10.0.0.1",
          transport: "http",
        }
      )
    ).rejects.toThrow("Rate limit exceeded");
  });
});
