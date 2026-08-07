import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { definePlugin, middleware, Redop } from "../src/index";

describe("middleware, derive, and abortSignal", () => {
  test("tool chain is global then local middleware then handler", async () => {
    const order: string[] = [];
    const app = new Redop()
      .middleware(async ({ next }) => {
        order.push("global:before");
        const result = await next();
        order.push("global:after");
        return result;
      })
      .tool("ping", {
        middleware: [
          async ({ next }) => {
            order.push("local:before");
            const result = await next();
            order.push("local:after");
            return result;
          },
        ],
        handler: async () => {
          order.push("handler");
          return { ok: true };
        },
      });

    await app._executeTool("ping", {}, { headers: {}, transport: "http" });
    expect(order).toEqual([
      "global:before",
      "local:before",
      "handler",
      "local:after",
      "global:after",
    ]);
  });

  test("two derive fns merge and later overwrites keys", async () => {
    const app = new Redop()
      .derive(() => ({ a: 1, b: 1 }))
      .derive(() => ({ b: 2, c: 3 }))
      .tool("ping", {
        handler: async ({ ctx }) => ctx,
      });

    const execution = await app._executeTool(
      "ping",
      {},
      { headers: {}, transport: "http" }
    );
    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect(execution.result).toMatchObject({ a: 1, b: 2, c: 3 });
    }
  });

  test("onTransform replaces raw params before parse", async () => {
    const app = new Redop()
      .onTransform(() => ({ q: "transformed" }))
      .tool("search", {
        inputSchema: z.object({ q: z.string() }),
        handler: async ({ input }) => input,
      });

    const execution = await app._executeTool(
      "search",
      { q: "original" },
      { headers: {}, transport: "http" }
    );
    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect(execution.result).toEqual({ q: "transformed" });
    }
  });

  test("onParse replaces parsed input before before-hooks", async () => {
    const seen: string[] = [];
    const app = new Redop()
      .onParse(({ input }) => {
        seen.push(`parse:${(input as any).q}`);
        return { q: "parsed" };
      })
      .onBeforeHandle(({ input }) => {
        seen.push(`before:${(input as any).q}`);
      })
      .tool("search", {
        inputSchema: z.object({ q: z.string() }),
        handler: async ({ input }) => {
          seen.push(`handler:${input.q}`);
          return input;
        },
      });

    await app._executeTool(
      "search",
      { q: "raw" },
      { headers: {}, transport: "http" }
    );
    expect(seen).toEqual(["parse:raw", "before:parsed", "handler:parsed"]);
  });

  test("handler receives abortSignal from request", async () => {
    const controller = new AbortController();
    controller.abort();
    let aborted: boolean | undefined;

    const app = new Redop().tool("ping", {
      handler: async ({ signal }) => {
        aborted = signal.aborted;
        return { ok: true };
      },
    });

    await app._executeTool(
      "ping",
      {},
      { headers: {}, transport: "http", abortSignal: controller.signal }
    );
    expect(aborted).toBe(true);
  });

  test("local tool after throw fires onError but keeps client result", async () => {
    const errors: string[] = [];
    const app = new Redop()
      .onError(({ error }) => {
        errors.push(error instanceof Error ? error.message : String(error));
      })
      .tool("ping", {
        after: async () => {
          throw new Error("after-boom");
        },
        handler: async () => ({ ok: true }),
      });

    const execution = await app._executeTool(
      "ping",
      {},
      { headers: {}, transport: "http" }
    );
    expect(execution.ok).toBe(true);
    expect(errors).toContain("after-boom");
  });

  test("error hook throw is swallowed", async () => {
    const app = new Redop()
      .onError(() => {
        throw new Error("hook-boom");
      })
      .tool("ping", {
        handler: async () => {
          throw new Error("handler-boom");
        },
      });

    const execution = await app._executeTool(
      "ping",
      {},
      { headers: {}, transport: "http" }
    );
    expect(execution.ok).toBe(false);
  });

  test("stacked middleware() plugins run in registration order", async () => {
    const order: string[] = [];
    const first = middleware(async ({ next }) => {
      order.push("first");
      return next();
    });
    const second = middleware(async ({ next }) => {
      order.push("second");
      return next();
    });

    const app = new Redop()
      .use(first)
      .use(second)
      .tool("ping", {
        handler: async () => {
          order.push("handler");
          return { ok: true };
        },
      });

    await app._executeTool("ping", {}, { headers: {}, transport: "http" });
    expect(order).toEqual(["first", "second", "handler"]);
  });

  test("definePlugin can contribute tools via use", async () => {
    const plugin = definePlugin({
      name: "notes",
      version: "0.1.0",
      setup() {
        return new Redop().tool("notes.list", {
          handler: async () => ({ notes: [] }),
        });
      },
    });

    const app = new Redop().use(plugin({})).tool("root", {
      handler: async () => ({ ok: true }),
    });

    expect(app.toolNames).toContain("notes.list");
    expect(app.toolNames).toContain("root");
    expect(app.getTool("notes.list")).toBeDefined();
  });
});
