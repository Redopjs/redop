# Redop

The runtime-agnostic framework for production MCP servers.

This monorepo contains the core `redop` framework, the `create-redop-app` scaffolder, the docs site, and the marketing web app.

## Packages

- `packages/redop` — the Redop framework
- `packages/create-redop-app` — CLI scaffolder for new Redop apps
- `packages/tsconfig` — shared TypeScript configs

## Apps

- `apps/docs` — Mintlify documentation
- `apps/web` — website and examples

## Quick start

Install dependencies:

```sh
bun install
```

Run everything in dev:

```sh
bun run dev
```

Build the monorepo:

```sh
bun run build
```

Run checks:

```sh
bun run check
```

## Create a new Redop app

Use the scaffolder:

```sh
bun create redop-app
```

Or run the workspace package directly while developing it:

```sh
bun run packages/create-redop-app/src/index.ts --help
```

## Develop the framework

Build the `redop` package:

```sh
cd packages/redop
bun run build
```

Run the package tests:

```sh
cd packages/redop
bun test
```

## Publish

GitHub Actions workflows are included for publishing:

- [`publish-redop.yml`](/home/evans/projects/redop-ai/.github/workflows/publish-redop.yml)
- [`publish-create-redop-app.yml`](/home/evans/projects/redop-ai/.github/workflows/publish-create-redop-app.yml)

These workflows use `bun ci`, build and test the package, and publish with `bun publish`.

## Docs

- Docs source: [`apps/docs`](/home/evans/projects/redop-ai/apps/docs)
- Package docs: [`packages/redop/README.md`](/home/evans/projects/redop-ai/packages/redop/README.md)

## License

MIT © UseAgents
