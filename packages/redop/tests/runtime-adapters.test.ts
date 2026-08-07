import { describe, expect, test } from "bun:test";

import { toCloudflare } from "../src/adapters/cloudflare";
import { toVercel } from "../src/adapters/vercel";
import { toNodeFetch } from "../src/adapters/node";
import { Redop } from "../src/index";
import { PROTOCOL_LATEST } from "../src/transports/protocol";

function makeApp() {
  return new Redop({
    serverInfo: { name: "adapter-test", version: "0.1.0" },
  }).tool("ping", {
    handler: async () => ({ ok: true }),
  });
}

async function discover(handler: (req: Request) => Promise<Response> | Response) {
  const response = await handler(
    new Request("http://localhost/mcp", {
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
    })
  );

  return {
    response,
    body: await response.json(),
  };
}

describe("runtime adapters", () => {
  test("app.handler serves stateless MCP discover", async () => {
    const app = makeApp();
    const { response, body } = await discover(app.handler());

    expect(response.status).toBe(200);
    expect(body.result.serverInfo.name).toBe("adapter-test");
    expect(body.result.supportedVersions).toContain(PROTOCOL_LATEST);
  });

  test("toCloudflare wires waitUntil for afterResponse", async () => {
    const pending: Promise<unknown>[] = [];
    let afterRan = false;

    const app = new Redop({
      serverInfo: { name: "cf-test", version: "0.1.0" },
    }).tool("ping", {
      handler: async () => ({ ok: true }),
      afterResponse: async () => {
        afterRan = true;
      },
    });

    const worker = toCloudflare(app);
    const response = await worker.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "tools/call",
          "mcp-name": "ping",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "ping", arguments: {} },
        }),
      }),
      {},
      {
        waitUntil(promise) {
          pending.push(promise);
        },
      }
    );

    expect(response.status).toBe(200);
    expect(pending.length).toBe(1);
    await pending[0];
    expect(afterRan).toBe(true);
  });

  test("toVercel accepts an injected waitUntil", async () => {
    const pending: Promise<unknown>[] = [];
    let afterRan = false;

    const app = new Redop({
      serverInfo: { name: "vercel-test", version: "0.1.0" },
    }).tool("ping", {
      handler: async () => ({ ok: true }),
      afterResponse: async () => {
        afterRan = true;
      },
    });

    const handler = toVercel(app, {
      waitUntil(promise) {
        pending.push(promise);
      },
    });

    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "tools/call",
          "mcp-name": "ping",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "ping", arguments: {} },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(pending.length).toBe(1);
    await pending[0];
    expect(afterRan).toBe(true);
  });

  test("toNodeFetch mirrors app.handler", async () => {
    const app = makeApp();
    const { body } = await discover(toNodeFetch(app));
    expect(body.result.serverInfo.name).toBe("adapter-test");
  });
});
