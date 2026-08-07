import { describe, expect, test } from "bun:test";

import {
  META_CLIENT_CAPABILITIES,
  PROTOCOL_LATEST,
  TASKS_EXTENSION_ID,
} from "../src/transports/protocol";
import { Redop } from "../src/index";
import { callHandler, mcpRequest } from "./helpers";

describe("tasks cancel and origin guard", () => {
  test("tasks/cancel marks a running task cancelled", async () => {
    const app = new Redop({
      serverInfo: { name: "cancel-tasks", version: "0.1.0" },
    }).tool("slow", {
      taskSupport: "required",
      handler: async () => {
        await Bun.sleep(200);
        return { ok: true };
      },
    });

    const caps = {
      [META_CLIENT_CAPABILITIES]: {
        extensions: { [TASKS_EXTENSION_ID]: {} },
      },
    };

    const call = await callHandler(app, "tools/call", {
      name: "slow",
      bodyParams: { _meta: caps },
    });
    expect(call.body.result.resultType).toBe("task");
    const taskId = call.body.result.task.taskId as string;

    const cancel = await callHandler(app, "tasks/cancel", {
      name: taskId,
      bodyParams: { taskId, _meta: caps },
    });
    expect(cancel.body.error).toBeUndefined();
    expect(cancel.body.result.status).toBe("cancelled");
    expect(cancel.body.result.taskId).toBe(taskId);

    const again = await callHandler(app, "tasks/cancel", {
      name: taskId,
      bodyParams: { taskId, _meta: caps },
    });
    expect(again.body.error?.message).toMatch(/terminal|cancelled/i);
  });

  test("tasks/cancel without tasks extension is rejected on latest protocol", async () => {
    const app = new Redop({
      serverInfo: { name: "no-ext", version: "0.1.0" },
    });
    const { body } = await callHandler(app, "tasks/cancel", {
      name: "missing-task",
      bodyParams: { taskId: "missing-task" },
    });
    expect(body.error).toBeDefined();
    expect(String(body.error.message)).toMatch(/capability|tasks/i);
  });

  test("mismatched Origin is forbidden", async () => {
    const app = new Redop({
      serverInfo: { name: "origin", version: "0.1.0" },
    }).tool("ping", { handler: async () => ({ ok: true }) });
    const handler = app.handler();
    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-method": "ping",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "ping",
          params: {},
        }),
      })
    );
    expect(response.status).toBe(403);
  });

  test("DELETE session is rejected on latest protocol", async () => {
    const app = new Redop({
      serverInfo: { name: "del", version: "0.1.0" },
    });
    const handler = app.handler();
    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "DELETE",
        headers: {
          "mcp-protocol-version": PROTOCOL_LATEST,
          "mcp-session-id": "sess-1",
        },
      })
    );
    expect(response.status).toBe(400);
  });

  test("same-origin Origin is allowed", async () => {
    const app = new Redop({
      serverInfo: { name: "ok-origin", version: "0.1.0" },
    });
    const handler = app.handler();
    const response = await handler(
      mcpRequest("ping", {
        headers: { origin: "http://localhost" },
      })
    );
    expect(response.status).toBe(200);
  });
});
