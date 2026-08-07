import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { Redop } from "../src/index";
import { callHandler } from "./helpers";

describe("capabilities and server metadata", () => {
  test("_resolvedCapabilities reflects empty registries", () => {
    const empty = new Redop({
      capabilities: { tools: true, resources: true, prompts: true },
    });
    expect(empty._resolvedCapabilities()).toEqual({
      tools: true,
      resources: false,
      prompts: false,
    });

    const filled = new Redop()
      .resource("x://y", {
        name: "Y",
        handler: async () => ({ type: "text", text: "t" }),
      })
      .prompt("p", { handler: async () => [] });
    expect(filled._resolvedCapabilities()).toMatchObject({
      resources: true,
      prompts: true,
    });
  });

  test("disabled tools capability returns method-not-found on list", async () => {
    const app = new Redop({
      serverInfo: { name: "caps", version: "0.1.0" },
      capabilities: { tools: false },
    }).tool("hidden", { handler: async () => ({ ok: true }) });

    const { body } = await callHandler(app, "tools/list");
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32601);
  });

  test("serverInfo fields appear on server/discover", async () => {
    const app = new Redop({
      name: "legacy-name",
      version: "9.9.9",
      serverInfo: {
        title: "Pretty Title",
        description: "A test server",
        websiteUrl: "https://example.com",
        instructions: "Be kind",
        icons: [
          {
            src: "https://example.com/icon.png",
            mimeType: "image/png",
            sizes: ["64x64"],
          },
        ],
      },
    }).tool("ping", { handler: async () => ({ ok: true }) });

    const { body } = await callHandler(app, "server/discover");
    expect(body.result.serverInfo).toMatchObject({
      name: "legacy-name",
      version: "9.9.9",
      title: "Pretty Title",
      description: "A test server",
      websiteUrl: "https://example.com",
    });
    expect(body.result.instructions).toBe("Be kind");
    expect(body.result.serverInfo.icons?.[0]?.src).toContain("icon.png");
  });

  test("tools/list includes title, annotations, icons, and taskSupport", async () => {
    const app = new Redop({
      serverInfo: { name: "meta", version: "0.1.0" },
    }).tool("search", {
      title: "Search Docs",
      description: "Find things",
      annotations: { readOnlyHint: true, openWorldHint: false },
      icons: [{ src: "https://example.com/search.svg", mimeType: "image/svg+xml" }],
      taskSupport: "optional",
      outputSchema: z.object({ hits: z.number() }),
      handler: async () => ({ hits: 0 }),
    });

    const { body } = await callHandler(app, "tools/list");
    const tool = body.result.tools.find((t: any) => t.name === "search");
    expect(tool).toMatchObject({
      title: "Search Docs",
      description: "Find things",
      annotations: { readOnlyHint: true, openWorldHint: false },
      execution: { taskSupport: "optional" },
    });
    expect(tool.icons?.[0]?.src).toContain("search.svg");
    expect(tool.outputSchema).toBeDefined();
  });
});
