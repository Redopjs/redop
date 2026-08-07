import { describe, expect, test } from "bun:test";

import { encodeSse, SseHub } from "../src/transports/sse";

describe("SSE hub", () => {
  test("encodeSse writes id, event, retry, and data lines", () => {
    const bytes = encodeSse({ hello: "world" }, {
      id: "1",
      event: "message",
      retry: 5000,
    });
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("id: 1\n");
    expect(text).toContain("event: message\n");
    expect(text).toContain("retry: 5000\n");
    expect(text).toContain('data: {"hello":"world"}\n\n');
  });

  test("broadcastFiltered respects list_changed filters", async () => {
    const hub = new SseHub();
    const { stream } = hub.open("sub-1", null, {
      filter: { toolsListChanged: true },
    });
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    // drain open heartbeat/retry frame if any
    const first = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value?: undefined }>((r) =>
        setTimeout(() => r({ done: true }), 20)
      ),
    ]);
    void first;

    expect(
      hub.send("sub-1", {
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
        params: {},
      })
    ).toBe(true);
    expect(
      hub.send("sub-1", {
        jsonrpc: "2.0",
        method: "notifications/prompts/list_changed",
        params: {},
      })
    ).toBe(false);

    // progress / resource updated always pass
    expect(
      hub.send("sub-1", {
        jsonrpc: "2.0",
        method: "notifications/resources/updated",
        params: { uri: "x://y" },
      })
    ).toBe(true);

    const chunks: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value?: undefined }>((r) =>
          setTimeout(() => r({ done: true }), 50)
        ),
      ]);
      if (done || !value) break;
      chunks.push(decoder.decode(value));
    }

    const joined = chunks.join("");
    expect(joined).toContain("tools/list_changed");
    expect(joined).toContain("resources/updated");
    expect(joined).not.toContain("prompts/list_changed");

    hub.closeSession("sub-1");
    await reader.cancel().catch(() => {});
  });

  test("send returns false when no streams are open", () => {
    const hub = new SseHub();
    expect(hub.send("missing", { ok: true })).toBe(false);
  });
});
