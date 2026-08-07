import { describe, expect, test } from "bun:test";
import { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { Socket } from "node:net";

import {
  cloudflare,
  withCloudflareWaitUntil,
} from "../src/adapters/cloudflare";
import {
  incomingMessageToRequest,
  nodeListener,
  toNodeHandler,
  toNodeListener,
  writeNodeResponse,
} from "../src/adapters/node";
import { vercel, vercelEdge, toVercelEdge } from "../src/adapters/vercel";
import { Redop } from "../src/index";
import { PROTOCOL_LATEST } from "../src/transports/protocol";
import { scheduleAfterResponse } from "../src/transports/runtime";

function mcpCall() {
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

describe("runtime adapters extended", () => {
  test("withCloudflareWaitUntil forwards waitUntil", async () => {
    const pending: Promise<unknown>[] = [];
    let after = false;
    const app = new Redop({
      serverInfo: { name: "cf-w", version: "0.1.0" },
    }).tool("ping", {
      handler: async () => ({ ok: true }),
      afterResponse: async () => {
        after = true;
      },
    });
    const wrapped = withCloudflareWaitUntil(app.handler(), {
      waitUntil(p) {
        pending.push(p);
      },
    });
    const response = await wrapped(mcpCall());
    expect(response.status).toBe(200);
    expect(pending.length).toBe(1);
    await pending[0];
    expect(after).toBe(true);
  });

  test("cloudflare lazily creates handler on first fetch", async () => {
    const app = new Redop({
      serverInfo: { name: "cf-lazy", version: "0.1.0" },
    }).tool("ping", { handler: async () => ({ ok: true }) });
    const worker = cloudflare(app);
    const one = await worker.fetch(mcpCall(), {}, { waitUntil() {} });
    const two = await worker.fetch(mcpCall(), {}, { waitUntil() {} });
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
  });

  test("vercelEdge aliases and microtask path works without waitUntil", async () => {
    expect(toVercelEdge).toBe(vercelEdge);

    let after = false;
    const handler = vercelEdge(
      new Redop({
        serverInfo: { name: "vercel-micro", version: "0.1.0" },
      }).tool("ping", {
        handler: async () => ({ ok: true }),
        afterResponse: async () => {
          after = true;
        },
      })
    );
    const response = await handler(mcpCall());
    expect(response.status).toBe(200);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(after).toBe(true);
  });

  test("incomingMessageToRequest maps headers and GET has no body", async () => {
    const socket = new Socket();
    const req = new IncomingMessage(socket);
    req.method = "GET";
    req.url = "/mcp?x=1";
    req.headers = { host: "example.test", "x-test": "1" };
    const request = await incomingMessageToRequest(req, {
      hostname: "example.test",
      port: 80,
    });
    expect(request.method).toBe("GET");
    expect(request.headers.get("x-test")).toBe("1");
    expect(request.url).toContain("/mcp?x=1");
  });

  test("writeNodeResponse copies status headers for empty body", async () => {
    const res: any = {
      statusCode: 200,
      headers: {} as Record<string, string | string[]>,
      headersSent: false,
      setHeader(key: string, value: string | string[]) {
        this.headers[key.toLowerCase()] = value;
      },
      getHeader(key: string) {
        return this.headers[key.toLowerCase()];
      },
      end() {
        this.headersSent = true;
      },
      destroy() {},
      on() {
        return this;
      },
    };

    await writeNodeResponse(
      new Response(null, {
        status: 204,
        headers: { "x-test": "1" },
      }),
      res
    );
    expect(res.statusCode).toBe(204);
    expect(res.headers["x-test"]).toBe("1");
    expect(res.headersSent).toBe(true);
  });

  test("nodeListener aliases and health option", async () => {
    expect(toNodeListener).toBe(nodeListener);
    expect(toNodeHandler).toBe(nodeListener);

    const app = new Redop({
      serverInfo: { name: "node-ext", version: "0.1.0" },
    }).tool("ping", { handler: async () => ({ ok: true }) });
    const listener = nodeListener(app, { health: true });
    expect(typeof listener).toBe("function");
  });

  test("scheduleAfterResponse uses waitUntil when provided", async () => {
    const pending: Promise<unknown>[] = [];
    let ran = false;
    scheduleAfterResponse(
      async () => {
        ran = true;
      },
      {
        waitUntil(p) {
          pending.push(p);
        },
      }
    );
    expect(pending.length).toBe(1);
    await pending[0];
    expect(ran).toBe(true);
  });

  test("POST incomingMessageToRequest includes body", async () => {
    const socket = new Socket();
    const req = new IncomingMessage(socket);
    req.method = "POST";
    req.url = "/mcp";
    req.headers = {
      host: "localhost",
      "content-type": "application/json",
    };

    const body = Readable.from([Buffer.from('{"ok":true}')]);
    Object.assign(req, {
      [Symbol.asyncIterator]: body[Symbol.asyncIterator].bind(body),
    });

    // Feed as async iterable for for-await in incomingMessageToRequest
    (req as any)[Symbol.asyncIterator] = async function* () {
      yield Buffer.from('{"ok":true}');
    };

    const request = await incomingMessageToRequest(req);
    expect(request.method).toBe("POST");
    expect(await request.text()).toBe('{"ok":true}');
  });
});
