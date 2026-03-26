export const TRANSPORTS = ["http", "stdio"] as const;
export const DEPLOY_TARGETS = ["none", "railway", "fly-io", "vercel"] as const;
export const COMPONENTS = ["tools", "resources", "prompts"] as const;
export const SCHEMA_LIBRARIES = [
  "zod",
  "json-schema",
  "valibot",
  "typebox",
] as const;

export type Transport = (typeof TRANSPORTS)[number];
export type DeployTarget = (typeof DEPLOY_TARGETS)[number];
export type Component = (typeof COMPONENTS)[number];
export type SchemaLibrary = (typeof SCHEMA_LIBRARIES)[number];

export interface ResolvedOptions {
  appName: string;
  components: Component[];
  deploy: DeployTarget;
  packageManager: "bun" | "npm";
  schemaLibrary: SchemaLibrary;
  targetDir: string;
  template: string;
  transport: Transport;
}

export interface GeneratedFile {
  content: string;
  path: string;
}
