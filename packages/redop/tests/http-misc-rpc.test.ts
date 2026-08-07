import { describe, expect, test } from "bun:test";

import {
  InputRequiredError,
  PROTOCOL_LATEST,
  requireInput,
  Redop,
} from "../src/index";
import { callHandler, mcpRequest } from "./helpers";

describe("HTTP misc RPC and content shapes", () => {
  test("ping returns empty result", async () => {
    const app = new Redop({
      serverInfo: { name: "ping", version: "0.1.0" },
    });
    const { body } = await callHandler(app, "ping");
    expect(body.error).toBeUndefined();
    expect(body.result).toMatchObject({});
  });

  test("notification without id returns 202", async () => {
    const app = new Redop({
      serverInfo: { name: "notif", version: "0.1.0" },
    });
    const handler = app.handler();
    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "notifications/initialized",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        }),
      })
    );
    expect(response.status).toBe(202);
  });

  test("resource blob contents serialize blob field", async () => {
    const blob = Buffer.from("hi").toString("base64");
    const app = new Redop({
      serverInfo: { name: "blob", version: "0.1.0" },
    }).resource("bin://x", {
      name: "Bin",
      handler: async () => ({
        type: "blob",
        blob,
        mimeType: "application/octet-stream",
      }),
    });

    const { body } = await callHandler(app, "resources/read", {
      name: "bin://x",
    });
    expect(body.result.contents[0].blob).toBe(blob);
    expect(body.result.contents[0].text).toBeUndefined();
  });

  test("prompt object shape { messages } passes through HTTP", async () => {
    const app = new Redop({
      serverInfo: { name: "prompt-shape", version: "0.1.0" },
    }).prompt("pack", {
      handler: async () => ({
        description: "Packaged",
        messages: [
          { role: "user", content: { type: "text", text: "hello" } },
        ],
      }),
    });

    const { body } = await callHandler(app, "prompts/get", { name: "pack" });
    expect(body.result.description).toBe("Packaged");
    expect(body.result.messages[0].content.text).toBe("hello");
  });

  test("resource requireInput returns input_required on latest protocol", async () => {
    const app = new Redop({
      serverInfo: { name: "res-input", version: "0.1.0" },
    }).resource("needs://input", {
      name: "NeedsInput",
      handler: async ({ ctx }) => {
        if (!(ctx.rawParams as any)?.filled) {
          requireInput({
            inputRequests: {
              filled: { description: "fill me", type: "boolean" },
            },
          });
        }
        return { type: "text", text: "done" };
      },
    });

    const { body } = await callHandler(app, "resources/read", {
      name: "needs://input",
    });
    expect(body.result.resultType).toBe("input_required");
    expect(body.result.inputRequests).toBeDefined();
  });

  test("handler() caches first HttpApp options", async () => {
    const app = new Redop({
      serverInfo: { name: "cache", version: "0.1.0" },
    }).tool("ping", { handler: async () => ({ ok: true }) });

    const first = app.handler({ path: "/a" });
    // Second call ignores new options because HttpApp is cached.
    app.handler({ path: "/b" });

    const ok = await first(mcpRequest("tools/call", { name: "ping", path: "/a" }));
    expect(ok.status).toBe(200);

    const missing = await first(
      mcpRequest("tools/call", { name: "ping", path: "/b" })
    );
    expect(missing.status).toBe(404);
  });

  test("InputRequiredError is instanceof checkable", () => {
    try {
      requireInput({
        inputRequests: { q: { description: "q", type: "string" } },
      });
    } catch (e) {
      expect(e).toBeInstanceOf(InputRequiredError);
    }
  });
});
