# create-redop-app

[![Deploy to Railway](https://img.shields.io/badge/Deploy-Railway-f03603)](https://redop.useagents.site/guides/deploy/railway)
[![Deploy to Fly.io](https://img.shields.io/badge/Deploy-Fly.io-f03603)](https://redop.useagents.site/guides/deploy/fly-io)
[![Docs: Deploy to Production](https://img.shields.io/badge/Docs-Deploy%20to%20Production-111827)](https://redop.useagents.site/guides/deploy/index)

Scaffold a Bun-first Redop app with transport and deployment presets.

## Usage

```sh
bun create redop-app my-redop-app
```

Run the CLI directly when you want to pass flags in one command:

```sh
bunx create-redop-app my-redop-app --transport http --deploy railway
```

Preselect starter components when you want more than a basic tool-only app:

```sh
bunx create-redop-app my-redop-app --components tools,resources,prompts
```

Choose the schema style for generated tool inputs:

```sh
bunx create-redop-app my-redop-app --schema json-schema
```

## Flags

- `--transport <http|stdio>`
- `--components <tools,resources,prompts>`
- `--schema <zod|json-schema|valibot|typebox>`
- `--deploy <none|railway|fly-io|vercel>`

## What it generates

Every starter includes:

- `package.json`
- `tsconfig.json`
- `src/index.ts`
- `README.md`

Depending on your component choices, `src/index.ts` can include sample:

- tools
- resources
- prompts

When tools are included, the starter can generate inputs using:

- zod
- json-schema
- valibot
- typebox

Depending on the deploy preset, it can also add:

- `Dockerfile`
- `fly.toml`
- `vercel.json`

## Generated scripts

Generated starters now default to:

- `dev`: `bun run --watch src/index.ts`
- `start`: `bun run src/index.ts`
- `typecheck`: `tsc --noEmit`

Run the scaffolded app with:

```sh
bun dev
```

## Good defaults

- use `http` for hosted services
- use `stdio` for local MCP command integrations
- use `railway` or `fly-io` for long-running HTTP deployments
- treat `vercel` as a starting point, not a drop-in match for the default Redop server shape

## Learn more

- Docs: https://redop.useagents.site
- Getting started: https://redop.useagents.site/getting-started/create-redop-app
- CLI reference: https://redop.useagents.site/reference/create-redop-app-cli
- Deploy to production: https://redop.useagents.site/guides/deploy/index
- Deploy to Railway: https://redop.useagents.site/guides/deploy/railway
- Deploy to Fly.io: https://redop.useagents.site/guides/deploy/fly-io
- Deploy with Docker: https://redop.useagents.site/guides/deploy/docker
- Vercel caveat: https://redop.useagents.site/guides/deploy/vercel

## Framework package

The generated project installs `@useagents/redop`.
