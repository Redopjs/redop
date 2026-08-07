import { describe, expect, test } from "bun:test";

import {
  InputRequiredError,
  McpError,
  McpErrorCode,
  PROTOCOL_LATEST,
  requireInput,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "../src/index";
import {
  decodeMcpHeaderValue,
  isStatelessProtocol,
  isSupportedProtocolVersion,
  mcpNameRequired,
  negotiateProtocolVersion,
  validateMcpHeaders,
  withCacheHints,
  withResultType,
} from "../src/transports/protocol";
import { Redop } from "../src/index";

describe("protocol helpers", () => {
  test("negotiateProtocolVersion prefers requested supported version", () => {
    expect(negotiateProtocolVersion(PROTOCOL_LATEST)).toBe(PROTOCOL_LATEST);
    expect(negotiateProtocolVersion("1999-01-01")).toBeDefined();
  });

  test("isSupportedProtocolVersion and isStatelessProtocol", () => {
    expect(isSupportedProtocolVersion(PROTOCOL_LATEST)).toBe(true);
    expect(isSupportedProtocolVersion("nope")).toBe(false);
    expect(isStatelessProtocol(PROTOCOL_LATEST)).toBe(true);
    expect(isStatelessProtocol("2025-03-26")).toBe(false);
  });

  test("withCacheHints and withResultType only enrich latest protocol", () => {
    const base = { ok: true };
    expect(
      withCacheHints(base, { ttlMs: 1, cacheScope: "public" }, PROTOCOL_LATEST)
    ).toMatchObject({ ok: true, ttlMs: 1, cacheScope: "public" });
    expect(
      withCacheHints(base, { ttlMs: 1, cacheScope: "public" }, "2025-03-26")
    ).toEqual(base);
    expect(withResultType(base, PROTOCOL_LATEST, "complete")).toMatchObject({
      resultType: "complete",
    });
  });

  test("decodeMcpHeaderValue and mcpNameRequired", () => {
    expect(decodeMcpHeaderValue("plain")).toBe("plain");
    expect(mcpNameRequired("tools/call")).toBe(true);
    expect(mcpNameRequired("tools/list")).toBe(false);
  });

  test("validateMcpHeaders catches missing method", () => {
    const error = validateMcpHeaders({
      headers: {
        "mcp-protocol-version": PROTOCOL_LATEST,
      },
      method: "tools/list",
      protocolVersion: PROTOCOL_LATEST,
    });
    expect(error).toBeTruthy();
  });

  test("requireInput throws InputRequiredError", () => {
    expect(() =>
      requireInput({
        inputRequests: {
          query: { description: "Search query", type: "string" },
        },
      })
    ).toThrow(InputRequiredError);
  });

  test("requireInput rejects empty inputRequests", () => {
    expect(() => requireInput({ inputRequests: {} })).toThrow();
  });

  test("McpError carries code", () => {
    const error = new McpError(McpErrorCode.InvalidParams, "bad");
    expect(error.code).toBe(McpErrorCode.InvalidParams);
    expect(error.message).toBe("bad");
  });

  test("SUPPORTED_PROTOCOL_VERSIONS includes latest", () => {
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(PROTOCOL_LATEST);
  });
});

describe("registration edges", () => {
  test("duplicate tool is rejected", () => {
    const app = new Redop().tool("ping", { handler: async () => ({ ok: true }) });
    expect(() =>
      app.tool("ping", { handler: async () => ({ ok: false }) })
    ).toThrow(/already registered|duplicate/i);
  });

  test("empty tool and prompt names are rejected", () => {
    expect(() =>
      new Redop().tool("", { handler: async () => ({ ok: true }) })
    ).toThrow();
    expect(() =>
      new Redop().prompt("", { handler: async () => [] })
    ).toThrow();
  });

  test("tool name charset and length edges", () => {
    expect(() =>
      new Redop().tool("bad name", { handler: async () => ({ ok: true }) })
    ).toThrow();
    const long = "a".repeat(65);
    expect(() =>
      new Redop().tool(long, { handler: async () => ({ ok: true }) })
    ).toThrow();
    expect(() =>
      new Redop().tool("org.tools/ping_1", {
        handler: async () => ({ ok: true }),
      })
    ).not.toThrow();
  });

  test("resource display name cannot be empty", () => {
    expect(() =>
      new Redop().resource("config://server", {
        name: "",
        handler: async () => ({ type: "text", text: "x" }),
      })
    ).toThrow();
  });

  test("introspection getters", () => {
    const app = new Redop()
      .tool("ping", { handler: async () => ({ ok: true }) })
      .resource("config://server", {
        name: "Server",
        handler: async () => ({ type: "text", text: "x" }),
      })
      .prompt("hi", { handler: async () => [] });

    expect(app.toolNames).toEqual(["ping"]);
    expect(app.resourceUris).toEqual(["config://server"]);
    expect(app.promptNames).toEqual(["hi"]);
    expect(app.getTool("ping")?.name).toBe("ping");
    expect(app.getTool("missing")).toBeUndefined();
    expect(app.serverInfo.name).toBe("redop");
  });
});
