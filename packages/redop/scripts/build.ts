import { build } from "bun";

async function buildOrExit(
  label: string,
  config: Parameters<typeof Bun.build>[0]
) {
  const result = await build(config);

  if (!result.success) {
    for (const log of result.logs) {
      console.error(`[${label}] ${log.message}`);
    }
    process.exit(1);
  }
}

await buildOrExit("server", {
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
});

// Browser/edge-safe bundles: avoid node:module createRequire at load time.
await buildOrExit("edge-adapters", {
  entrypoints: ["./src/cloudflare.ts", "./src/vercel.ts"],
  outdir: "./dist",
  target: "browser",
  external: ["bun", "@vercel/functions"],
});

await buildOrExit("node-adapter", {
  entrypoints: ["./src/node.ts"],
  outdir: "./dist",
  target: "node",
  external: ["bun", "@vercel/functions"],
});
