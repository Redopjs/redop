---
name: redop
description: Navigate and work in the Redop monorepo. Use when Codex needs to understand or change `@redopjs/redop`, `create-redop-app`, Mintlify docs in `apps/docs`, built-in plugins, transports, examples, or tests; review Redop pull requests; trace how tools, resources, prompts, hooks, middleware, and plugins flow through the runtime; decide which docs and package files must change together; or split Redop repo investigation across subagents.
---

# Redop

## Overview

Work from source, not memory. Rebuild context from `packages/redop`, `apps/docs`, examples, tests, and the scaffolder before editing or reviewing behavior.

## Quick Start

- Run `scripts/redop-map.sh <area>` to get the shortest file list for the task.
- Read `references/repo-map.md` for workspace layout and common commands.
- Read `references/framework-guide.md` when the task touches runtime or API behavior.
- Read `references/docs-and-surfaces.md` when the task touches docs, examples, CLI output, or release surface.

## Workflow

1. Classify the request before opening files:
   - framework runtime or typing
   - docs or examples
   - transport behavior
   - plugins or auth
   - scaffolder output
   - review or regression hunt
2. Load only the relevant files first. Prefer:
   - `packages/redop/src/redop.ts`
   - `packages/redop/src/index.ts`
   - `packages/redop/src/types/`
   - `packages/redop/src/adapters/schema.ts`
   - `packages/redop/src/transports/`
   - `packages/redop/src/plugins/`
   - `packages/redop/examples/`
   - `packages/redop/tests/`
   - `packages/redop/README.md`
   - `apps/docs/docs.json`
3. Split discovery across subagents when the task spans multiple surfaces:
   - one subagent for `packages/redop`
   - one subagent for `apps/docs`
   - one subagent for `packages/create-redop-app` when starter generation matters
   Ask for file paths, invariants, and missing updates. Do not ask for polished prose.
4. Confirm impact before editing:
   - runtime or public API change: update code, package docs, and Mintlify docs together
   - scaffolder change: update templates, CLI docs, and tests together
   - docs-only change: keep examples copy-pasteable and navigation in sync
5. Verify with the smallest focused command that covers the edited surface, then broaden only if needed.

## Task Playbooks

### Understand Redop

- Read `references/framework-guide.md`.
- Trace this order in source:
  - registration and execution in `packages/redop/src/redop.ts`
  - exports in `packages/redop/src/index.ts`
  - type contracts in `packages/redop/src/types/`
  - schema adapters in `packages/redop/src/adapters/schema.ts`
  - transport behavior in `packages/redop/src/transports/`
  - built-in plugins in `packages/redop/src/plugins/`
  - examples in `packages/redop/examples/`
  - invariants and edge cases in `packages/redop/tests/`

### Review or Change Framework Behavior

- Treat `packages/redop/src/redop.ts` as the runtime source of truth.
- Check lifecycle ordering, schema parsing boundaries, context widening, duplicate-name validation, resource template matching, and transport-specific behavior.
- Confirm intended behavior with examples and tests before changing docs.

### Review or Change Docs

- Treat `apps/docs/docs.json` as the authoritative navigation map.
- Read the matching concept page, guide/tutorial, and reference page together before rewriting.
- Keep examples aligned with actual exports and current runtime behavior.
- If behavior changed, update `packages/redop/README.md` and the relevant Mintlify pages in the same pass.

### Review or Change `create-redop-app`

- Read `packages/create-redop-app/src/index.ts`, `src/generator.ts`, `src/templates.ts`, `src/prompt.ts`, and `tests/create-redop-app.test.ts`.
- Sync `packages/create-redop-app/README.md` and the docs pages covering installation, presets, and CLI reference.

### Review Pull Requests

- Prioritize findings in this order:
  - runtime regressions
  - type-safety or API drift
  - doc drift
  - missing examples/tests
- Compare claimed behavior against source, not just docs or generated output.
- Flag changes that update implementation without updating `packages/redop/README.md`, `apps/docs`, or starter output when those surfaces should move together.

## Verification

Use focused checks first:

```sh
bun run --cwd packages/redop build
bun run --cwd packages/redop test
```

For scaffolder work:

```sh
bun test packages/create-redop-app/tests/create-redop-app.test.ts
bun run --cwd packages/create-redop-app typecheck
```

For broader repo validation:

```sh
bun run check
```
