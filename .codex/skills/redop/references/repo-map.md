# Redop Repo Map

## Monorepo layout

- `packages/redop`: framework runtime, types, transports, built-in plugins, examples, tests
- `packages/create-redop-app`: starter CLI, generator, templates, tests
- `apps/docs`: Mintlify docs content and navigation
- `apps/web`: marketing site
- `packages/tsconfig`: shared TypeScript configs

## Read-first files by task

### Framework runtime

- `packages/redop/src/redop.ts`
- `packages/redop/src/index.ts`
- `packages/redop/src/types/`
- `packages/redop/src/adapters/schema.ts`
- `packages/redop/src/transports/http.ts`
- `packages/redop/src/transports/stdio.ts`

### Built-in plugins and auth

- `packages/redop/src/plugins/index.ts`
- `packages/redop/src/plugins/auth.ts`
- `apps/docs/reference/built-in-plugins.mdx`
- `apps/docs/guides/use-built-in-plugins.mdx`

### Docs work

- `apps/docs/docs.json`
- matching page under `apps/docs/`
- `packages/redop/README.md`
- `CONTRIBUTING.md`

### Starter generation

- `packages/create-redop-app/src/index.ts`
- `packages/create-redop-app/src/generator.ts`
- `packages/create-redop-app/src/templates.ts`
- `packages/create-redop-app/src/prompt.ts`
- `packages/create-redop-app/tests/create-redop-app.test.ts`

## Commands

From repo root:

```sh
bun install
bun run dev
bun run build
bun run check
```

Focused framework commands:

```sh
bun run --cwd packages/redop build
bun run --cwd packages/redop test
```

Focused scaffolder commands:

```sh
bun test packages/create-redop-app/tests/create-redop-app.test.ts
bun run --cwd packages/create-redop-app typecheck
```

## Update rules from contributor guidance

- If public framework behavior changes, update `packages/redop/README.md`.
- Update the matching docs pages in `apps/docs`.
- Update `packages/create-redop-app` when starter output or onboarding expectations changed.
- Keep docs examples copy-pasteable.
- Do not document APIs that are not exported or implemented.
