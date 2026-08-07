import { createServer } from "node:net";
import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { apiKey, definePlugin, middleware, Redop } from "../src/index";
import { startHttpTransport } from "../src/transports/http";

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not determine free port"));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function postJsonRpc(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2025-03-26",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...body,
    }),
  });

  return {
    body: (await response.json()) as Record<string, any>,
    response,
  };
}

describe("Redop registration validation", () => {
  test("rejects invalid tool names", () => {
    const app = new Redop();

    expect(() =>
      app.tool("bad name!", {
        handler: () => ({ ok: true }),
      })
    ).toThrow(
      '[redop] tool name "bad name!" may only contain letters, numbers, underscores (_), dashes (-), dots (.), and forward slashes (/).'
    );
  });

  test("rejects duplicate prompt names", () => {
    const app = new Redop();

    app.prompt("code_review", {
      handler: () => [],
    });

    expect(() =>
      app.prompt("code_review", {
        handler: () => [],
      })
    ).toThrow('[redop] prompt "code_review" is already registered.');
  });

  test("rejects invalid resource URIs", () => {
    const app = new Redop();

    expect(() =>
      app.resource("users://{id/profile", {
        name: "User profile",
        handler: async () => ({
          type: "text",
          text: "{}",
        }),
      })
    ).toThrow(
      '[redop] resource URI template "users://{id/profile" contains an unmatched opening brace.'
    );
  });
});

describe("Redop request-time validation", () => {
  test("wraps input schema parsing failures with the tool name", async () => {
    const app = new Redop().tool("search_docs", {
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      handler: ({ input }) => input,
    });

    await expect(
      app._runTool("search_docs", {}, {
        headers: {},
        transport: "stdio",
      })
    ).rejects.toThrow('Validation failed for "search_docs"');
  });

  test("rejects prompt calls that omit required arguments", async () => {
    const app = new Redop().prompt("summarise", {
      arguments: [{ name: "text", required: true }],
      handler: ({ arguments: args }) => [
        {
          role: "user",
          content: {
            type: "text",
            text: args.text,
          },
        },
      ],
    });

    await expect(
      app._getPrompt("summarise", undefined, {
        headers: {},
        transport: "stdio",
      })
    ).rejects.toThrow(
      '[redop] prompt "summarise" is missing required argument: text.'
    );
  });

  test("parses prompt arguments with argumentsSchema", async () => {
    const app = new Redop().prompt("summarise", {
      argumentsSchema: z.object({
        limit: z.coerce.number().int().min(1),
        topic: z.string().min(1),
      }),
      handler: ({ arguments: args }) => [
        {
          role: "user",
          content: {
            type: "text",
            text: `${args.topic}:${args.limit}`,
          },
        },
      ],
    });

    await expect(
      app._getPrompt(
        "summarise",
        {
          limit: "2",
          topic: "bugs",
        },
        {
          headers: {},
          transport: "stdio",
        }
      )
    ).resolves.toEqual([
      {
        role: "user",
        content: {
          type: "text",
          text: "bugs:2",
        },
      },
    ]);
  });
});

