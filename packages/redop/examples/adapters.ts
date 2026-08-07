/**
 * Portable runtime adapters — Cloudflare / Vercel / Node.
 *
 * Bun remains the default via `.listen()`. These examples show the same app
 * exported for other runtimes.
 */

import { Redop } from "../src/index";
import { toCloudflare } from "../src/cloudflare";
import { toVercel } from "../src/vercel";
import { listenNode } from "../src/node";

const app = new Redop({
  serverInfo: {
    name: "adapter-demo",
    version: "0.1.0",
  },
}).tool("ping", {
  description: "Health check",
  handler: async () => ({ ok: true }),
});

// Cloudflare Workers:
// export default toCloudflare(app, { health: true });

// Vercel / Edge (pass waitUntil from @vercel/functions in production):
// export default toVercel(app, { health: true, waitUntil });

// Node long-lived process:
if (import.meta.main) {
  void toCloudflare;
  void toVercel;
  listenNode(app, {
    port: Number(process.env.PORT ?? 3000),
    hostname: "0.0.0.0",
    health: true,
    onListen: ({ url }) => {
      console.log(`Redop (Node adapter) at ${url}`);
    },
  });
}
