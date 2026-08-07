import { describe, expect, test } from "bun:test";

import { Redop } from "../src/index";

describe("after hook result replacement", () => {
  test("local after then global onAfterHandle can replace result", async () => {
    const app = new Redop()
      .onAfterHandle(async ({ result }) => ({
        ...(result as object),
        global: true,
      }))
      .tool("ping", {
        handler: async () => ({ base: true }),
        after: async ({ result }) => ({
          ...(result as object),
          local: true,
        }),
      });

    const execution = await app._executeTool(
      "ping",
      {},
      { headers: {}, transport: "http" }
    );
    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect(execution.result).toEqual({
        base: true,
        local: true,
        global: true,
      });
    }
  });

  test("thrown after hook fires onError but keeps prior result", async () => {
    const errors: string[] = [];
    const app = new Redop()
      .onError(async ({ error }) => {
        errors.push(error instanceof Error ? error.message : String(error));
      })
      .tool("ping", {
        handler: async () => ({ ok: true }),
        after: async () => {
          throw new Error("after boom");
        },
      });

    const execution = await app._executeTool(
      "ping",
      {},
      { headers: {}, transport: "http" }
    );
    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect(execution.result).toEqual({ ok: true });
    }
    expect(errors).toContain("after boom");
  });

  test("transform and parse hooks run before handler", async () => {
    const seen: string[] = [];
    const app = new Redop()
      .onTransform(async ({ params }) => {
        seen.push("transform");
        return { ...params, t: 1 };
      })
      .onParse(async ({ input }) => {
        seen.push("parse");
        return { ...(input as object), p: 2 };
      })
      .tool("ping", {
        handler: async ({ input }) => {
          seen.push("handler");
          return input;
        },
      });

    const execution = await app._executeTool(
      "ping",
      { raw: true },
      { headers: {}, transport: "http" }
    );
    expect(seen).toEqual(["transform", "parse", "handler"]);
    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect(execution.result).toEqual({ raw: true, t: 1, p: 2 });
    }
  });
});
