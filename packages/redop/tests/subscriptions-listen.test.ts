import { describe, expect, test } from "bun:test";

import { PROTOCOL_LATEST, Redop } from "../src/index";
import { mcpRequest } from "./helpers";

describe("subscriptions/listen", () => {
  test("returns SSE and delivers resource updates after subscribe", async () => {
    const app = new Redop({
      serverInfo: { name: "subs", version: "0.1.0" },
    }).resource("cfg://main", {
      name: "Cfg",
      handler: async () => ({ type: "text", text: "v1" }),
    });

    const handler = app.handler();
    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "subscriptions/listen",
          accept: "text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "sub-live",
          method: "subscriptions/listen",
          params: {
            notifications: {
              resourceSubscriptions: ["cfg://main"],
            },
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    const readMore = async () => {
      const { done, value } = await reader.read();
      if (!done && value) buf += decoder.decode(value, { stream: true });
      return done;
    };

    // First frames: retry heartbeat and/or acknowledged
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline && !buf.includes("subscriptions/acknowledged")) {
      await readMore();
    }
    expect(buf).toContain("subscriptions/acknowledged");

    app.notifyResourceChanged("cfg://main");

    const updateDeadline = Date.now() + 1500;
    while (Date.now() < updateDeadline && !buf.includes("resources/updated")) {
      await readMore();
    }
    await reader.cancel().catch(() => {});

    expect(buf).toContain("resources/updated");
    expect(buf).toContain("cfg://main");
  });

  test("legacy protocol rejects subscriptions/listen", async () => {
    const app = new Redop({
      serverInfo: { name: "subs-legacy", version: "0.1.0" },
    });
    const handler = app.handler();
    const response = await handler(
      mcpRequest("subscriptions/listen", {
        protocolVersion: "2025-03-26",
        bodyParams: { notifications: {} },
      })
    );
    const body = await response.json();
    expect(response.status === 404 || body.error).toBeTruthy();
    expect(String(body.error?.message ?? "")).toMatch(
      /subscriptions\/listen|2026-07-28/
    );
  });
});
