# Redop Framework Guide

## Source of truth

- `packages/redop/src/redop.ts` contains registration, execution, composition, subscriptions, and transport selection.
- `packages/redop/src/index.ts` defines the exported public surface.
- `packages/redop/src/types/` explains the type contracts for handlers, hooks, plugins, transports, and schemas.

## Core model

Redop is a composition-first MCP framework:

- `new Redop(...)` creates a server with `serverInfo` and capability settings.
- `.tool(...)` registers tools.
- `.resource(...)` registers static or template resources.
- `.prompt(...)` registers prompt handlers plus `arguments` or `argumentsSchema`.
- `.derive(...)` widens request context before hooks and handlers run.
- `.middleware(...)` registers global middleware for tools, resources, and prompts.
- `.use(...)` merges another `Redop` instance as a feature module or plugin.
- `.listen(...)` selects HTTP or stdio transport.

## Runtime order

### Tools

Tool execution in `redop.ts` follows this order:

1. create base context
2. run `derive(...)`
3. run `onTransform(...)`
4. parse input schema
5. run `onParse(...)`
6. run global `onBeforeHandle(...)`
7. run tool-local `before`
8. run global middleware then tool-local middleware
9. run handler
10. run tool-local `after`
11. run global `onAfterHandle(...)`
12. write response
13. run tool-local `afterResponse`
14. run global `onAfterResponse(...)`

Parsing failures are wrapped with `Validation failed for "<tool>"`.

### Resources

- static resources use exact URI match
- template resources use `{param}` extraction
- resources share global hooks and middleware
- `notifyResourceChanged(uri)` pushes `notifications/resources/updated` to subscribed HTTP sessions

### Prompts

- prompts accept explicit `arguments` metadata or `argumentsSchema`
- `argumentsSchema` can also derive argument metadata from JSON Schema
- missing required prompt arguments fail before handler execution

## Schema support

`packages/redop/src/adapters/schema.ts` auto-detects:

1. Standard Schema V1 libraries such as Zod, Valibot, and ArkType
2. TypeBox
3. plain JSON Schema

Use this file when a task touches validation, inference, or JSON Schema generation.

## Plugins and composition

- `definePlugin(...)` wraps a factory that returns a `Redop` instance
- plugins can add hooks, middleware, tools, resources, prompts, input parsers, and derive functions
- `.use(...)` merges those internals directly into the host app
- plugin middleware and derive functions can widen host context types

Check:

- `packages/redop/examples/plugins.ts`
- `packages/redop/tests/redop.validation.test.ts`

## Transports

### HTTP

Read `packages/redop/src/transports/http.ts` for:

- session lifecycle
- SSE support
- task polling and cancellation
- `MCP-Session-Id` behavior
- HTTP path and health handling
- debug logging to stderr

### stdio

Read `packages/redop/src/transports/stdio.ts` for:

- newline-delimited JSON-RPC
- stderr-only logging
- request concurrency and cancellation
- initialize/version negotiation

## Examples and tests

Examples show intended usage:

- `examples/basic.ts`
- `examples/modules.ts`
- `examples/with-zod.ts`
- `examples/plugins.ts`

Tests show enforced invariants:

- invalid tool and prompt names
- invalid resource URI templates
- schema parsing failures
- prompt argument validation
- plugin-driven context widening

Read examples and tests before concluding that docs are authoritative.
