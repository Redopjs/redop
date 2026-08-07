import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { Redop } from "../src/index";
import { callHandler } from "./helpers";

describe("tool structuredContent", () => {
  test("outputSchema object result includes structuredContent", async () => {
    const app = new Redop({
      serverInfo: { name: "sc", version: "0.1.0" },
    }).tool("echo", {
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ x: z.number(), doubled: z.number() }),
      handler: async ({ input }) => ({ x: input.x, doubled: input.x * 2 }),
    });

    const { body } = await callHandler(app, "tools/call", {
      name: "echo",
      args: { x: 3 },
    });
    expect(body.result.structuredContent).toEqual({ x: 3, doubled: 6 });
    expect(body.result.content[0].type).toBe("text");
  });

  test("without outputSchema, structuredContent is omitted", async () => {
    const app = new Redop({
      serverInfo: { name: "no-sc", version: "0.1.0" },
    }).tool("echo", {
      handler: async () => ({ x: 1 }),
    });

    const { body } = await callHandler(app, "tools/call", { name: "echo" });
    expect(body.result.structuredContent).toBeUndefined();
    expect(JSON.parse(body.result.content[0].text)).toEqual({ x: 1 });
  });

  test("non-object results skip structuredContent even with outputSchema", async () => {
    const app = new Redop({
      serverInfo: { name: "sc-prim", version: "0.1.0" },
    }).tool("count", {
      outputSchema: z.object({ n: z.number() }),
      handler: async () => 42 as never,
    });

    const { body } = await callHandler(app, "tools/call", { name: "count" });
    expect(body.result.structuredContent).toBeUndefined();
  });
});
