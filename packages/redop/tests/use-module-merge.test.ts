import { describe, expect, test } from "bun:test";

import { definePlugin, Redop } from "../src/index";

describe(".use() module merge", () => {
  test("merges tools, resources, prompts, derive, middleware, and hooks", async () => {
    const order: string[] = [];
    const features = new Redop()
      .derive(() => ({ fromModule: true }))
      .middleware(async ({ next }) => {
        order.push("module-mw");
        return next();
      })
      .onBeforeHandle(async () => {
        order.push("module-before");
      })
      .tool("mod_tool", {
        handler: async ({ ctx }) => ({ fromModule: (ctx as any).fromModule }),
      })
      .resource("mod://item", {
        name: "ModItem",
        handler: async () => ({ type: "text", text: "m" }),
      })
      .prompt("mod_prompt", {
        handler: async () => [
          { role: "user", content: { type: "text", text: "hi" } },
        ],
      });

    const app = new Redop()
      .use(features)
      .onBeforeHandle(async () => {
        order.push("host-before");
      })
      .tool("host_tool", { handler: async () => ({ host: true }) });

    expect(app.toolNames.sort()).toEqual(["host_tool", "mod_tool"]);
    expect(app.resourceUris).toContain("mod://item");
    expect(app.promptNames).toContain("mod_prompt");

    const execution = await app._executeTool(
      "mod_tool",
      {},
      { headers: {}, transport: "http" }
    );
    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect(execution.result).toEqual({ fromModule: true });
    }
    expect(order).toEqual(["module-before", "host-before", "module-mw"]);
  });

  test("later .use() silently overwrites duplicate tool names", async () => {
    const a = new Redop().tool("shared", {
      handler: async () => ({ from: "a" }),
    });
    const b = new Redop().tool("shared", {
      handler: async () => ({ from: "b" }),
    });
    const app = new Redop().use(a).use(b);
    const execution = await app._executeTool(
      "shared",
      {},
      { headers: {}, transport: "http" }
    );
    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect(execution.result).toEqual({ from: "b" });
    }
  });

  test("definePlugin exposes meta and setup composition", async () => {
    const counter = definePlugin<{ start: number }, { n: number }>({
      name: "counter",
      version: "1.2.3",
      description: "adds n",
      setup: ({ start }) =>
        new Redop<{ n: number }>()
          .derive(() => ({ n: start }))
          .tool("inc", {
            handler: async ({ ctx }) => ({ n: ctx.n + 1 }),
          }),
    });

    expect(counter.meta).toEqual({
      name: "counter",
      version: "1.2.3",
      description: "adds n",
    });

    const app = new Redop().use(counter({ start: 10 }));
    const execution = await app._executeTool(
      "inc",
      {},
      { headers: {}, transport: "http" }
    );
    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect(execution.result).toEqual({ n: 11 });
    }
  });
});
