import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { generateProject } from "../src/generator";
import type { ResolvedOptions } from "../src/types";

const TEST_DIR = path.resolve(process.cwd(), "temp-test-app");

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
describe("Generator Logic", () => {
  // Clean up before and after tests
  const cleanup = async () => {
    if (await exists(TEST_DIR)) {
      await rm(TEST_DIR, { force: true, recursive: true });
    }
  };

  beforeAll(cleanup);
  afterAll(cleanup);

  test("should generate core files for a standard http app", async () => {
    const options: ResolvedOptions = {
      appName: "test-app",
      components: ["tools", "resources", "prompts"],
      deploy: "none",
      packageManager: "bun",
      schemaLibrary: "zod",
      targetDir: TEST_DIR,
      template: "standard",
      transport: "http",
    };

    // We skip the 'execa' install part in tests to keep them fast
    // You can mock the install or just test the file generation
    await generateProject(options);

    // Assert files exist
    expect(await exists(path.join(TEST_DIR, "package.json"))).toBe(true);
    expect(await exists(path.join(TEST_DIR, "src/index.ts"))).toBe(true);
    expect(await exists(path.join(TEST_DIR, "tsconfig.json"))).toBe(true);

    const source = await readFile(path.join(TEST_DIR, "src/index.ts"), "utf8");
    expect(source.includes('.tool("ping"')).toBe(true);
    expect(source.includes('.resource("app://status"')).toBe(true);
    expect(source.includes('.prompt("summarise_status"')).toBe(true);
  });

  test("should generate a json-schema based tool starter without zod", async () => {
    const options: ResolvedOptions = {
      appName: "json-schema-app",
      components: ["tools"],
      deploy: "none",
      packageManager: "bun",
      schemaLibrary: "json-schema",
      targetDir: TEST_DIR,
      template: "standard",
      transport: "http",
    };

    await generateProject(options);

    const pkg = await readFile(path.join(TEST_DIR, "package.json"), "utf8");
    const source = await readFile(path.join(TEST_DIR, "src/index.ts"), "utf8");

    expect(pkg.includes('"zod"')).toBe(false);
    expect(source.includes('import { z } from "zod";')).toBe(false);
    expect(source.includes('type: "object"')).toBe(true);
  });

  test("should generate a valibot based tool starter", async () => {
    const options: ResolvedOptions = {
      appName: "valibot-app",
      components: ["tools"],
      deploy: "none",
      packageManager: "bun",
      schemaLibrary: "valibot",
      targetDir: TEST_DIR,
      template: "standard",
      transport: "http",
    };

    await generateProject(options);

    const pkg = await readFile(path.join(TEST_DIR, "package.json"), "utf8");
    const source = await readFile(path.join(TEST_DIR, "src/index.ts"), "utf8");

    expect(pkg.includes('"valibot"')).toBe(true);
    expect(source.includes('import * as v from "valibot";')).toBe(true);
    expect(source.includes("v.object({")).toBe(true);
    expect(source.includes('import { z } from "zod";')).toBe(false);
  });

  test("should generate a typebox based tool starter", async () => {
    const options: ResolvedOptions = {
      appName: "typebox-app",
      components: ["tools"],
      deploy: "none",
      packageManager: "bun",
      schemaLibrary: "typebox",
      targetDir: TEST_DIR,
      template: "standard",
      transport: "http",
    };

    await generateProject(options);

    const pkg = await readFile(path.join(TEST_DIR, "package.json"), "utf8");
    const source = await readFile(path.join(TEST_DIR, "src/index.ts"), "utf8");

    expect(pkg.includes('"@sinclair/typebox"')).toBe(true);
    expect(
      source.includes('import { Type } from "@sinclair/typebox";')
    ).toBe(true);
    expect(source.includes("Type.Object({")).toBe(true);
    expect(source.includes('import { z } from "zod";')).toBe(false);
  });

  test("should ignore schema-library-specific starter code when tools are not selected", async () => {
    const options: ResolvedOptions = {
      appName: "resource-prompt-app",
      components: ["resources", "prompts"],
      deploy: "none",
      packageManager: "bun",
      schemaLibrary: "valibot",
      targetDir: TEST_DIR,
      template: "standard",
      transport: "http",
    };

    await generateProject(options);

    const pkg = await readFile(path.join(TEST_DIR, "package.json"), "utf8");
    const source = await readFile(path.join(TEST_DIR, "src/index.ts"), "utf8");

    expect(pkg.includes('"valibot"')).toBe(false);
    expect(source.includes('import * as v from "valibot";')).toBe(false);
    expect(source.includes('.tool("ping"')).toBe(false);
    expect(source.includes('.resource("app://status"')).toBe(true);
    expect(source.includes('.prompt("summarise_status"')).toBe(true);
  });

  test("should generate a vercel adapter starter", async () => {
    const options: ResolvedOptions = {
      appName: "vercel-app",
      components: ["tools"],
      deploy: "vercel",
      packageManager: "bun",
      schemaLibrary: "zod",
      targetDir: TEST_DIR,
      template: "standard",
      transport: "http",
    };

    await generateProject(options);

    expect(await exists(path.join(TEST_DIR, "api/index.ts"))).toBe(true);
    expect(await exists(path.join(TEST_DIR, "vercel.json"))).toBe(true);

    const source = await readFile(path.join(TEST_DIR, "api/index.ts"), "utf8");
    const pkg = await readFile(path.join(TEST_DIR, "package.json"), "utf8");

    expect(source.includes('from "@redopjs/redop/vercel"')).toBe(true);
    expect(source.includes("vercel(app")).toBe(true);
    expect(pkg.includes('"@vercel/functions"')).toBe(true);
  });

  test("should generate a cloudflare workers starter", async () => {
    const options: ResolvedOptions = {
      appName: "cf-app",
      components: ["tools"],
      deploy: "cloudflare",
      packageManager: "bun",
      schemaLibrary: "zod",
      targetDir: TEST_DIR,
      template: "standard",
      transport: "http",
    };

    await generateProject(options);

    expect(await exists(path.join(TEST_DIR, "wrangler.jsonc"))).toBe(true);
    const source = await readFile(path.join(TEST_DIR, "src/index.ts"), "utf8");
    const wrangler = await readFile(path.join(TEST_DIR, "wrangler.jsonc"), "utf8");
    expect(source.includes('from "@redopjs/redop/cloudflare"')).toBe(true);
    expect(source.includes("cloudflare(app")).toBe(true);
    expect(wrangler.includes('"main": "src/index.ts"')).toBe(true);
    expect(wrangler.includes('"nodejs_compat"')).toBe(true);
  });

  test("should generate an unkey docker starter", async () => {
    const options: ResolvedOptions = {
      appName: "unkey-app",
      components: ["tools"],
      deploy: "unkey",
      packageManager: "bun",
      schemaLibrary: "zod",
      targetDir: TEST_DIR,
      template: "standard",
      transport: "http",
    };

    await generateProject(options);

    expect(await exists(path.join(TEST_DIR, "Dockerfile"))).toBe(true);
    const dockerfile = await readFile(path.join(TEST_DIR, "Dockerfile"), "utf8");
    const source = await readFile(path.join(TEST_DIR, "src/index.ts"), "utf8");
    const readme = await readFile(path.join(TEST_DIR, "README.md"), "utf8");

    expect(dockerfile.includes("--compile")).toBe(true);
    expect(dockerfile.includes("EXPOSE 8080")).toBe(true);
    expect(dockerfile.includes("redop-server")).toBe(true);
    expect(source.includes("process.env.PORT ?? 8080")).toBe(true);
    expect(source.includes("health: true")).toBe(true);
    expect(readme.includes("unkey deploy")).toBe(true);
    expect(readme.includes("## Deploy on Unkey")).toBe(true);
  });
});
