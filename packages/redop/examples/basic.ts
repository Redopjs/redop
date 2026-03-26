import { Redop } from "../src/index";

new Redop({
  name: "redop",
  title: "Redop",
  description: "Hello mcp world",
})

  .onBeforeHandle(({ ctx }) => {
    ctx.startedAt = performance.now();
  })
  .tool("ping", {
    description: "Health check",
    handler: () => ({ pong: true, ts: Date.now() }),
  })
  .tool("echo", {
    handler: ({ input }) =>
      typeof input.message === "string"
        ? input.message.toUpperCase()
        : input.message,
    input: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
  })
  .listen({
    cors: true,
    debug: process.env.DEBUG_HTTP === "1",
    onListen: ({ url }) => console.log(`redop ready → ${url}`),
    port: process.env.PORT ?? 3000,
  });
