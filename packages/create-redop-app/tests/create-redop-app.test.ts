import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exists, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { generateProject } from "../src/generator";
import type { ResolvedOptions } from "../src/types";

const TEST_DIR = path.resolve(process.cwd(), "temp-test-app");

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
});
