import path from "node:path";

import * as p from "@clack/prompts";
import chalk from "chalk";
import type {
  Component,
  DeployTarget,
  ResolvedOptions,
  SchemaLibrary,
  Transport,
} from "./types";
import {
  COMPONENTS,
  DEPLOY_TARGETS,
  SCHEMA_LIBRARIES,
  TRANSPORTS,
} from "./types";

/**
 * Runs the interactive CLI prompts to gather project configuration.
 * @param initialName - The default name or name provided via argument.
 * @param flags - Command line options provided (e.g., via Commander).
 */
export async function runPrompts(
  initialName?: string,
  flags?: {
    transport?: string;
    deploy?: string;
    components?: string;
    schema?: string;
  }
): Promise<ResolvedOptions> {
  const componentFlags =
    flags?.components
      ?.split(",")
      .map((value) => value.trim())
      .filter((value): value is Component =>
        COMPONENTS.includes(value as Component)
      ) ?? [];

  const project = await p.group(
    {
      name: () =>
        p.text({
          message: "What is your project named?",
          placeholder: initialName || "my-redop-app",
          initialValue: initialName || "my-redop-app",
          validate: (value) => {
            if (value?.trim().length === 0) {
              return "Project name cannot be empty";
            }
          },
        }),
      packageManager: () =>
        p.select({
          message: "Select a package manager:",
          initialValue: "bun",
          options: [
            { value: "bun", label: "bun" },
            { value: "npm", label: "npm" },
          ],
        }),
      schemaLibrary: () => {
        if (
          flags?.schema &&
          SCHEMA_LIBRARIES.includes(flags.schema as SchemaLibrary)
        ) {
          return Promise.resolve(flags.schema as SchemaLibrary);
        }

        return p.select({
          message: "Select a schema library:",
          initialValue: "zod",
          options: [
            { value: "zod", label: "Zod", hint: "default" },
            { value: "json-schema", label: "JSON Schema" },
            { value: "valibot", label: "Valibot" },
            { value: "typebox", label: "TypeBox" },
          ],
        });
      },
      components: () =>
        componentFlags.length > 0
          ? Promise.resolve(componentFlags)
          : p.multiselect({
              message: "Select components to initialize:",
              initialValues: ["tools"],
              options: [
                { value: "tools", label: "Tools", hint: "recommended" },
                { value: "resources", label: "Resources" },
                { value: "prompts", label: "Prompts" },
              ],
            }),
      transport: () => {
        // Skip prompt if flag is provided and valid
        if (
          flags?.transport &&
          TRANSPORTS.includes(flags.transport as Transport)
        ) {
          return Promise.resolve(flags.transport as Transport);
        }
        return p.select({
          message: "Select the transport you want to use:",
          options: [
            { value: "http", label: "HTTP (runs on a server)" },
            { value: "stdio", label: "Stdio (local pipe)" },
          ],
        });
      },
      deploy: ({ results }) => {
        // 1. Skip if transport is stdio (local only)
        if (results.transport === "stdio") {
          return Promise.resolve("none" as DeployTarget);
        }
        // 2. Skip if flag is provided and valid
        if (
          flags?.deploy &&
          DEPLOY_TARGETS.includes(flags.deploy as DeployTarget)
        ) {
          return Promise.resolve(flags.deploy as DeployTarget);
        }

        return p.select({
          message: "Select a deployment target:",
          options: [
            { value: "none", label: "None (Manual)" },
            { value: "railway", label: "Railway" },
            { value: "fly-io", label: "Fly.io" },
            { value: "vercel", label: "Vercel" },
          ],
        });
      },
      template: () =>
        p.select({
          message: "Select a template:",
          options: [
            { value: "standard", label: "Default (Standard MCP server)" },
          ],
        }),
      confirm: ({ results }) =>
        p.confirm({
          message: `Creating a new redop app in ${chalk.cyan(
            path.resolve(process.cwd(), results.name as string)
          )}. Ok to continue?`,
        }),
    },
    {
      onCancel: () => {
        p.cancel("Operation cancelled.");
        process.exit(0);
      },
    }
  );

  if (!project.confirm) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }

  return {
    appName: project.name as string,
    components: (() => {
      const selected = (
        (project.components as Component[] | undefined)?.filter((value) =>
          COMPONENTS.includes(value)
        ) as Component[] | undefined
      )?.slice();

      return selected && selected.length > 0 ? selected : ["tools"];
    })(),
    deploy: (project.deploy as DeployTarget) || "none",
    packageManager: project.packageManager as "bun" | "npm",
    schemaLibrary: (project.schemaLibrary as SchemaLibrary) || "zod",
    targetDir: path.resolve(process.cwd(), project.name as string),
    template: project.template as string,
    transport: project.transport as Transport,
  };
}
