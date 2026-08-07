import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { Redop } from "../src/index";
import { callHandler } from "./helpers";

describe("prompt arguments", () => {
  test("required arguments missing multiple names", async () => {
    const app = new Redop().prompt("draft", {
      arguments: [
        { name: "title", required: true },
        { name: "tone", required: true },
      ],
      handler: async () => [],
    });
    expect(() =>
      app._executePrompt("draft", {}, { headers: {}, transport: "http" })
    ).toThrow(/title, tone/);
  });

  test("optional arguments omitted succeed", async () => {
    const app = new Redop().prompt("draft", {
      arguments: [
        { name: "title", required: true },
        { name: "tone", required: false },
      ],
      handler: async ({ arguments: args }) => [
        {
          role: "user",
          content: {
            type: "text",
            text: `${args.title}${args.tone ? `:${args.tone}` : ""}`,
          },
        },
      ],
    });
    const execution = await app._executePrompt(
      "draft",
      { title: "Hello" },
      { headers: {}, transport: "http" }
    );
    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect(execution.result[0]).toMatchObject({
        content: { text: "Hello" },
      });
    }
  });

  test("argumentsSchema rejects invalid values", async () => {
    const app = new Redop().prompt("draft", {
      argumentsSchema: z.object({ count: z.number().int().positive() }),
      handler: async () => [],
    });
    const execution = await app._executePrompt(
      "draft",
      { count: -1 },
      { headers: {}, transport: "http" }
    );
    expect(execution.ok).toBe(false);
  });

  test("explicit arguments override schema-derived metadata when both set", async () => {
    const app = new Redop({
      serverInfo: { name: "prompt-meta", version: "0.1.0" },
    }).prompt("draft", {
      arguments: [{ name: "title", required: true, description: "Explicit" }],
      argumentsSchema: z.object({
        title: z.string(),
        extra: z.string().optional(),
      }),
      handler: async () => [],
    });

    const { body } = await callHandler(app, "prompts/list");
    const prompt = body.result.prompts.find((p: any) => p.name === "draft");
    expect(prompt.arguments).toEqual([
      { name: "title", required: true, description: "Explicit" },
    ]);
  });

  test("prompts/get over HTTP surfaces validation as RPC error", async () => {
    const app = new Redop({
      serverInfo: { name: "prompt-http", version: "0.1.0" },
    }).prompt("draft", {
      arguments: [{ name: "title", required: true }],
      handler: async () => [],
    });

    const { response, body } = await callHandler(app, "prompts/get", {
      name: "draft",
      args: {},
    });
    expect(response.status).toBe(200);
    expect(body.error).toBeDefined();
    expect(body.error.message).toMatch(/title|required|Validation|argument/i);
  });
});
