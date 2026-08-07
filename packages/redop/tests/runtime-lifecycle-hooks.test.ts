import { describe, expect, test } from "bun:test";
import type { Server } from "node:http";

import { cloudflare } from "../src/adapters/cloudflare";
import { listenNode } from "../src/adapters/node";
import { vercel } from "../src/adapters/vercel";
import { Redop } from "../src/index";
import { PROTOCOL_LATEST } from "../src/transports/protocol";

type EventLog = string[];

function createLifecycleApp(
  name: string,
  events: EventLog,
  gate?: Promise<void>
) {
  return new Redop({
    serverInfo: { name, version: "0.1.0" },
  })
    .onTransform(({ input }) => {
      events.push("global:onTransform");
      return input;
    })
    .onParse(({ input }) => {
      events.push("global:onParse");
      return input;
    })
    .onBeforeHandle(({ tool }) => {
      events.push(`global:onBeforeHandle:${tool}`);
    })
    .onAfterHandle(({ tool }) => {
      events.push(`global:onAfterHandle:${tool}`);
    })
    .onAfterResponse(({ kind, name: hookName }) => {
      events.push(`global:onAfterResponse:${kind}:${hookName}`);
    })
    .middleware(async ({ next }) => {
      events.push("middleware:before");
      const result = await next();
      events.push("middleware:after");
      return result;
    })
    .tool("ping", {
      description: "Lifecycle probe",
      before: async () => {
        events.push("tool:before");
      },
      after: async ({ result }) => {
        events.push("tool:after");
        return result;
      },
      afterResponse: async () => {
        events.push("tool:afterResponse:start");
        if (gate) {
          await gate;
        }
        events.push("tool:afterResponse:done");
      },
      handler: async () => {
        events.push("tool:handler");
        return { ok: true, runtime: name };
      },
    });
}

function mcpCallRequest() {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": PROTOCOL_LATEST,
      "mcp-method": "tools/call",
      "mcp-name": "ping",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "ping", arguments: {} },
    }),
  });
}

const PRE_RESPONSE = [
  "global:onTransform",
  "global:onParse",
  "global:onBeforeHandle:ping",
  "middleware:before",
  "tool:before",
  "tool:handler",
  "middleware:after",
  "tool:after",
  "global:onAfterHandle:ping",
] as const;

