#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";

import packageJson from "../package.json";
import { assertEmptyTargetDir } from "./files";
import { generateProject } from "./generator";
import { runPrompts } from "./prompt";

const program = new Command();

program
  .name("create-redop-app")
  .version(packageJson.version)
  .argument("[dir]", "Target directory")
  .option("-t, --transport <type>", "transport type (http, stdio)")
  .option(
    "-c, --components <items>",
    "comma-separated starter components (tools, resources, prompts)"
  )
  .option(
    "-s, --schema <library>",
    "schema library (zod, json-schema, valibot, typebox)"
  )
  .option(
    "-d, --deploy <target>",
    "deployment target (railway, fly-io, vercel, none)"
  )
  .action(async (dir, options) => {
    console.log(chalk.cyan(`${packageJson.name}@${packageJson.version}`));

    const config = await runPrompts(dir, options);
    await assertEmptyTargetDir(config.targetDir);
    await generateProject(config);
  });

program.parse(process.argv);
