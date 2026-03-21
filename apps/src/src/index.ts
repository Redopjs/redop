import { Redop } from "redop";
import { z } from "zod";

new Redop({
  name: "mcp",
  version: "0.1.0",
})
  .tool("test_", {
    description: "Health check tool",
    input: z.object({
      message: z.string().default("pong"),
    }),
    handler: ({ input }) => ({
      ok: true,
      message: input.message,
      ts: Date.now(),
    }),
  })
  .listen({
    port: Number(process.env.PORT ?? 3000),
    hostname: "0.0.0.0",
    cors: true,
    onListen: ({ url }) => {
      console.log(`redop ready -> ${url}`);
    },
  });
