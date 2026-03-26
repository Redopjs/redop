# @useagents/redop

[![Deploy to Railway](https://img.shields.io/badge/Deploy-Railway-f03603)](https://redop.useagents.site/guides/deploy/railway)
[![Deploy to Fly.io](https://img.shields.io/badge/Deploy-Fly.io-f03603)](https://redop.useagents.site/guides/deploy/fly-io)
[![Docs: Deploy to Production](https://img.shields.io/badge/Docs-Deploy%20to%20Production-111827)](https://redop.useagents.site/guides/deploy/index)

Bun-first TypeScript framework for building MCP servers with typed tools, middleware, hooks, plugins, resources, prompts, and HTTP or stdio transports.

## Install

```sh
bun add @useagents/redop zod
```

If you want a ready-to-run starter instead:

```sh
bun create redop-app my-redop-app
```

## Quick start

```ts
import { Redop } from "@useagents/redop";
import { z } from "zod";

new Redop({
  name: "my-mcp-server",
  version: "0.1.0",
})
  .tool("search_docs", {
    description: "Search docs",
    input: z.object({
      query: z.string().min(1),
    }),
    handler: ({ input }) => ({
      query: input.query,
      results: [],
    }),
  })
  .listen(3000);
```

For a hosted server, your MCP endpoint will be available at `http://localhost:3000/mcp`.

## What Redop gives you

- typed tool handlers with schema-driven parsing
- middleware and lifecycle hooks
- reusable plugin composition
- resources and prompts alongside tools
- HTTP and stdio transports from one API

## Learn more

- Docs: https://redop.useagents.site
- Installation: https://redop.useagents.site/getting-started/installation
- First server: https://redop.useagents.site/getting-started/first-server
- Deploy to production: https://redop.useagents.site/guides/deploy/index
- HTTP debugging: https://redop.useagents.site/guides/debug-http
- API reference: https://redop.useagents.site/reference/redop

## Deploy

For the built-in HTTP transport, start with Railway or Fly.io.

- Railway guide: https://redop.useagents.site/guides/deploy/railway
- Fly.io guide: https://redop.useagents.site/guides/deploy/fly-io
- Docker guide: https://redop.useagents.site/guides/deploy/docker
- Vercel caveat: https://redop.useagents.site/guides/deploy/vercel

## Local examples

- [`basic.ts`](/home/evans/projects/redop-ai/packages/redop/examples/basic.ts)
- [`with-zod.ts`](/home/evans/projects/redop-ai/packages/redop/examples/with-zod.ts)
- [`plugins.ts`](/home/evans/projects/redop-ai/packages/redop/examples/plugins.ts)

Plugin docs:

- Built-in plugins: https://redop.useagents.site/reference/built-in-plugins
- Build a plugin or middleware: https://redop.useagents.site/guides/build-plugin-or-middleware

## License

MIT © UseAgents
