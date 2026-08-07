import { describe, expect, test } from "bun:test";
import { z } from "zod";

import {
  detectAdapter,
  jsonSchemaAdapter,
  typeboxAdapter,
} from "../src/adapters/schema";
import { Redop } from "../src/index";
import { callHandler } from "./helpers";

describe("schema adapters", () => {
  test("detectAdapter chooses Standard Schema for Zod", () => {
    const adapter = detectAdapter(z.object({ n: z.number() }));
    expect(typeof adapter.parse).toBe("function");
    expect(typeof adapter.toJsonSchema).toBe("function");
  });

  test("detectAdapter chooses TypeBox via Kind symbol", () => {
    const schema = {
      [Symbol.for("TypeBox.Kind")]: "Object",
      type: "object",
      properties: { id: { type: "string" } },
    };
    const adapter = detectAdapter(schema);
    expect(adapter.toJsonSchema(schema)).toEqual(schema);
  });

  test("detectAdapter chooses plain JSON Schema", () => {
    const schema = {
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
    };
    expect(detectAdapter(schema).toJsonSchema(schema)).toEqual(schema);
  });

  test("detectAdapter throws for unknown shapes", () => {
    expect(() => detectAdapter(42)).toThrow(/Could not detect schema type/);
    expect(() => detectAdapter("nope")).toThrow(/Could not detect schema type/);
    expect(() => detectAdapter({ foo: true })).toThrow(
      /Could not detect schema type/
    );
  });

  test("Zod inputSchema exposes JSON Schema on tools/list", async () => {
    const app = new Redop({
      serverInfo: { name: "schema-zod", version: "0.1.0" },
    }).tool("echo", {
      inputSchema: z.object({
        q: z.string().min(1),
      }),
      handler: async ({ input }) => input,
    });

    const { body } = await callHandler(app, "tools/list");
    const tool = body.result.tools.find((t: any) => t.name === "echo");
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.properties.q).toBeDefined();
  });

  test("JSON Schema tool passes input through without validation", async () => {
    const app = new Redop({
      serverInfo: { name: "schema-json", version: "0.1.0" },
    }).tool("passthrough", {
      inputSchema: {
        type: "object",
        properties: { n: { type: "number" } },
        required: ["n"],
      },
      handler: async ({ input }) => input,
    });

    const execution = await app._executeTool(
      "passthrough",
      { n: "not-a-number", extra: true },
      { headers: {}, transport: "http" }
    );
    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect(execution.result).toEqual({ n: "not-a-number", extra: true });
    }
  });

  test("jsonSchemaAdapter toJsonSchema returns the schema", () => {
    const schema = { type: "string" };
    expect(jsonSchemaAdapter().toJsonSchema(schema)).toEqual(schema);
  });

  test("typeboxAdapter falls through when Value import is unavailable", async () => {
    const schema = {
      [Symbol.for("TypeBox.Kind")]: "Object",
      type: "object",
    };
    const parsed = await typeboxAdapter().parse(schema, { ok: true });
    expect(parsed).toEqual({ ok: true });
  });

  test("Standard Schema without jsonSchema fails at registration", () => {
    const fake = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
      },
    };

    expect(() =>
      new Redop().tool("broken", {
        inputSchema: fake as any,
        handler: async () => ({}),
      })
    ).toThrow(/JSON Schema generation/);
  });

  test("outputSchema is converted onto listed tool metadata", async () => {
    const app = new Redop({
      serverInfo: { name: "schema-out", version: "0.1.0" },
    }).tool("out", {
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      handler: async () => ({ ok: true }),
    });

    const { body } = await callHandler(app, "tools/list");
    const tool = body.result.tools.find((t: any) => t.name === "out");
    expect(tool.outputSchema?.properties?.ok).toBeDefined();
  });

  test("prompt argumentsSchema generates arguments metadata", async () => {
    const app = new Redop({
      serverInfo: { name: "schema-prompt", version: "0.1.0" },
    }).prompt("greet", {
      argumentsSchema: z.object({
        name: z.string(),
        shout: z.boolean().optional(),
      }),
      handler: async ({ arguments: args }) => [
        {
          role: "user",
          content: { type: "text", text: String(args.name) },
        },
      ],
    });

    const { body } = await callHandler(app, "prompts/list");
    const prompt = body.result.prompts.find((p: any) => p.name === "greet");
    expect(prompt.arguments.some((a: any) => a.name === "name" && a.required)).toBe(
      true
    );
  });

  test("prompt argumentsSchema validation failure wraps prompt name", async () => {
    const app = new Redop().prompt("greet", {
      argumentsSchema: z.object({ name: z.string().min(2) }),
      handler: async () => [],
    });

    const execution = await app._executePrompt(
      "greet",
      { name: "a" },
      { headers: {}, transport: "http" }
    );
    expect(execution.ok).toBe(false);
    if (!execution.ok) {
      expect(String(execution.error)).toContain("greet");
    }
  });
});
