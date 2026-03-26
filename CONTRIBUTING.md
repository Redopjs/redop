# Contributing to Redop

Thanks for contributing to Redop.

This repo is a Bun-first monorepo for:

- `packages/redop`: the framework package
- `packages/create-redop-app`: the starter scaffolder
- `apps/docs`: the Mintlify docs content
- `apps/web`: the marketing website

## Prerequisites

- Bun `1.3.11`
- Git

Install dependencies from the repo root:

```sh
bun install
```

## Repo layout

```txt
apps/
  docs/                Mintlify docs content
  web/                 marketing website
packages/
  redop/               framework package
  create-redop-app/    scaffold CLI
  tsconfig/            shared tsconfig package
```

## Common commands

From the repo root:

```sh
bun run dev
bun run build
bun run check-types
bun run check
bun run fix
```

Useful focused commands:

```sh
bun run dev:web
bun run build:web
```

## Working on `packages/redop`

Build the package:

```sh
bun run --cwd packages/redop build
```

The package examples live in:

- `packages/redop/examples/basic.ts`
- `packages/redop/examples/with-zod.ts`
- `packages/redop/examples/plugins.ts`

When you change public framework behavior, also update:

- package docs in `packages/redop/README.md`
- docs content in `apps/docs`
- starter output in `packages/create-redop-app` when relevant

## Working on `create-redop-app`

Run tests:

```sh
bun test packages/create-redop-app/tests/create-redop-app.test.ts
```

Run typecheck:

```sh
bun run --cwd packages/create-redop-app typecheck
```

If you change generated starter output, update:

- `packages/create-redop-app/src/templates.ts`
- `packages/create-redop-app/README.md`
- related docs pages in `apps/docs`

## Working on the website

Run the website locally:

```sh
bun run --cwd apps/web dev
```

Build the website:

```sh
bun run --cwd apps/web build
```

## Working on the docs

Docs content lives in `apps/docs`.

When changing framework APIs or defaults:

- update the relevant getting started pages
- update the reference pages
- update deploy guides if deployment behavior changed
- keep examples copy-pasteable

## Pull request guidelines

- keep changes scoped
- prefer Bun-native patterns
- update docs when behavior changes
- add or update tests when changing generator behavior
- do not document APIs that are not actually exported or implemented

## Good first contributions

- docs clarifications
- example improvements
- deployment docs updates
- UI/devtools polish
- starter template improvements

## Questions

If something is unclear, open an issue or draft PR with context about the problem you are trying to solve.
