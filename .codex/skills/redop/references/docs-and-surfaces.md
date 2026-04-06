# Docs And Update Surfaces

## Docs navigation

Use `apps/docs/docs.json` as the top-level map. The docs are grouped into:

- Getting Started
- Core documentation
- Plugins
- Tutorials
- Concepts
- Guides
- Reference
- Examples
- Deploy to Production

## Best pages by question

### What is Redop and how does it think?

- `apps/docs/index.mdx`
- `apps/docs/concepts/mental-model.mdx`
- `apps/docs/concepts/lifecycle.mdx`
- `apps/docs/concepts/composition.mdx`
- `apps/docs/concepts/transports.mdx`

### How do I build or wire a server?

- `apps/docs/getting-started/first-server.mdx`
- `apps/docs/getting-started/connect-http.mdx`
- `apps/docs/getting-started/connect-stdio.mdx`
- `apps/docs/tutorials/build-http-server.mdx`
- `apps/docs/tutorials/add-zod-tool.mdx`
- `apps/docs/tutorials/add-middleware-hooks.mdx`

### How do tools, resources, prompts, and schemas behave?

- `apps/docs/documentation/tools.mdx`
- `apps/docs/documentation/resources.mdx`
- `apps/docs/documentation/prompts.mdx`
- `apps/docs/documentation/validation.mdx`
- `apps/docs/concepts/resources-prompts.mdx`
- `apps/docs/concepts/schemas.mdx`

### How do plugins, auth, and middleware work?

- `apps/docs/documentation/plugins.mdx`
- `apps/docs/guides/use-built-in-plugins.mdx`
- `apps/docs/guides/build-plugin-or-middleware.mdx`
- `apps/docs/guides/build-plugins.mdx`
- `apps/docs/reference/built-in-plugins.mdx`

### Which API page should I trust for exact signatures?

- `apps/docs/reference/redop.mdx`
- `apps/docs/reference/tool-definition.mdx`
- `apps/docs/reference/resource-definition.mdx`
- `apps/docs/reference/prompt-definition.mdx`
- `apps/docs/reference/listen-options.mdx`
- `apps/docs/reference/http-transport.mdx`
- `apps/docs/reference/schema-adapters.mdx`
- `apps/docs/reference/request-context.mdx`

### Where do starter and deploy questions live?

- `apps/docs/getting-started/create-redop-app.mdx`
- `apps/docs/guides/create-redop-app-presets.mdx`
- `apps/docs/reference/create-redop-app-cli.mdx`
- `apps/docs/guides/deploy/index.mdx`
- `apps/docs/guides/deploy/railway.mdx`
- `apps/docs/guides/deploy/fly-io.mdx`
- `apps/docs/guides/deploy/docker.mdx`
- `apps/docs/guides/deploy/vercel.mdx`

## Update surfaces by change type

### Framework/runtime change

- implementation in `packages/redop`
- package docs in `packages/redop/README.md`
- matching Mintlify pages in `apps/docs`
- starter output in `packages/create-redop-app` when onboarding expectations changed

### Docs-only clarification

- matching docs page
- `apps/docs/docs.json` only if nav changes
- examples if code snippets were stale

### Scaffolder change

- CLI source and templates
- scaffolder README
- docs pages for install, presets, CLI reference, and scaffold tutorials
- tests for generated output

## Review rules

- Do not assume docs and runtime match. Verify in source first.
- Do not document APIs that are not exported or implemented.
- Keep examples runnable or at least copy-pasteable.
- When behavior changed, look for missed updates in `packages/redop/README.md`, `apps/docs`, and `packages/create-redop-app`.
