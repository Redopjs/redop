import { describe, expect, test } from "bun:test";

import { Redop } from "../src/index";
import { callHandler } from "./helpers";

describe("resource templates", () => {
  test("static URI exact match", async () => {
    const app = new Redop().resource("config://server", {
      name: "Server",
      handler: async () => ({ type: "text", text: "ok" }),
    });
    const execution = await app._executeResource("config://server", {
      headers: {},
      transport: "http",
    });
    expect(execution.ok).toBe(true);
  });

  test("single-param template extracts params", async () => {
    const app = new Redop().resource("notes://{id}", {
      name: "Note",
      handler: async ({ params }) => ({
        type: "text",
        text: JSON.stringify(params),
      }),
    });
    const execution = await app._executeResource("notes://abc", {
      headers: {},
      transport: "http",
    });
    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect(execution.result).toEqual({
        type: "text",
        text: JSON.stringify({ id: "abc" }),
      });
    }
  });

  test("multi-segment template extracts all vars", async () => {
    const app = new Redop().resource("docs://{org}/{slug}", {
      name: "Doc",
      handler: async ({ params }) => ({
        type: "text",
        text: `${params.org}/${params.slug}`,
      }),
    });
    const execution = await app._executeResource("docs://acme/readme", {
      headers: {},
      transport: "http",
    });
    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect((execution.result as any).text).toBe("acme/readme");
    }
  });

  test("template does not match slash inside a var", async () => {
    const app = new Redop().resource("notes://{id}", {
      name: "Note",
      handler: async () => ({ type: "text", text: "hit" }),
    });
    const execution = await app._executeResource("notes://a/b", {
      headers: {},
      transport: "http",
    });
    expect(execution.ok).toBe(false);
  });

  test("exact static wins over overlapping template", async () => {
    const app = new Redop()
      .resource("notes://special", {
        name: "Special",
        handler: async () => ({ type: "text", text: "static" }),
      })
      .resource("notes://{id}", {
        name: "Note",
        handler: async () => ({ type: "text", text: "template" }),
      });

    const execution = await app._executeResource("notes://special", {
      headers: {},
      transport: "http",
    });
    expect(execution.ok).toBe(true);
    if (execution.ok) {
      expect((execution.result as any).text).toBe("static");
    }
  });

  test("unknown URI returns not found", async () => {
    const app = new Redop().resource("config://server", {
      name: "Server",
      handler: async () => ({ type: "text", text: "ok" }),
    });
    const execution = await app._executeResource("missing://x", {
      headers: {},
      transport: "http",
    });
    expect(execution.ok).toBe(false);
    if (!execution.ok) {
      expect(String(execution.error)).toMatch(/not found/i);
    }
  });

  test("registration rejects empty URI and unmatched braces", () => {
    expect(() =>
      new Redop().resource("", {
        name: "Bad",
        handler: async () => ({ type: "text", text: "x" }),
      })
    ).toThrow();
    expect(() =>
      new Redop().resource("notes://{id", {
        name: "Bad",
        handler: async () => ({ type: "text", text: "x" }),
      })
    ).toThrow();
  });

  test("duplicate resource URI is rejected", () => {
    const app = new Redop().resource("config://server", {
      name: "Server",
      handler: async () => ({ type: "text", text: "a" }),
    });
    expect(() =>
      app.resource("config://server", {
        name: "Again",
        handler: async () => ({ type: "text", text: "b" }),
      })
    ).toThrow(/already registered|duplicate/i);
  });

  test("resources/list and resources/templates/list separate static vs templates", async () => {
    const app = new Redop({
      serverInfo: { name: "res-lists", version: "0.1.0" },
    })
      .resource("config://server", {
        name: "Server",
        handler: async () => ({ type: "text", text: "ok" }),
      })
      .resource("notes://{id}", {
        name: "Note",
        handler: async () => ({ type: "text", text: "n" }),
      });

    const listed = await callHandler(app, "resources/list");
    const templates = await callHandler(app, "resources/templates/list");

    expect(
      listed.body.result.resources.some((r: any) => r.uri === "config://server")
    ).toBe(true);
    expect(
      listed.body.result.resources.some((r: any) =>
        String(r.uri ?? "").includes("{")
      )
    ).toBe(false);
    expect(
      templates.body.result.resourceTemplates.some((r: any) =>
        String(r.uriTemplate ?? r.uri ?? "").includes("{id}")
      )
    ).toBe(true);
  });

  test("notifyResourceChanged is safe with no subscribers", () => {
    const app = new Redop().resource("config://server", {
      name: "Server",
      handler: async () => ({ type: "text", text: "ok" }),
    });
    expect(() => app.notifyResourceChanged("config://server")).not.toThrow();
  });
});
