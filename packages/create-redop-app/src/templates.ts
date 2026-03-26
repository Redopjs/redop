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
  return JSON.stringify(
    {
      dependencies: {
        "@useagents/redop": "latest",
        ...schemaDeps,
      },
      devDependencies: {
        "@types/bun": "latest",
        typescript: "latest",
      },
      name: toPackageName(options.appName),
      private: true,
      scripts: {
        dev: "bun run --watch src/index.ts",
        start: "bun run src/index.ts",
        typecheck: "tsc --noEmit",
      },
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
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        moduleDetection: "force",
        allowJs: true,

        strict: true,
        noUncheckedIndexedAccess: true,
        noImplicitOverride: true,
        skipLibCheck: true,

        // Bun handles the "emit", so we just type-check
        noEmit: true,

        // Standard for modern Bun/Bundler setups
        allowImportingTsExtensions: true,
        verbatimModuleSyntax: true,

        outDir: "./dist",
      },
      exclude: ["node_modules", "dist"],
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
    input: ${renderToolInput(options.schemaLibrary)},
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

  const listenBlock =
    options.transport === "stdio"
      ? `  .listen({
    transport: "stdio",
  });`
      : `  .listen({
    port: Number(process.env.PORT ?? 3000),
    hostname: "0.0.0.0",
    cors: true,
    onListen: ({ url }) => {
      console.log(\`Redop is running at \${url}\`);
    },
  });`;

  return `
import { Redop } from "@useagents/redop";
${schemaImport(options.schemaLibrary, components)}

new Redop({
  name: "${toServerName(options.appName)}",
  version: "0.1.0",
})
${chain}
${listenBlock}
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

function renderWarnings(options: ResolvedOptions) {
  const warnings: string[] = [];

  if (options.transport === "stdio" && options.deploy !== "none") {
    warnings.push(
      `This starter uses stdio, but the "${options.deploy}" preset is not the normal hosted production shape for stdio apps.`
    );
  }

  if (options.transport === "http" && options.deploy === "vercel") {
    warnings.push(
      "Vercel is not a drop-in host for the default long-running Redop HTTP server shape."
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

This preset adds \`vercel.json\`, but Vercel uses a function model. Treat this as a starting point, not a drop-in match for the default Redop server shape.

Read this first:

- https://redop.useagents.site/docs/guides/deploy/vercel`;
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

  const transportBlock =
    options.transport === "http"
      ? `## Run

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
  const files: GeneratedFile[] = [
    { content: renderGitignore(), path: ".gitignore" },
    { content: renderReadme(options), path: "README.md" },
    { content: renderPackageJson(options) + "\n", path: "package.json" },
    { content: renderTsconfig() + "\n", path: "tsconfig.json" },
    { content: renderIndexTs(options), path: "src/index.ts" },
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

  return files;
}
