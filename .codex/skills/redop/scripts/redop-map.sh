#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: redop-map.sh <area>

Areas:
  framework   core runtime, typing, schema flow, composition
  docs        Mintlify navigation and docs surfaces
  scaffolder  create-redop-app source, templates, tests
  plugins     built-in plugins and auth
  transports  HTTP, stdio, and SSE internals
  examples    runnable package examples
  tests       framework invariants and edge cases
  review      cross-surface review checklist
  all         top-level map
EOF
}

print_framework() {
  cat <<'EOF'
packages/redop/src/redop.ts
packages/redop/src/index.ts
packages/redop/src/types/
packages/redop/src/adapters/schema.ts
packages/redop/README.md
apps/docs/reference/redop.mdx
apps/docs/documentation/tools.mdx
apps/docs/documentation/resources.mdx
apps/docs/documentation/prompts.mdx
apps/docs/concepts/lifecycle.mdx
apps/docs/concepts/composition.mdx
EOF
}

print_docs() {
  cat <<'EOF'
apps/docs/docs.json
apps/docs/index.mdx
apps/docs/concepts/
apps/docs/documentation/
apps/docs/guides/
apps/docs/reference/
apps/docs/tutorials/
apps/docs/examples/
packages/redop/README.md
CONTRIBUTING.md
EOF
}

print_scaffolder() {
  cat <<'EOF'
packages/create-redop-app/src/index.ts
packages/create-redop-app/src/generator.ts
packages/create-redop-app/src/templates.ts
packages/create-redop-app/src/prompt.ts
packages/create-redop-app/README.md
packages/create-redop-app/tests/create-redop-app.test.ts
apps/docs/getting-started/create-redop-app.mdx
apps/docs/guides/create-redop-app-presets.mdx
apps/docs/reference/create-redop-app-cli.mdx
apps/docs/tutorials/scaffold-and-ship.mdx
EOF
}

print_plugins() {
  cat <<'EOF'
packages/redop/src/plugins/index.ts
packages/redop/src/plugins/auth.ts
packages/redop/examples/plugins.ts
apps/docs/documentation/plugins.mdx
apps/docs/guides/use-built-in-plugins.mdx
apps/docs/guides/build-plugin-or-middleware.mdx
apps/docs/guides/build-plugins.mdx
apps/docs/reference/built-in-plugins.mdx
EOF
}

print_transports() {
  cat <<'EOF'
packages/redop/src/transports/http.ts
packages/redop/src/transports/stdio.ts
packages/redop/src/transports/sse.ts
packages/redop/src/redop.ts
apps/docs/documentation/listening-and-transports.mdx
apps/docs/concepts/transports.mdx
apps/docs/reference/listen-options.mdx
apps/docs/reference/http-transport.mdx
apps/docs/guides/debug-http.mdx
EOF
}

print_examples() {
  cat <<'EOF'
packages/redop/examples/basic.ts
packages/redop/examples/modules.ts
packages/redop/examples/with-zod.ts
packages/redop/examples/plugins.ts
apps/docs/examples/index.mdx
apps/docs/examples/basic.mdx
apps/docs/examples/modules.mdx
apps/docs/examples/with-zod.mdx
apps/docs/examples/plugins.mdx
EOF
}

print_tests() {
  cat <<'EOF'
packages/redop/tests/redop.validation.test.ts
packages/redop/tests/prompt-argument-types.ts
packages/redop/tests/resource-template-types.ts
EOF
}

print_review() {
  cat <<'EOF'
1. Read the changed code in packages/redop or packages/create-redop-app.
2. Check matching examples and tests.
3. Check package README drift.
4. Check matching pages in apps/docs and apps/docs/docs.json when nav changed.
5. Verify focused commands before broader checks.
EOF
}

area="${1:-all}"

case "$area" in
  framework) print_framework ;;
  docs) print_docs ;;
  scaffolder|cli) print_scaffolder ;;
  plugins|auth) print_plugins ;;
  transports) print_transports ;;
  examples) print_examples ;;
  tests) print_tests ;;
  review) print_review ;;
  all)
    cat <<'EOF'
framework:
EOF
    print_framework
    printf '\n'
    cat <<'EOF'
docs:
EOF
    print_docs
    printf '\n'
    cat <<'EOF'
scaffolder:
EOF
    print_scaffolder
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
