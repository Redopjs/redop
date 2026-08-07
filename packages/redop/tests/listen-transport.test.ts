import { describe, expect, test } from "bun:test";

import { Redop } from "../src/index";
import {
  getBunHttpTransport,
  registerBunHttpTransport,
} from "../src/transports/http-registry";

describe("listen transport selection", () => {
  test("unknown transport throws", () => {
    const app = new Redop();
    expect(() =>
      app.listen({ transport: "udp" as never })
    ).toThrow(/Unknown transport/);
  });

  test("http listen without Bun registry throws adapter guidance", () => {
    const previous = getBunHttpTransport();
    registerBunHttpTransport(null as never);
    try {
      const app = new Redop();
      expect(() => app.listen({ port: 3456 })).toThrow(
        /app\.handler\(\)|@redopjs\/redop\/cloudflare|Bun/
      );
    } finally {
      if (previous) {
        registerBunHttpTransport(previous);
      }
    }
  });

  test("listen({ port: 0 }) binds HTTP and reports onListen", async () => {
    let listened: { hostname: string; port: number; url: string } | null =
      null;
    const app = new Redop({
      serverInfo: { name: "listen-port", version: "0.1.0" },
    }).tool("ping", { handler: async () => ({ ok: true }) });

    app.listen({
      hostname: "127.0.0.1",
      port: 0,
      onListen: (info) => {
        listened = info;
      },
    });

    // Allow Bun.serve to start
    await new Promise((r) => setTimeout(r, 50));
    expect(listened).toBeTruthy();
    expect(listened!.port).toBeGreaterThan(0);
    expect(listened!.url).toContain(`http://127.0.0.1:${listened!.port}`);

    const response = await fetch(listened!.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "ping",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
        params: {},
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toBeDefined();
  });
});
