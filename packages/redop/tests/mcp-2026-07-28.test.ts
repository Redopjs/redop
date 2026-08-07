import { createServer } from "node:net";
import { describe, expect, test } from "bun:test";

import {
  META_CLIENT_CAPABILITIES,
  META_PROTOCOL_VERSION,
  PROTOCOL_LATEST,
  requireInput,
  TASKS_EXTENSION_ID,
} from "../src/transports/protocol";
import { Redop } from "../src/index";
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
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      ...body,
    }),
  });

  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return {
    response,
    body: parsed,
  };
}

function startTestServer(app: Redop) {
  return getFreePort().then((port) => {
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
    return { port, transport, url: `http://127.0.0.1:${port}/mcp` };
  });
}

describe("MCP 2026-07-28 transport", () => {
  test("server/discover works without a session", async () => {
    const app = new Redop({
      serverInfo: { name: "discover-test", version: "0.1.0" },
    }).tool("echo", {
      handler: async ({ input }) => input,
    });

    const { transport, url } = await startTestServer(app);
    try {
      const res = await postJsonRpc(
        url,
        {
          id: 1,
          method: "server/discover",
          params: {
            _meta: {
              [META_PROTOCOL_VERSION]: PROTOCOL_LATEST,
            },
          },
        },
        {
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "server/discover",
        }
      );

      expect(res.response.status).toBe(200);
      expect(res.response.headers.get("mcp-session-id")).toBeNull();
      expect(res.body.result.supportedVersions).toContain(PROTOCOL_LATEST);
      expect(res.body.result.capabilities.extensions[TASKS_EXTENSION_ID]).toEqual(
        {}
      );
      expect(res.body.result.ttlMs).toBeGreaterThan(0);
      expect(res.body.result.cacheScope).toBe("public");
      expect(res.body.result.resultType).toBe("complete");
    } finally {
      transport.stop();
    }
  });

  test("stateless tools/list requires Mcp-Method and returns cache hints", async () => {
    const app = new Redop({
      serverInfo: { name: "list-test", version: "0.1.0" },
    }).tool("echo", {
      handler: async () => ({ ok: true }),
    });

    const { transport, url } = await startTestServer(app);
    try {
      const missing = await postJsonRpc(
        url,
        {
          id: 1,
          method: "tools/list",
          params: {
            _meta: { [META_PROTOCOL_VERSION]: PROTOCOL_LATEST },
          },
        },
        { "mcp-protocol-version": PROTOCOL_LATEST }
      );
      expect(missing.response.status).toBe(400);
      expect(missing.body.error.code).toBe(-32_020);

      const ok = await postJsonRpc(
        url,
        {
          id: 2,
          method: "tools/list",
          params: {
            _meta: { [META_PROTOCOL_VERSION]: PROTOCOL_LATEST },
          },
        },
        {
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "tools/list",
        }
      );
      expect(ok.response.status).toBe(200);
      expect(ok.response.headers.get("mcp-session-id")).toBeNull();
      expect(ok.body.result.tools.map((t: { name: string }) => t.name)).toContain(
        "echo"
      );
      expect(ok.body.result.ttlMs).toBe(60_000);
      expect(ok.body.result.cacheScope).toBe("public");
      expect(ok.body.result.resultType).toBe("complete");
    } finally {
      transport.stop();
    }
  });

  test("tools/call validates Mcp-Name and supports MRTR requireInput", async () => {
    const app = new Redop({
      serverInfo: { name: "mrtr-test", version: "0.1.0" },
    }).tool("confirm_delete", {
      handler: async ({ request }) => {
        if (!request.inputResponses?.confirm) {
          requireInput({
            inputRequests: {
              confirm: {
                method: "elicitation/create",
                params: {
                  mode: "form",
                  message: "Confirm delete?",
                  requestedSchema: {
                    type: "object",
                    properties: { confirm: { type: "boolean" } },
                    required: ["confirm"],
                  },
                },
              },
            },
            requestState: "delete-state",
          });
        }
        return { deleted: true };
      },
    });

    const { transport, url } = await startTestServer(app);
    try {
      const mismatch = await postJsonRpc(
        url,
        {
          id: 1,
          method: "tools/call",
          params: {
            name: "confirm_delete",
            arguments: {},
            _meta: { [META_PROTOCOL_VERSION]: PROTOCOL_LATEST },
          },
        },
        {
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "tools/call",
          "mcp-name": "other_tool",
        }
      );
      expect(mismatch.response.status).toBe(400);
      expect(mismatch.body.error.code).toBe(-32_020);

      const needsInput = await postJsonRpc(
        url,
        {
          id: 2,
          method: "tools/call",
          params: {
            name: "confirm_delete",
            arguments: {},
            _meta: { [META_PROTOCOL_VERSION]: PROTOCOL_LATEST },
          },
        },
        {
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "tools/call",
          "mcp-name": "confirm_delete",
        }
      );
      expect(needsInput.response.status).toBe(200);
      expect(needsInput.body.result.resultType).toBe("input_required");
      expect(needsInput.body.result.requestState).toBe("delete-state");
      expect(needsInput.body.result.inputRequests.confirm.method).toBe(
        "elicitation/create"
      );

      const done = await postJsonRpc(
        url,
        {
          id: 3,
          method: "tools/call",
          params: {
            name: "confirm_delete",
            arguments: {},
            inputResponses: {
              confirm: { action: "accept", content: { confirm: true } },
            },
            requestState: "delete-state",
            _meta: { [META_PROTOCOL_VERSION]: PROTOCOL_LATEST },
          },
        },
        {
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "tools/call",
          "mcp-name": "confirm_delete",
        }
      );
      expect(done.response.status).toBe(200);
      expect(done.body.result.resultType).toBe("complete");
      expect(done.body.result.content[0].text).toContain("deleted");
    } finally {
      transport.stop();
    }
  });

  test("tasks/update is available under the tasks extension", async () => {
    const app = new Redop({
      serverInfo: { name: "tasks-test", version: "0.1.0" },
    }).tool("slow", {
      taskSupport: "required",
      handler: async () => {
        await Bun.sleep(50);
        return { ok: true };
      },
    });

    const { transport, url } = await startTestServer(app);
    try {
      const call = await postJsonRpc(
        url,
        {
          id: 1,
          method: "tools/call",
          params: {
            name: "slow",
            arguments: {},
            _meta: {
              [META_PROTOCOL_VERSION]: PROTOCOL_LATEST,
              [META_CLIENT_CAPABILITIES]: {
                extensions: { [TASKS_EXTENSION_ID]: {} },
              },
            },
          },
        },
        {
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "tools/call",
          "mcp-name": "slow",
        }
      );
      expect(call.body.result.resultType).toBe("task");
      const taskId = call.body.result.task.taskId as string;
      expect(taskId).toBeTruthy();

      const update = await postJsonRpc(
        url,
        {
          id: 2,
          method: "tasks/update",
          params: {
            taskId,
            inputResponses: { note: { ok: true } },
            _meta: {
              [META_PROTOCOL_VERSION]: PROTOCOL_LATEST,
              [META_CLIENT_CAPABILITIES]: {
                extensions: { [TASKS_EXTENSION_ID]: {} },
              },
            },
          },
        },
        {
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "tasks/update",
          "mcp-name": taskId,
        }
      );
      expect(update.response.status).toBe(200);
      expect(update.body.result.resultType).toBe("complete");

      // Poll until complete
      let status = "working";
      for (let i = 0; i < 20 && status === "working"; i++) {
        await Bun.sleep(25);
        const get = await postJsonRpc(
          url,
          {
            id: 10 + i,
            method: "tasks/get",
            params: {
              taskId,
              _meta: {
                [META_PROTOCOL_VERSION]: PROTOCOL_LATEST,
                [META_CLIENT_CAPABILITIES]: {
                  extensions: { [TASKS_EXTENSION_ID]: {} },
                },
              },
            },
          },
          {
            "mcp-protocol-version": PROTOCOL_LATEST,
            "mcp-method": "tasks/get",
            "mcp-name": taskId,
          }
        );
        status = get.body.result.status;
      }
      expect(status).toBe("completed");
    } finally {
      transport.stop();
    }
  });

  test("legacy sessioned initialize still works", async () => {
    const app = new Redop({
      serverInfo: { name: "legacy-test", version: "0.1.0" },
    }).tool("echo", {
      handler: async () => ({ ok: true }),
    });

    const { transport, url } = await startTestServer(app);
    try {
      const init = await postJsonRpc(
        url,
        {
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-11-25" },
        },
        { "mcp-protocol-version": "2025-11-25" }
      );
      const sessionId = init.response.headers.get("mcp-session-id");
      expect(sessionId).toBeTruthy();
      expect(init.body.result.protocolVersion).toBe("2025-11-25");
      expect(init.body.result.capabilities.tasks).toBeTruthy();
      expect(init.body.result.capabilities.extensions).toBeUndefined();

      const list = await postJsonRpc(
        url,
        { id: 2, method: "tools/list", params: {} },
        {
          "mcp-protocol-version": "2025-11-25",
          "mcp-session-id": sessionId!,
        }
      );
      expect(list.body.result.tools[0].name).toBe("echo");
      expect(list.body.result.ttlMs).toBeUndefined();
    } finally {
      transport.stop();
    }
  });
});
