import type {
  Component,
  DeployTarget,
  GeneratedFile,
  ResolvedOptions,
  SchemaLibrary,
} from "./types";

function toPackageName(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9-_]+/g, "-")
      .replaceAll(/^-+|-+$/g, "") || "redop-app"
  );
}

function toServerName(name: string) {
  return toPackageName(name);
}

function renderPackageJson(options: ResolvedOptions) {
  const components = selectedComponents(options);
  const schemaDeps = schemaDependencies(options.schemaLibrary, components);
  const isCloudflare = options.deploy === "cloudflare";
  const isVercel = options.deploy === "vercel";

  const dependencies: Record<string, string> = {
    "@redopjs/redop": "latest",
    ...schemaDeps,
  };
  if (isVercel) {
    dependencies["@vercel/functions"] = "latest";
  }

  const devDependencies: Record<string, string> = {
    typescript: "latest",
  };
  if (isCloudflare) {
    devDependencies["@cloudflare/workers-types"] = "latest";
    devDependencies.wrangler = "latest";
  } else {
    devDependencies["@types/bun"] = "latest";
  }

  const scripts: Record<string, string> = {
    typecheck: "tsc --noEmit",
  };
  if (isCloudflare) {
    scripts.dev = "wrangler dev src/index.ts";
    scripts.deploy = "wrangler deploy";
  } else if (isVercel) {
    scripts.dev = "vercel dev";
  } else {
    scripts.dev = "bun run --watch src/index.ts";
    if (options.transport === "http") {
      scripts.start = "bun run src/index.ts";
    }
  }

  return JSON.stringify(
    {
      dependencies,
      devDependencies,
      name: toPackageName(options.appName),
      private: true,
      scripts,
      type: "module",
      version: "0.1.0",
    },
    null,
    2
  );
}

function renderTsconfig() {
  return JSON.stringify(
    {
      compilerOptions: {
        // Environment setup & latest features
        lib: ["ESNext"],
        target: "ESNext",
        module: "Preserve",
        moduleDetection: "force",
        allowJs: true,
        types: ["bun"],

        // Bundler mode
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        verbatimModuleSyntax: true,
        noEmit: true,

        // Best practices
        strict: true,
        skipLibCheck: true,
        noFallthroughCasesInSwitch: true,
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,

        // Some stricter flags (disabled by default)
        noUnusedLocals: false,
        noUnusedParameters: false,
        noPropertyAccessFromIndexSignature: false,
      },
      exclude: ["node_modules"],
      include: ["src/**/*"],
    },
    null,
    2
  );
}

function renderGitignore() {
  return ["node_modules", "dist", ".env", ".DS_Store"].join("\n") + "\n";
}

function selectedComponents(options: ResolvedOptions) {
  return new Set<Component>(
    options.components.length ? options.components : ["tools"]
  );
}

function schemaDependencies(
  schemaLibrary: SchemaLibrary,
  components: Set<Component>
) {
  if (!components.has("tools")) {
    return {};
  }

  switch (schemaLibrary) {
    case "valibot":
      return { valibot: "latest" };
    case "typebox":
      return { "@sinclair/typebox": "latest" };
    case "json-schema":
      return {};
    case "zod":
    default:
      return { zod: "latest" };
  }
}

function schemaImport(
  schemaLibrary: SchemaLibrary,
  components: Set<Component>
) {
  if (!components.has("tools")) {
    return "";
  }

  switch (schemaLibrary) {
    case "valibot":
      return `import * as v from "valibot";`;
    case "typebox":
      return `import { Type } from "@sinclair/typebox";`;
    case "json-schema":
      return "";
    case "zod":
    default:
      return `import { z } from "zod";`;
  }
}

function renderToolInput(schemaLibrary: SchemaLibrary) {
  switch (schemaLibrary) {
    case "valibot":
      return `v.object({
      message: v.optional(v.string(), "pong"),
    })`;
    case "typebox":
      return `Type.Object({
      message: Type.Optional(Type.String({ default: "pong" })),
    })`;
    case "json-schema":
      return `{
      type: "object",
      properties: {
        message: { type: "string", default: "pong" },
      },
      additionalProperties: false,
    }`;
    case "zod":
    default:
      return `z.object({
      message: z.string().default("pong"),
    })`;
  }
}

