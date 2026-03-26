import { describe, expect, test } from "bun:test";

import { z } from "zod";

import type { RequestMeta } from "../src/index";
import {
  arktypeAdapter,
  jsonSchemaAdapter,
  middleware,
  Redop,
  typeboxAdapter,
  valibotAdapter,
} from "../src/index";

function expectType<T>(_value: T) {}

async function runTool(
  app: Redop,
  name: string,
  args: Record<string, unknown>,
  requestMeta: RequestMeta = {
    headers: {},
    transport: "stdio",
  }
) {
  return (
    app as unknown as {
      _runTool: (
        toolName: string,
        rawArgs: Record<string, unknown>,
        meta?: RequestMeta
      ) => Promise<unknown>;
    }
  )._runTool(name, args, requestMeta);
}

describe("Standard Schema adapter", () => {
  test("infers handler event input from Zod v4 output types", async () => {
    const app = new Redop().tool("typed_defaults", {
      handler: ({ input, request }) => {
        expectType<number>(input.limit);
        expectType<number>(input.page);
        expectType<string | undefined>(input.query);
        expectType<"stdio" | "http" | "ws">(request.transport);

        return input;
      },
      input: z.object({
        limit: z.number().default(10),
        page: z.coerce.number(),
        query: z.string().optional(),
      }),
    });

    expect(await runTool(app, "typed_defaults", { page: "2" })).toEqual({
      limit: 10,
      page: 2,
      query: undefined,
    });
  });

  test("uses Zod v4 JSON Schema generation for tool metadata", () => {
    const app = new Redop().tool("typed_defaults", {
      handler: ({ input }) => ({ limit: input.limit, page: input.page }),
      input: z.object({
        limit: z.number().default(10),
        page: z.coerce.number(),
      }),
    });

    expect(app.getTool("typed_defaults")?.inputSchema).toMatchObject({
      $schema: "http://json-schema.org/draft-07/schema#",
      properties: {
        limit: { default: 10, type: "number" },
        page: { type: "number" },
      },
      type: "object",
    });
  });

  test("preserves validation issues when parsing fails", async () => {
    const app = new Redop().tool("typed_defaults", {
      handler: ({ input }) => ({ page: input.page }),
      input: z.object({
        page: z.coerce.number(),
      }),
    });

    try {
      await runTool(app, "typed_defaults", { page: "oops" });
      throw new Error("Expected validation to fail");
    } catch (error) {
      const validationError = error as Error & {
        issues?: { message: string; path?: PropertyKey[] }[];
      };

      expect(validationError.message).toContain(
        'Validation failed for tool "typed_defaults"'
      );
      expect(validationError.issues?.[0]?.message).toContain("Invalid input");
      expect(validationError.issues?.[0]?.path).toEqual(["page"]);
    }
  });

  test("keeps plain JSON Schema tools working", async () => {
    const app = new Redop().tool("echo", {
      handler: ({ input }) => input.message,
      input: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
        required: ["message"],
      },
    });

    expect(await runTool(app, "echo", { message: "hello" })).toBe("hello");
  });

  test("exports a named JSON Schema adapter for explicit use", async () => {
    const app = new Redop({
      schemaAdapter: jsonSchemaAdapter(),
    }).tool("echo", {
      handler: ({ input }) => input.message,
      input: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
        required: ["message"],
      },
    });

    expect(await runTool(app, "echo", { message: "hello" })).toBe("hello");
  });

  test("exports named standard-schema aliases for valibot and arktype style usage", async () => {
    const valibotApp = new Redop({
      schemaAdapter: valibotAdapter(),
    }).tool("typed_defaults", {
      handler: ({ input }) => input.page,
      input: z.object({
        page: z.coerce.number(),
      }),
    });

    const arktypeApp = new Redop({
      schemaAdapter: arktypeAdapter(),
    }).tool("typed_defaults", {
      handler: ({ input }) => input.page,
      input: z.object({
        page: z.coerce.number(),
      }),
    });

    expect(await runTool(valibotApp, "typed_defaults", { page: "5" })).toBe(5);
    expect(await runTool(arktypeApp, "typed_defaults", { page: "6" })).toBe(6);
  });

  test("exports an explicit typebox adapter", async () => {
    const schema = {
      [Symbol.for("TypeBox.Kind")]: "Object",
      properties: {
        message: { type: "string" },
      },
      required: ["message"],
      type: "object",
    };

    const app = new Redop({
      schemaAdapter: typeboxAdapter(),
    }).tool("echo", {
      handler: ({ input }) => (input as { message: string }).message,
      input: schema,
    });

    expect(await runTool(app, "echo", { message: "hello" })).toBe("hello");
    expect(app.getTool("echo")?.inputSchema).toMatchObject(schema);
  });

  test("middleware can read typed input and request metadata", async () => {
    const seen: unknown[] = [];

    const app = new Redop()
      .use(
        middleware<{ page: number }>(async ({ input, request, next }) => {
          expectType<number>(input.page);
          seen.push({
            ip: request.ip,
            page: input.page,
            url: request.url,
          });
          return next();
        })
      )
      .tool("typed_defaults", {
        handler: ({ input, request }) => ({
          page: input.page,
          ip: request.ip,
          hasRaw: request.raw instanceof Request,
        }),
        input: z.object({
          page: z.coerce.number(),
        }),
      });

    expect(
      await runTool(
        app,
        "typed_defaults",
        { page: "3" },
        {
          headers: { authorization: "Bearer dev-secret" },
          ip: "127.0.0.1",
          method: "POST",
          raw: new Request("http://localhost:3000/mcp", { method: "POST" }),
          transport: "http",
          url: "http://localhost:3000/mcp",
        }
      )
    ).toEqual({
      hasRaw: true,
      ip: "127.0.0.1",
      page: 3,
    });

    expect(seen).toEqual([
      {
        ip: "127.0.0.1",
        page: 3,
        url: "http://localhost:3000/mcp",
      },
    ]);
  });

  test("tool-local before and after hooks are typed and ordered around the handler", async () => {
    const order: string[] = [];

    const app = new Redop()
      .onBeforeHandle(() => {
        order.push("global-before");
      })
      .onAfterHandle(() => {
        order.push("global-after");
      })
      .use(
        middleware<{ page: number }>(async ({ next }) => {
          order.push("middleware");
          return next();
        })
      )
      .tool("typed_defaults", {
        after: ({ input, result, request }) => {
          expectType<number>(input.page);
          expectType<number>(result.page);
          expectType<boolean>(result.ok);
          expectType<"stdio" | "http" | "ws">(request.transport);
          order.push("tool-after");
        },
        before: ({ input, request }) => {
          expectType<number>(input.page);
          expectType<"stdio" | "http" | "ws">(request.transport);
          order.push("tool-before");
        },
        handler: ({ input }) => {
          order.push("handler");
          return { page: input.page, ok: true };
        },
        input: z.object({
          page: z.coerce.number(),
        }),
      });

    expect(await runTool(app, "typed_defaults", { page: "4" })).toEqual({
      ok: true,
      page: 4,
    });

    expect(order).toEqual([
      "global-before",
      "tool-before",
      "middleware",
      "handler",
      "tool-after",
      "global-after",
    ]);
  });

  test("tool-local after does not run when middleware or handler fails", async () => {
    const seen: string[] = [];

    const failingHandler = new Redop().tool("boom_handler", {
      after: () => {
        seen.push("handler-after");
      },
      before: () => {
        seen.push("handler-before");
      },
      handler: () => {
        seen.push("handler");
        throw new Error("handler failed");
      },
    });

    await expect(runTool(failingHandler, "boom_handler", {})).rejects.toThrow(
      "handler failed"
    );
    expect(seen).toEqual(["handler-before", "handler"]);

    seen.length = 0;

    const failingMiddleware = new Redop()
      .use(
        middleware(async () => {
          seen.push("middleware");
          throw new Error("middleware failed");
        })
      )
      .tool("boom_middleware", {
        after: () => {
          seen.push("middleware-after");
        },
        before: () => {
          seen.push("middleware-before");
        },
        handler: () => {
          seen.push("middleware-handler");
          return { ok: true };
        },
      });

    await expect(
      runTool(failingMiddleware, "boom_middleware", {})
    ).rejects.toThrow("middleware failed");
    expect(seen).toEqual(["middleware-before", "middleware"]);
  });
});
