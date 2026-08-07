# @redopjs/redop

[![Deploy to Railway](https://img.shields.io/badge/Deploy-Railway-f03603)](https://redop.useagents.site/docs/guides/deploy/railway)
[![Deploy to Fly.io](https://img.shields.io/badge/Deploy-Fly.io-f03603)](https://redop.useagents.site/docs/guides/deploy/fly-io)
[![Docs: Deploy to Production](https://img.shields.io/badge/Docs-Deploy%20to%20Production-111827)](https://redop.useagents.site/docs/guides/deploy/index)

Redop is a Bun-first TypeScript framework for building production MCP servers with typed tools, resources, prompts, middleware, hooks, plugins, and HTTP or stdio transports.

Use Redop when you want an explicit MCP framework instead of hand-writing transport, session, schema, and lifecycle plumbing yourself.

## Install

```sh
bun add @redopjs/redop zod
```

If you want a ready-to-run starter instead:

```sh
bun create redop-app my-redop-app
```

## Quick start

```ts
import { Redop } from "@redopjs/redop";
import { z } from "zod";

new Redop({
  serverInfo: {
    name: "my-mcp-server",
    version: "0.1.0",
    description: "Search docs and return answers",
  },
})
  .tool("search_docs", {
    description: "Search docs",
    inputSchema: z.object({
      query: z.string().min(1),
    }),
    handler: ({ input }) => ({
      query: input.query,
      results: [],
    }),
  })
  .listen(3000);
```

For a hosted server, the MCP endpoint will be available at `http://localhost:3000/mcp`.

## What Redop gives you

- Typed tool handlers with schema-driven parsing.
- Resources and prompts alongside tools in one server.
- Global middleware and lifecycle hooks across tools, resources, and prompts.
- Reusable plugins with typed request context.
- Explicit feature-module composition with `.use(...)`.
- HTTP and stdio transports from one API.
- MCP `2026-07-28` support: stateless HTTP, `server/discover`, header routing, list cache hints, MRTR (`requireInput`), and the tasks extension.
- Post-response hooks for analytics, logging, and other best-effort work.
- Built-in auth and logging plugins.

## Core ideas

Redop is built around a small set of explicit primitives:

- `new Redop(...)` creates the server.
- `.tool(...)` registers an MCP tool.
- `.resource(...)` registers a readable MCP resource.
- `.prompt(...)` registers reusable prompt material.
- `.middleware(...)` wraps execution.
- `.use(...)` composes feature modules or plugins.
- `.listen(...)` starts HTTP or stdio transport.

Redop does not rely on file-system routing. You compose MCP surface area directly in code.

## Tools, resources, and prompts

Redop supports all three main MCP surface types:

- Tools for actions and workflows.
- Resources for readable data addressed by URI.
- Prompts for reusable prompt material with arguments and messages.

That means one server can expose action-oriented behavior and read-only context from the same composition model.

## Typed schemas

Redop keeps runtime parsing and MCP metadata close to the tool definition.

You can define schemas with:

- Zod
- Standard Schema-compatible libraries
- JSON Schema

The same schema definition drives input validation and MCP discovery metadata.

## Lifecycle and middleware

Redop exposes a visible execution lifecycle instead of hiding everything in handlers.

For tools, the request flow is:

```txt
derive -> onTransform -> schema parse -> onParse ->
onBeforeHandle -> tool.before -> middleware -> handler ->
tool.after -> onAfterHandle -> response written ->
tool.afterResponse -> onAfterResponse
```

Resources and prompts use the same high-level model, minus schema parsing.

Use this model when you need:

- auth or request policy in middleware
- shared setup in `derive(...)`
- observability in hooks
- post-response work in `afterResponse(...)`

## Plugins and typed request context

Plugins in Redop are packaged `Redop` instances.

They can contribute:

- middleware
- lifecycle hooks
- tools
- resources
- prompts

The important part is data flow: plugin middleware can write request-scoped data to `ctx`, and handlers can read that data later in the same request.

```ts
import { definePlugin, Redop } from "@redopjs/redop";

const tenantPlugin = definePlugin({
  name: "tenant",
  version: "0.1.0",
  setup() {
    return new Redop<{ tenantId: string }>().middleware(
      async ({ ctx, request, next }) => {
        const tenantId = request.headers["x-tenant-id"];

        if (!tenantId) {
          throw new Error("Missing x-tenant-id header");
        }

        ctx.tenantId = tenantId;
        return next();
      }
    );
  },
});

new Redop({
  serverInfo: {
    name: "tenant-demo",
    version: "0.1.0",
  },
})
  .use(tenantPlugin({}))
  .tool("whoami", {
    handler: ({ ctx }) => ({
      tenantId: ctx.tenantId,
    }),
  });
```

## Compose larger servers with `.use(...)`

When your server grows, split it into feature modules.

Each feature folder can export its own `Redop` instance, and the root server can attach those modules with `.use(...)`.

```ts
import { Redop } from "@redopjs/redop";

const notes = new Redop()
  .tool("notes.list", {
    handler: () => ({ notes: [] }),
  })
  .resource("notes://{id}", {
    name: "Note",
    handler: ({ params }) => ({
      type: "text",
      text: JSON.stringify({ id: params.id }),
    }),
  });

const users = new Redop().tool("users.get", {
  handler: ({ input }) => ({
    id: input.id,
    name: "Ada Lovelace",
  }),
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
    },
    required: ["id"],
  },
});

new Redop({
  serverInfo: {
    name: "app",
    version: "0.1.0",
  },
})
  .use(notes)
  .use(users)
  .listen(3000);
```

## Error handling

Redop resolves errors by MCP operation type:

- `tools/call` failures are returned as tool results with `isError: true`
- `resources/read` failures are returned as JSON-RPC errors
- `prompts/get` failures are returned as JSON-RPC errors

`onError(...)` hooks can observe failures for logging, metrics, or tracing, but transport behavior is still normalized by Redop.

## Built-in plugins

Redop ships with built-in helpers for common concerns:

- `logger(...)`
- `apiKey(...)`
- `jwt(...)`
- `oauth(...)`

These use the same plugin model available to application code.

## Transports

Redop supports:

- HTTP for hosted MCP servers
- stdio for local or process-based MCP integration

You define the server once and choose the transport at startup.

## Local examples

- [`examples/basic.ts`](./examples/basic.ts)
- [`examples/modules.ts`](./examples/modules.ts)
- [`examples/with-zod.ts`](./examples/with-zod.ts)
- [`examples/plugins.ts`](./examples/plugins.ts)

## Documentation

- Docs: https://redop.useagents.site/docs
- Installation: https://redop.useagents.site/docs/getting-started/installation
- First server: https://redop.useagents.site/docs/getting-started/first-server
- Tools: https://redop.useagents.site/docs/documentation/tools
- Resources: https://redop.useagents.site/docs/documentation/resources
- Prompts: https://redop.useagents.site/docs/documentation/prompts
- Plugins: https://redop.useagents.site/docs/documentation/plugins
- Error handling: https://redop.useagents.site/docs/documentation/error-handling
- Compose features with `use(...)`: https://redop.useagents.site/docs/guides/compose-features-with-use
- Build a plugin or middleware: https://redop.useagents.site/docs/guides/build-plugin-or-middleware
- API reference: https://redop.useagents.site/docs/reference/redop

## Deploy

For the built-in HTTP transport, start with:

- Railway: https://redop.useagents.site/docs/guides/deploy/railway
- Fly.io: https://redop.useagents.site/docs/guides/deploy/fly-io
- Docker: https://redop.useagents.site/docs/guides/deploy/docker
- Vercel caveat: https://redop.useagents.site/docs/guides/deploy/vercel

## License

MIT © UseAgents
