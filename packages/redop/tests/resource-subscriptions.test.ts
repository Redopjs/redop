import { describe, expect, test } from "bun:test";

import { Redop } from "../src/index";

describe("resource subscriptions", () => {
  test("notifyResourceChanged broadcasts to subscribed sessions only", () => {
    const app = new Redop().resource("config://server", {
      name: "Config",
      handler: async () => ({ type: "text", text: "ok" }),
    });

    const seen: Array<{ sid: string; data: any }> = [];
    app._setBroadcast((sid, data) => seen.push({ sid, data }));
    app._subscribeResource("config://server", "s1");
    app._subscribeResource("config://server", "s2");
    app._subscribeResource("other://uri", "s3");

    app.notifyResourceChanged("config://server");

    expect(seen).toHaveLength(2);
    expect(seen.map((e) => e.sid).sort()).toEqual(["s1", "s2"]);
    expect(seen[0]!.data).toMatchObject({
      jsonrpc: "2.0",
      method: "notifications/resources/updated",
      params: { uri: "config://server" },
    });
  });

  test("unsubscribe stops further notifications", () => {
    const app = new Redop();
    const seen: string[] = [];
    app._setBroadcast((sid) => seen.push(sid));
    app._subscribeResource("docs://a", "s1");
    app._unsubscribeResource("docs://a", "s1");
    app.notifyResourceChanged("docs://a");
    expect(seen).toEqual([]);
  });

  test("notify without subscribers or broadcast is a no-op", () => {
    const app = new Redop();
    expect(() => app.notifyResourceChanged("missing://x")).not.toThrow();
    app._subscribeResource("missing://x", "s1");
    expect(() => app.notifyResourceChanged("missing://x")).not.toThrow();
  });
});
