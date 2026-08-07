import { describe, expect, test } from "bun:test";

import { Redop } from "../src/index";
import { callHandler } from "./helpers";

describe("prompt requireInput over HTTP", () => {
  test("prompts/get returns input_required when requireInput is thrown", async () => {
    const { requireInput } = await import("../src/index");
    const app = new Redop({
      serverInfo: { name: "prompt-input", version: "0.1.0" },
    }).prompt("ask", {
      handler: async ({ arguments: args }) => {
        if (!args?.answer) {
          requireInput({
            inputRequests: {
              answer: { description: "Your answer", type: "string" },
            },
          });
        }
        return [
          {
            role: "user",
            content: { type: "text", text: String(args?.answer) },
          },
        ];
      },
    });

    const { body } = await callHandler(app, "prompts/get", {
      name: "ask",
      args: {},
    });
    expect(body.result.resultType).toBe("input_required");
    expect(body.result.inputRequests.answer).toBeDefined();
  });
});