function renderComponentChain(options: ResolvedOptions) {
  const components = selectedComponents(options);
  const blocks: string[] = [];

  if (components.has("tools")) {
    blocks.push(`  .tool("ping", {
    description: "Health check tool",
    inputSchema: ${renderToolInput(options.schemaLibrary)},
    handler: ({ input }) => ({
      ok: true,
      message: input.message,
      ts: Date.now(),
    }),
  })`);
  }

  if (components.has("resources")) {
    blocks.push(`  .resource("app://status", {
    name: "App status",
    mimeType: "application/json",
    handler: async () => ({
      type: "text",
      text: JSON.stringify({
        name: "${toServerName(options.appName)}",
        status: "ok",
        ts: Date.now(),
      }),
    }),
  })`);
  }

  if (components.has("prompts")) {
    blocks.push(`  .prompt("summarise_status", {
    description: "Summarise the current application status",
    arguments: [{ name: "focus", description: "What to focus on" }],
    handler: ({ arguments: args }) => [
      {
        role: "user",
        content: {
          type: "text",
          text: \`Summarise the current app status with a focus on \${args?.focus ?? "overall health"}.\`,
        },
      },
    ],
  })`);
  }

  return blocks.join("\n");
}

function renderIndexTs(options: ResolvedOptions) {
  const components = selectedComponents(options);
  const chain = renderComponentChain(options);
  const schemaLine = schemaImport(options.schemaLibrary, components);
  const schemaBlock = schemaLine ? `${schemaLine}\n` : "";

  if (options.transport === "stdio") {
    return `
import { Redop } from "@redopjs/redop";
${schemaBlock}
new Redop({
  serverInfo: {
    name: "${toServerName(options.appName)}",
    version: "0.1.0",
  },
})
${chain}
  .listen({
    transport: "stdio",
  });
`;
  }

  if (options.deploy === "vercel") {
    return `
import { Redop } from "@redopjs/redop";
import { vercel } from "@redopjs/redop/vercel";
import { waitUntil } from "@vercel/functions";
${schemaBlock}
const app = new Redop({
  serverInfo: {
    name: "${toServerName(options.appName)}",
    version: "0.1.0",
  },
})
${chain};

export default vercel(app, {
  health: true,
  waitUntil,
});
`;
  }

  if (options.deploy === "cloudflare") {
    return `
import { Redop } from "@redopjs/redop";
import { cloudflare } from "@redopjs/redop/cloudflare";
${schemaBlock}
const app = new Redop({
  serverInfo: {
    name: "${toServerName(options.appName)}",
    version: "0.1.0",
  },
})
${chain};

export default cloudflare(app, {
  health: true,
});
`;
  }

  return `
import { Redop } from "@redopjs/redop";
${schemaBlock}
new Redop({
  serverInfo: {
    name: "${toServerName(options.appName)}",
    version: "0.1.0",
  },
})
${chain}
  .listen({
    port: Number(process.env.PORT ?? 3000),
    hostname: "0.0.0.0",
    cors: true,
    onListen: ({ url }) => {
      console.log(\`Redop is running at \${url}\`);
    },
  });
`;
}

function renderDockerfile() {
  return `FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install

COPY . .

EXPOSE 3000

CMD ["bun", "start"]
`;
}

function renderFlyToml(options: ResolvedOptions) {
  const appName = `${toPackageName(options.appName)}-fly`;
  return `app = "${appName}"

[http_service]
  internal_port = 3000
  force_https = true
  auto_start_machines = true
  auto_stop_machines = "stop"
  min_machines_running = 1
`;
}

function renderVercelJson() {
  return JSON.stringify(
    {
      $schema: "https://openapi.vercel.sh/vercel.json",
      bunVersion: "1.x",
    },
    null,
    2
  );
}

function renderWranglerToml(options: ResolvedOptions) {
  const name = toPackageName(options.appName);
  return `name = "${name}"
main = "src/index.ts"
compatibility_date = "2026-03-01"
compatibility_flags = ["nodejs_compat"]
`;
}

function renderWarnings(options: ResolvedOptions) {
  const warnings: string[] = [];

  if (options.transport === "stdio" && options.deploy !== "none") {
    warnings.push(
      `This starter uses stdio, but the "${options.deploy}" preset is not the normal hosted production shape for stdio apps.`
    );
  }

  if (
    options.transport === "http" &&
    (options.deploy === "vercel" || options.deploy === "cloudflare")
  ) {
    warnings.push(
      "This preset uses Redop's portable fetch adapter. Prefer MCP 2026-07-28 (stateless). Long-lived SSE / in-memory sessions are limited on serverless/edge."
    );
  }

  return warnings;
}