function assertPreResponseBefore(
  events: EventLog,
  marker: string
) {
  const markerIndex = events.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  for (const event of PRE_RESPONSE) {
    const index = events.indexOf(event);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(markerIndex);
  }
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("runtime lifecycle hooks + afterResponse", () => {
  test("handler: response returns without awaiting afterResponse; hooks order is correct", async () => {
    const events: EventLog = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending: Promise<unknown>[] = [];

    const handler = createLifecycleApp("handler-lifecycle", events, gate).handler({
      health: true,
    });

    const response = await handler(mcpCallRequest(), {
      waitUntil(promise) {
        pending.push(promise);
      },
    });
    events.push("http:response-returned");

    expect(response.status).toBe(200);
    assertPreResponseBefore(events, "http:response-returned");
    // Response must be usable before afterResponse finishes.
    expect(events).not.toContain("tool:afterResponse:done");
    expect(events).not.toContain("global:onAfterResponse:tool:ping");

    const body = await response.json();
    events.push("http:body-read");
    expect(body.result.content[0].text).toContain('"ok":true');

    await flushMicrotasks();
    expect(events).toContain("tool:afterResponse:start");
    expect(events).not.toContain("tool:afterResponse:done");

    release();
    expect(pending.length).toBe(1);
    await pending[0];

    expect(events).toContain("tool:afterResponse:done");
    expect(events).toContain("global:onAfterResponse:tool:ping");
    expect(events.indexOf("http:response-returned")).toBeLessThan(
      events.indexOf("tool:afterResponse:done")
    );
    expect(events.indexOf("tool:afterResponse:done")).toBeLessThan(
      events.indexOf("global:onAfterResponse:tool:ping")
    );
  });

  test("cloudflare: waitUntil holds afterResponse until complete", async () => {
    const events: EventLog = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending: Promise<unknown>[] = [];

    const worker = cloudflare(
      createLifecycleApp("cf-lifecycle", events, gate),
      { health: true }
    );

    const response = await worker.fetch(
      mcpCallRequest(),
      {},
      {
        waitUntil(promise) {
          pending.push(promise);
        },
      }
    );
    events.push("http:response-returned");

    expect(response.status).toBe(200);
    assertPreResponseBefore(events, "http:response-returned");
    expect(events).not.toContain("tool:afterResponse:done");
    expect(pending.length).toBe(1);

    await response.json();
    await flushMicrotasks();
    expect(events).toContain("tool:afterResponse:start");
    expect(events).not.toContain("tool:afterResponse:done");

    release();
    await pending[0];

    expect(events).toContain("tool:afterResponse:done");
    expect(events).toContain("global:onAfterResponse:tool:ping");
  });

  test("vercel: waitUntil holds afterResponse until complete", async () => {
    const events: EventLog = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending: Promise<unknown>[] = [];

    const handler = vercel(createLifecycleApp("vercel-lifecycle", events, gate), {
      health: true,
      waitUntil(promise) {
        pending.push(promise);
      },
    });

    const response = await handler(mcpCallRequest());
    events.push("http:response-returned");

    expect(response.status).toBe(200);
    assertPreResponseBefore(events, "http:response-returned");
    expect(events).not.toContain("tool:afterResponse:done");
    expect(pending.length).toBe(1);

    await response.json();
    await flushMicrotasks();
    expect(events).toContain("tool:afterResponse:start");
    expect(events).not.toContain("tool:afterResponse:done");

    release();
    await pending[0];

    expect(events).toContain("tool:afterResponse:done");
    expect(events).toContain("global:onAfterResponse:tool:ping");
  });

  test("node listenNode: client gets body before afterResponse finishes", async () => {
    const events: EventLog = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const server: Server = listenNode(
      createLifecycleApp("node-lifecycle", events, gate),
      {
        hostname: "127.0.0.1",
        port: 0,
        health: true,
      }
    );

    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("expected TCP address");
      }
      const base = `http://127.0.0.1:${address.port}`;

      const response = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "tools/call",
          "mcp-name": "ping",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "ping", arguments: {} },
        }),
      });
      events.push("http:response-returned");

      expect(response.status).toBe(200);
      const body = await response.json();
      events.push("http:body-read");
      expect(body.result.content[0].text).toContain("node-lifecycle");

      assertPreResponseBefore(events, "http:response-returned");
      expect(events).not.toContain("tool:afterResponse:done");

      await flushMicrotasks();
      expect(events).toContain("tool:afterResponse:start");
      expect(events).not.toContain("tool:afterResponse:done");

      release();
      for (let i = 0; i < 20 && !events.includes("tool:afterResponse:done"); i++) {
        await new Promise((r) => setTimeout(r, 5));
      }

      expect(events).toContain("tool:afterResponse:done");
      expect(events).toContain("global:onAfterResponse:tool:ping");
      expect(events.indexOf("http:body-read")).toBeLessThan(
        events.indexOf("tool:afterResponse:done")
      );
    } finally {
      release();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test("bun handler (microtask path): afterResponse runs after response return", async () => {
    const events: EventLog = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const handler = createLifecycleApp(
      "bun-handler-lifecycle",
      events,
      gate
    ).handler({ health: true });

    const response = await handler(mcpCallRequest());
    events.push("http:response-returned");

    expect(response.status).toBe(200);
    assertPreResponseBefore(events, "http:response-returned");
    expect(events).not.toContain("tool:afterResponse:done");

    await response.json();
    events.push("http:body-read");
    await flushMicrotasks();
    expect(events).toContain("tool:afterResponse:start");
    expect(events).not.toContain("tool:afterResponse:done");

    release();
    for (let i = 0; i < 20 && !events.includes("tool:afterResponse:done"); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(events).toContain("tool:afterResponse:done");
    expect(events).toContain("global:onAfterResponse:tool:ping");
  });

  test("bun .listen: client gets body before afterResponse finishes", async () => {
    const events: EventLog = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    let base = "";
    const app = createLifecycleApp("bun-listen-lifecycle", events, gate);
    app.listen({
      hostname: "127.0.0.1",
      port: 0,
      health: true,
      onListen: ({ url }) => {
        base = url.replace(/\/mcp$/, "");
      },
    });

    try {
      for (let i = 0; i < 50 && !base; i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      expect(base).not.toBe("");

      const response = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "tools/call",
          "mcp-name": "ping",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "ping", arguments: {} },
        }),
      });
      events.push("http:response-returned");

      expect(response.status).toBe(200);
      const body = await response.json();
      events.push("http:body-read");
      expect(body.result.content[0].text).toContain("bun-listen-lifecycle");

      assertPreResponseBefore(events, "http:response-returned");
      expect(events).not.toContain("tool:afterResponse:done");

      await flushMicrotasks();
      expect(events).toContain("tool:afterResponse:start");
      expect(events).not.toContain("tool:afterResponse:done");

      release();
      for (let i = 0; i < 20 && !events.includes("tool:afterResponse:done"); i++) {
        await new Promise((r) => setTimeout(r, 5));
      }

      expect(events).toContain("tool:afterResponse:done");
      expect(events).toContain("global:onAfterResponse:tool:ping");
    } finally {
      release();
    }
  });
});
