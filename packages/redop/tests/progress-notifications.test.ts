import { describe, expect, test } from "bun:test";

import { Redop } from "../src/index";

describe("progress notifications", () => {
  test("tool emit.progress invokes progressCallback", async () => {
    const progress: any[] = [];
    const app = new Redop().tool("slow", {
      handler: async ({ emit }) => {
        emit.progress(1, 10, "started");
        emit.progress(10, 10, "done");
        return { ok: true };
      },
    });

    const execution = await app._executeTool(
      "slow",
      {},
      {
        headers: {},
        transport: "http",
        progressCallback: (p) => progress.push(p),
      }
    );
    expect(execution.ok).toBe(true);
    expect(progress).toEqual([
      { progress: 1, total: 10, message: "started" },
      { progress: 10, total: 10, message: "done" },
    ]);
  });

  test("emit.progress without callback does not throw", async () => {
    const app = new Redop().tool("slow", {
      handler: async ({ emit }) => {
        emit.progress(1);
        return { ok: true };
      },
    });
    const execution = await app._executeTool("slow", {}, {
      headers: {},
      transport: "http",
    });
    expect(execution.ok).toBe(true);
  });

  test("resource and prompt middleware emit.progress also forward", async () => {
    const progress: any[] = [];
    const app = new Redop()
      .middleware(async ({ kind, emit, next }) => {
        if (kind === "resource") emit.progress(2, 5);
        if (kind === "prompt") emit.progress(3, 5, "prompting");
        return next();
      })
      .resource("progress://x", {
        name: "Progress",
        handler: async () => ({ type: "text", text: "x" }),
      })
      .prompt("draft", {
        handler: async () => [],
      });

    await app._executeResource("progress://x", {
      headers: {},
      transport: "http",
      progressCallback: (p) => progress.push({ kind: "resource", ...p }),
    });
    await app._executePrompt("draft", undefined, {
      headers: {},
      transport: "http",
      progressCallback: (p) => progress.push({ kind: "prompt", ...p }),
    });

    expect(progress).toEqual([
      { kind: "resource", progress: 2, total: 5, message: undefined },
      { kind: "prompt", progress: 3, total: 5, message: "prompting" },
    ]);
  });
});