function deploySection(deploy: DeployTarget) {
  switch (deploy) {
    case "none": {
      return `## Deploy on Bun runtime

Run this app as a Bun HTTP or stdio service. For HTTP, bind to \`0.0.0.0\`, read \`PORT\` from the environment, and expose the MCP endpoint at \`/mcp\`.

Deployment guide:

- https://redop.useagents.site/docs/guides/deploy/index`;
    }
    case "railway": {
      return `## Deploy on Railway

Use Railway as a long-running Bun service. Set your start command to \`bun start\`. If your service needs a separate health endpoint, enable one explicitly with \`health: true\` or \`health: { path: "/health" }\`.

Step-by-step guide:

- https://redop.useagents.site/docs/guides/deploy/railway`;
    }
    case "fly-io": {
      return `## Deploy on Fly.io

This starter includes a Dockerfile and \`fly.toml\`. Deploy with \`fly launch\` and \`fly deploy\`.

Step-by-step guides:

- https://redop.useagents.site/docs/guides/deploy/fly-io
- https://redop.useagents.site/docs/guides/deploy/docker`;
    }
    case "vercel": {
      return `## Deploy on Vercel

This starter uses \`@redopjs/redop/vercel\` with \`waitUntil\` from \`@vercel/functions\`. Prefer MCP \`2026-07-28\` (stateless).

Step-by-step guide:

- https://redop.useagents.site/docs/guides/deploy/vercel`;
    }
    case "cloudflare": {
      return `## Deploy on Cloudflare Workers

This starter uses \`@redopjs/redop/cloudflare\` and wires \`ctx.waitUntil\` for \`afterResponse\`. Prefer MCP \`2026-07-28\` (stateless).

\`\`\`sh
bunx wrangler deploy
\`\`\`

Step-by-step guide:

- https://redop.useagents.site/docs/guides/deploy/cloudflare`;
    }
    default: {
      return `## Deploy

No deploy files were generated for this starter.

Deployment guide:

- https://redop.useagents.site/docs/guides/deploy/index`;
    }
  }
}

function renderReadme(options: ResolvedOptions) {
  const warnings = renderWarnings(options);
  const components = options.components.length ? options.components : ["tools"];
  const warningBlock =
    warnings.length === 0
      ? ""
      : `## Warnings

${warnings.map((warning) => `- ${warning}`).join("\n")}

`;

  const isAdapterDeploy =
    options.deploy === "vercel" || options.deploy === "cloudflare";

  const transportBlock =
    options.transport === "http"
      ? isAdapterDeploy
        ? `## Run

\`\`\`sh
bun install
bun dev
\`\`\`

This starter exports a portable fetch handler for ${options.deploy}.
The MCP endpoint is \`/mcp\`. Prefer MCP protocol \`2026-07-28\` (stateless).`
        : `## Run

\`\`\`sh
bun install
bun dev
\`\`\`

Your server will listen on \`PORT\` or fall back to \`3000\`.
The MCP endpoint is \`/mcp\`.

Quick initialize check:

\`\`\`sh
curl -X POST http://localhost:3000/mcp \\
  -H 'Content-Type: application/json' \\
  --data '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"manual-check","version":"1.0.0"}}}'
\`\`\``
      : `## Run

\`\`\`sh
bun install
bun dev
\`\`\`

This starter uses stdio transport for local MCP host integrations.`;

  const componentBlock = `## Included in this starter

${components.includes("tools") ? "- A sample tool (`ping`)\n" : ""}${components.includes("resources") ? "- A sample resource (`app://status`)\n" : ""}${components.includes("prompts") ? "- A sample prompt (`summarise_status`)\n" : ""}`;

  return `# ${options.appName}

[![Deploy to Railway](https://img.shields.io/badge/Deploy-Railway-f03603)](https://redop.useagents.site/guides/deploy/railway)
[![Deploy to Fly.io](https://img.shields.io/badge/Deploy-Fly.io-f03603)](https://redop.useagents.site/guides/deploy/fly-io)
[![Docs: Deploy to Production](https://img.shields.io/badge/Docs-Deploy%20to%20Production-111827)](https://redop.useagents.site/guides/deploy/index)

A Redop starter app generated by \`create-redop-app\`.

- transport: \`${options.transport}\`
- deploy target: \`${options.deploy}\`
- schema library: \`${options.schemaLibrary}\`
- components: \`${components.join(", ")}\`

${warningBlock}${transportBlock}

${componentBlock}

${deploySection(options.deploy)}
`;
}

export function buildFiles(options: ResolvedOptions): GeneratedFile[] {
  const entryPath =
    options.deploy === "vercel" ? "api/index.ts" : "src/index.ts";

  const files: GeneratedFile[] = [
    { content: renderGitignore(), path: ".gitignore" },
    { content: renderReadme(options), path: "README.md" },
    { content: renderPackageJson(options) + "\n", path: "package.json" },
    { content: renderTsconfig() + "\n", path: "tsconfig.json" },
    { content: renderIndexTs(options), path: entryPath },
  ];

  if (options.deploy === "fly-io") {
    files.push(
      { content: renderDockerfile(), path: "Dockerfile" },
      { content: renderFlyToml(options), path: "fly.toml" }
    );
  }

  if (options.deploy === "vercel") {
    files.push({ content: renderVercelJson() + "\n", path: "vercel.json" });
  }

  if (options.deploy === "cloudflare") {
    files.push({
      content: renderWranglerToml(options),
      path: "wrangler.toml",
    });
  }

  return files;
}