describe("Redop resource and prompt lifecycle", () => {
  test("widens host context types from plugin middleware", async () => {
    const tenantPlugin = definePlugin<{}, { tenantId: string }>({
      name: "tenant",
      version: "0.1.0",
      setup() {
        return new Redop<{ tenantId: string }>().middleware(
          async ({ ctx, next }) => {
            ctx.tenantId = "acme";
            return next();
          }
        );
      },
    });

    const app = new Redop()
      .use(tenantPlugin({}))
      .tool("whoami", {
        handler: ({ ctx }) => ({
          tenantId: ctx.tenantId,
        }),
      });

    await expect(
      app._runTool("whoami", {}, {
        headers: {},
        transport: "stdio",
      })
    ).resolves.toEqual({
      tenantId: "acme",
    });
  });

  test("merges plugin derive functions into the host app", async () => {
    const derivePlugin = definePlugin<{}, { workspaceId: string }>({
      name: "workspace",
      version: "0.1.0",
      setup() {
        return new Redop<{ workspaceId: string }>().derive(({ request }) => ({
          workspaceId: request.headers["x-workspace-id"] ?? "default",
        }));
      },
    });

    const app = new Redop()
      .use(derivePlugin({}))
      .tool("workspace.current", {
        handler: ({ ctx }) => ({
          workspaceId: ctx.workspaceId,
        }),
      });

    await expect(
      app._runTool("workspace.current", {}, {
        headers: {
          "x-workspace-id": "ws_123",
        },
        transport: "http",
      })
    ).resolves.toEqual({
      workspaceId: "ws_123",
    });
  });

  test("runs global middleware for tools, resources, and prompts", async () => {
    const calls: string[] = [];

    const app = new Redop()
      .middleware(async ({ kind, name, next }) => {
        calls.push(`global.start:${kind}:${name}`);
        const result = await next();
        calls.push(`global.end:${kind}:${name}`);
        return result;
      })
      .tool("search", {
        handler: async () => {
          calls.push("handler:tool");
          return { ok: true };
        },
      })
      .resource("config://server", {
        name: "Server config",
        handler: async () => {
          calls.push("handler:resource");
          return { type: "text", text: "resource-body" };
        },
      })
      .prompt("summarise", {
        handler: async () => {
          calls.push("handler:prompt");
          return [
            {
              role: "user",
              content: {
                type: "text",
                text: "prompt-body",
              },
            },
          ];
        },
      });

    await app._runTool("search", {}, {
      headers: {},
      transport: "stdio",
    });
    await app._readResource("config://server", {
      headers: {},
      transport: "stdio",
    });
    await app._getPrompt("summarise", undefined, {
      headers: {},
      transport: "stdio",
    });

    expect(calls).toEqual([
      "global.start:tool:search",
      "handler:tool",
      "global.end:tool:search",
      "global.start:resource:config://server",
      "handler:resource",
      "global.end:resource:config://server",
      "global.start:prompt:summarise",
      "handler:prompt",
      "global.end:prompt:summarise",
    ]);
  });

  test("runs resource middleware and hooks in order", async () => {
    const calls: string[] = [];

    const app = new Redop()
      .onBeforeHandle(({ ctx, tool }) => {
        expect(typeof ctx.requestId).toBe("string");
        expect(tool).toBe("config://server");
        calls.push("global.before");
      })
      .onAfterHandle(({ tool }) => {
        expect(tool).toBe("config://server");
        calls.push("global.after");
      })
      .resource("config://server", {
        name: "Server config",
        before: () => {
          calls.push("local.before");
        },
        middleware: [
          async ({ next }) => {
            calls.push("middleware.start");
            const result = await next();
            calls.push("middleware.end");
            return result;
          },
        ],
        after: ({ result }) => {
          calls.push("local.after");
          return result;
        },
        handler: async () => {
          calls.push("handler");
          return { type: "text", text: "ok" };
        },
      });

    const result = await app._readResource("config://server", {
      headers: {},
      transport: "stdio",
    });

    expect(result).toEqual({ type: "text", text: "ok" });
    expect(calls).toEqual([
      "global.before",
      "local.before",
      "middleware.start",
      "handler",
      "middleware.end",
      "local.after",
      "global.after",
    ]);
  });

  test("runs prompt middleware and hooks in order", async () => {
    const calls: string[] = [];

    const app = new Redop()
      .onBeforeHandle(({ ctx, tool }) => {
        expect(typeof ctx.requestId).toBe("string");
        expect(tool).toBe("summarise");
        calls.push("global.before");
      })
      .onAfterHandle(({ tool }) => {
        expect(tool).toBe("summarise");
        calls.push("global.after");
      })
      .prompt("summarise", {
        before: () => {
          calls.push("local.before");
        },
        middleware: [
          async ({ next }) => {
            calls.push("middleware.start");
            const result = await next();
            calls.push("middleware.end");
            return result;
          },
        ],
        after: ({ result }) => {
          calls.push("local.after");
          return result;
        },
        handler: async () => {
          calls.push("handler");
          return [
            {
              role: "user",
              content: {
                type: "text",
                text: "summarise",
              },
            },
          ];
        },
      });

    const result = await app._getPrompt("summarise", undefined, {
      headers: {},
      transport: "stdio",
    });

    expect(result).toHaveLength(1);
    expect(calls).toEqual([
      "global.before",
      "local.before",
      "middleware.start",
      "handler",
      "middleware.end",
      "local.after",
      "global.after",
    ]);
  });

  test("fires existing global error hooks for resources and prompts", async () => {
    const errors: string[] = [];

    const app = new Redop()
      .onError(({ error, tool }) => {
        errors.push(
          `${tool}:${error instanceof Error ? error.message : String(error)}`
        );
      })
      .resource("config://broken", {
        name: "Broken resource",
        handler: async () => {
          throw new Error("resource blew up");
        },
      })
      .prompt("broken_prompt", {
        handler: async () => {
          throw new Error("prompt blew up");
        },
      });

    await expect(
      app._readResource("config://broken", {
        headers: {},
        transport: "stdio",
      })
    ).rejects.toThrow("resource blew up");
    await expect(
      app._getPrompt("broken_prompt", undefined, {
        headers: {},
        transport: "stdio",
      })
    ).rejects.toThrow("prompt blew up");

    expect(errors).toEqual([
      "config://broken:resource blew up",
      "broken_prompt:prompt blew up",
    ]);
  });

  test("fires existing global hooks for resources and prompts too", async () => {
    const beforeCalls: string[] = [];
    const afterCalls: string[] = [];

    const app = new Redop()
      .onBeforeHandle(({ tool }) => {
        beforeCalls.push(tool);
      })
      .onAfterHandle(({ tool }) => {
        afterCalls.push(tool);
      })
      .resource("config://server", {
        name: "Server config",
        handler: async () => ({ type: "text", text: "ok" }),
      })
      .prompt("summarise", {
        handler: async () => [
          {
            role: "user",
            content: { type: "text", text: "summarise" },
          },
        ],
      });

    await app._readResource("config://server", {
      headers: {},
      transport: "stdio",
    });
    await app._getPrompt("summarise", undefined, {
      headers: {},
      transport: "stdio",
    });

    expect(beforeCalls).toEqual(["config://server", "summarise"]);
    expect(afterCalls).toEqual(["config://server", "summarise"]);
  });

  test("runs global after hooks after resource and prompt handlers resolve", async () => {
    const calls: string[] = [];

    const app = new Redop()
      .onAfterHandle(({ tool, result }) => {
        calls.push(`after:${tool}`);

        if (tool === "config://server") {
          expect(result).toEqual({ type: "text", text: "resource-result" });
          return { type: "text", text: "resource-after-result" };
        }

        if (tool === "summarise") {
          expect(result).toEqual([
            {
              role: "user",
              content: { type: "text", text: "prompt-result" },
            },
          ]);
          return [
            {
              role: "assistant",
              content: { type: "text", text: "prompt-after-result" },
            },
          ];
        }
      })
      .resource("config://server", {
        name: "Server config",
        handler: async () => {
          calls.push("handler:resource");
          return { type: "text", text: "resource-result" };
        },
      })
      .prompt("summarise", {
        handler: async () => {
          calls.push("handler:prompt");
          return [
            {
              role: "user",
              content: { type: "text", text: "prompt-result" },
            },
          ];
        },
      });

    const resourceResult = await app._readResource("config://server", {
      headers: {},
      transport: "stdio",
    });
    const promptResult = await app._getPrompt("summarise", undefined, {
      headers: {},
      transport: "stdio",
    });

    expect(calls).toEqual([
      "handler:resource",
      "after:config://server",
      "handler:prompt",
      "after:summarise",
    ]);
    expect(resourceResult).toEqual({
      type: "text",
      text: "resource-after-result",
    });
    expect(promptResult).toEqual([
      {
        role: "assistant",
        content: { type: "text", text: "prompt-after-result" },
      },
    ]);
  });

  test("defers afterResponse for tools, resources, and prompts until it is invoked", async () => {
    const calls: string[] = [];

    const app = new Redop()
      .onAfterResponse(({ kind, name, result }) => {
        calls.push(`global:${kind}:${name}`);
        expect(result).toBeDefined();
      })
      .tool("search", {
        afterResponse: ({ result, tool }) => {
          calls.push(`local:tool:${tool}`);
          expect(result).toEqual({ hits: ["doc-1"] });
        },
        handler: async () => {
          calls.push("handler:tool");
          return { hits: ["doc-1"] };
        },
      })
      .resource("config://server", {
        name: "Server config",
        afterResponse: ({ result, uri }) => {
          calls.push(`local:resource:${uri}`);
          expect(result).toEqual({ type: "text", text: "resource-body" });
        },
        handler: async () => {
          calls.push("handler:resource");
          return { type: "text", text: "resource-body" };
        },
      })
      .prompt("summarise", {
        afterResponse: ({ result, name }) => {
          calls.push(`local:prompt:${name}`);
          expect(result).toEqual([
            {
              role: "user",
              content: { type: "text", text: "prompt-body" },
            },
          ]);
        },
        handler: async () => {
          calls.push("handler:prompt");
          return [
            {
              role: "user",
              content: { type: "text", text: "prompt-body" },
            },
          ];
        },
      });

    const toolExecution = await app._executeTool("search", {}, {
      headers: {},
      transport: "stdio",
    });
    const resourceExecution = await app._executeResource("config://server", {
      headers: {},
      transport: "stdio",
    });
    const promptExecution = await app._executePrompt("summarise", undefined, {
      headers: {},
      transport: "stdio",
    });

    expect(toolExecution.ok).toBe(true);
    expect(resourceExecution.ok).toBe(true);
    expect(promptExecution.ok).toBe(true);
    expect(calls).toEqual([
      "handler:tool",
      "handler:resource",
      "handler:prompt",
    ]);

    await toolExecution.afterResponse();
    await resourceExecution.afterResponse();
    await promptExecution.afterResponse();

    expect(calls).toEqual([
      "handler:tool",
      "handler:resource",
      "handler:prompt",
      "local:tool:search",
      "global:tool:search",
      "local:resource:config://server",
      "global:resource:config://server",
      "local:prompt:summarise",
      "global:prompt:summarise",
    ]);
  });

  test("runs afterResponse hooks for tool failures too", async () => {
    const calls: string[] = [];

    const app = new Redop()
      .onAfterResponse(({ kind, name, error, result }) => {
        calls.push(`global:${kind}:${name}`);
        expect(error).toBeInstanceOf(Error);
        expect(result).toBeUndefined();
      })
      .tool("search", {
        afterResponse: ({ error, result, tool }) => {
          calls.push(`local:${tool}`);
          expect(error).toBeInstanceOf(Error);
          expect(result).toBeUndefined();
        },
        handler: async () => {
          calls.push("handler");
          throw new Error("search failed");
        },
      });

    const execution = await app._executeTool("search", {}, {
      headers: {},
      transport: "stdio",
    });

    expect(execution.ok).toBe(false);
    expect(calls).toEqual(["handler"]);

    await execution.afterResponse();

    expect(calls).toEqual(["handler", "local:search", "global:tool:search"]);
  });

  test("keeps initialize and list unauthenticated while auth protects execution", async () => {
    const app = new Redop({
      serverInfo: {
        name: "auth-http-test",
        version: "0.1.0",
      },
    })
      .use(
        apiKey({
          key: "dev-secret",
        })
      )
      .tool("private_tool", {
        handler: async () => ({ ok: true }),
      })
      .resource("config://private", {
        name: "Private config",
        handler: async () => ({ type: "text", text: "resource-body" }),
      })
      .prompt("private_prompt", {
        handler: async () => [
          {
            role: "user",
            content: { type: "text", text: "prompt-body" },
          },
        ],
      });

    const port = await getFreePort();
    const transport = startHttpTransport(
      (app as any)._tools,
      (app as any)._resources,
      (app as any)._prompts,
      (name, args, meta) => app._executeTool(name, args, meta),
      (uri, meta) => app._executeResource(uri, meta),
      (name, args, meta) => app._executePrompt(name, args, meta),
      (uri, sid) => app._subscribeResource(uri, sid),
      (uri, sid) => app._unsubscribeResource(uri, sid),
      {
        hostname: "127.0.0.1",
        port,
      },
      app.serverInfo as any,
      (app as any)._resolvedCapabilities()
    );

    try {
      const url = `http://127.0.0.1:${port}/mcp`;

      const init = await postJsonRpc(url, {
        id: 1,
        method: "initialize",
        params: {},
      });
      const sessionId = init.response.headers.get("mcp-session-id");

      expect(init.response.status).toBe(200);
      expect(sessionId).toBeTruthy();
      expect(init.body.result.serverInfo.name).toBe("auth-http-test");

      const toolList = await postJsonRpc(
        url,
        {
          id: 2,
          method: "tools/list",
          params: {},
        },
        {
          "mcp-session-id": sessionId!,
        }
      );
      expect(
        toolList.body.result.tools.map((tool: { name: string }) => tool.name)
      ).toContain("private_tool");

      const resourceList = await postJsonRpc(
        url,
        {
          id: 3,
          method: "resources/list",
          params: {},
        },
        {
          "mcp-session-id": sessionId!,
        }
      );
      expect(
        resourceList.body.result.resources.map(
          (resource: { uri: string }) => resource.uri
        )
      ).toContain("config://private");

      const promptList = await postJsonRpc(
        url,
        {
          id: 4,
          method: "prompts/list",
          params: {},
        },
        {
          "mcp-session-id": sessionId!,
        }
      );
      expect(
        promptList.body.result.prompts.map(
          (prompt: { name: string }) => prompt.name
        )
      ).toContain("private_prompt");

      const deniedToolCall = await postJsonRpc(
        url,
        {
          id: 5,
          method: "tools/call",
          params: { name: "private_tool", arguments: {} },
        },
        {
          "mcp-session-id": sessionId!,
        }
      );
      expect(deniedToolCall.body.result.isError).toBe(true);
      expect(deniedToolCall.body.result.content[0].text).toContain(
        "Unauthorized"
      );

      const deniedResourceRead = await postJsonRpc(
        url,
        {
          id: 6,
          method: "resources/read",
          params: { uri: "config://private" },
        },
        {
          "mcp-session-id": sessionId!,
        }
      );
      expect(deniedResourceRead.body.error.message).toContain("Unauthorized");

      const deniedPromptGet = await postJsonRpc(
        url,
        {
          id: 7,
          method: "prompts/get",
          params: { name: "private_prompt" },
        },
        {
          "mcp-session-id": sessionId!,
        }
      );
      expect(deniedPromptGet.body.error.message).toContain("Unauthorized");

      const allowedToolCall = await postJsonRpc(
        url,
        {
          id: 8,
          method: "tools/call",
          params: { name: "private_tool", arguments: {} },
        },
        {
          "mcp-session-id": sessionId!,
          "x-api-key": "dev-secret",
        }
      );
      expect(allowedToolCall.body.result.isError).toBeUndefined();
      expect(allowedToolCall.body.result.content[0].text).toContain('"ok":true');

      const allowedResourceRead = await postJsonRpc(
        url,
        {
          id: 9,
          method: "resources/read",
          params: { uri: "config://private" },
        },
        {
          "mcp-session-id": sessionId!,
          "x-api-key": "dev-secret",
        }
      );
      expect(allowedResourceRead.body.result.contents[0].text).toBe(
        "resource-body"
      );

      const allowedPromptGet = await postJsonRpc(
        url,
        {
          id: 10,
          method: "prompts/get",
          params: { name: "private_prompt" },
        },
        {
          "mcp-session-id": sessionId!,
          "x-api-key": "dev-secret",
        }
      );
      expect(allowedPromptGet.body.result.messages[0].content.text).toBe(
        "prompt-body"
      );
    } finally {
      transport.stop();
    }
  });
});
