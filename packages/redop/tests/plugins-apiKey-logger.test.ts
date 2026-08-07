import { describe, expect, test } from "bun:test";

import { apiKey, logger, Redop } from "../src/index";
import { callHandler } from "./helpers";

describe("apiKey plugin", () => {
  test("accepts configured key and rejects wrong key", async () => {
    const app = new Redop({
      serverInfo: { name: "api-key", version: "0.1.0" },
    })
      .use(apiKey({ key: "secret" }))
      .tool("ping", { handler: async () => ({ ok: true }) });

    const ok = await callHandler(app, "tools/call", {
      name: "ping",
      headers: { "x-api-key": "secret" },
    });
    expect(ok.body.result).toBeDefined();

    const bad = await callHandler(app, "tools/call", {
      name: "ping",
      headers: { "x-api-key": "nope" },
    });
    expect(bad.body.error || bad.body.result?.isError).toBeTruthy();
  });

  test("accepts any of keys[]", async () => {
    const app = new Redop({
      serverInfo: { name: "api-keys", version: "0.1.0" },
    })
      .use(apiKey({ keys: ["a", "b"] }))
      .tool("ping", { handler: async () => ({ ok: true }) });

    const { body } = await callHandler(app, "tools/call", {
      name: "ping",
      headers: { "x-api-key": "b" },
    });
    expect(body.result.content[0].text).toContain("ok");
  });

  test("custom headerName and contextKey", async () => {
    const app = new Redop({
      serverInfo: { name: "api-custom", version: "0.1.0" },
    })
      .use(apiKey({ key: "tok", headerName: "x-token", contextKey: "token" }))
      .tool("whoami", {
        handler: async ({ ctx }) => ({ token: (ctx as any).token }),
      });

    const { body } = await callHandler(app, "tools/call", {
      name: "whoami",
      headers: { "x-token": "tok" },
    });
    expect(body.result.content[0].text).toContain("tok");
  });

  test("required false allows missing header", async () => {
    const app = new Redop({
      serverInfo: { name: "api-optional", version: "0.1.0" },
    })
      .use(apiKey({ key: "secret", required: false }))
      .tool("ping", { handler: async () => ({ ok: true }) });

    const { body } = await callHandler(app, "tools/call", { name: "ping" });
    expect(body.result).toBeDefined();
  });

  test("validateKey async allow/deny", async () => {
    const app = new Redop({
      serverInfo: { name: "api-validate", version: "0.1.0" },
    })
      .use(
        apiKey({
          validateKey: async (key) => key === "good",
        })
      )
      .tool("ping", { handler: async () => ({ ok: true }) });

    const ok = await callHandler(app, "tools/call", {
      name: "ping",
      headers: { "x-api-key": "good" },
    });
    expect(ok.body.result).toBeDefined();

    const bad = await callHandler(app, "tools/call", {
      name: "ping",
      headers: { "x-api-key": "bad" },
    });
    expect(bad.body.error || bad.body.result?.isError).toBeTruthy();
  });

  test("non-HTTP transport skips auth", async () => {
    const app = new Redop()
      .use(apiKey({ key: "secret" }))
      .tool("ping", { handler: async () => ({ ok: true }) });

    const execution = await app._executeTool(
      "ping",
      {},
      { headers: {}, transport: "stdio" }
    );
    expect(execution.ok).toBe(true);
  });
});

describe("logger plugin", () => {
  test("emits start and end events via custom write", async () => {
    const entries: any[] = [];
    const app = new Redop()
      .use(
        logger({
          write: (entry) => entries.push(entry),
        })
      )
      .tool("ping", { handler: async () => ({ ok: true }) });

    await app._executeTool("ping", {}, { headers: {}, transport: "http" });
    expect(entries.some((e) => e.event === "tool.start")).toBe(true);
    expect(entries.some((e) => e.event === "tool.end")).toBe(true);
  });

  test("emits error event on throw", async () => {
    const entries: any[] = [];
    const app = new Redop()
      .use(logger({ write: (entry) => entries.push(entry) }))
      .tool("boom", {
        handler: async () => {
          throw new Error("nope");
        },
      });

    await app._executeTool("boom", {}, { headers: {}, transport: "http" });
    expect(entries.some((e) => e.event === "tool.error")).toBe(true);
  });

  test("respects level threshold", async () => {
    const entries: any[] = [];
    const app = new Redop()
      .use(logger({ level: "error", write: (entry) => entries.push(entry) }))
      .tool("ping", { handler: async () => ({ ok: true }) });

    await app._executeTool("ping", {}, { headers: {}, transport: "http" });
    expect(entries.some((e) => e.event === "tool.start")).toBe(false);
  });
});
