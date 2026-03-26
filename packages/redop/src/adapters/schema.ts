// ─────────────────────────────────────────────
//  redop — schema adapters
//  Auto-detection + named exports for each library.
//
//  Auto-detected (no config needed):
//    Zod, Valibot, ArkType — all implement Standard Schema V1
//    Plain JSON Schema objects
//
//  Explicit adapters exported from @useagents/redop:
//    typeboxAdapter, valibotAdapter, arktypeAdapter, jsonSchemaAdapter
// ─────────────────────────────────────────────

import type {
  InferSchemaOutput,
  SchemaAdapter,
  StandardSchemaIssue,
  StandardSchemaV1,
} from "../types";

type JsonSchema = Record<string, unknown>;

// ── Type guards ───────────────────────────────

function hasRecordShape(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null;
}

function isStandardSchema(schema: unknown): schema is StandardSchemaV1 {
  if (!(hasRecordShape(schema) && "~standard" in schema)) {
    return false;
  }
  const std = (schema as any)["~standard"];
  return (
    hasRecordShape(std) &&
    typeof std.validate === "function" &&
    std.version === 1
  );
}

function isJsonSchema(schema: unknown): schema is JsonSchema {
  return (
    hasRecordShape(schema) &&
    ("type" in schema ||
      "properties" in schema ||
      "$schema" in schema ||
      "anyOf" in schema ||
      "oneOf" in schema)
  );
}

/**
 * Is this a TypeBox schema (has Kind symbol and a properties/type field)?
 * TypeBox schemas look like JSON Schema but have an internal Kind symbol.
 */
function isTypebox(schema: unknown): boolean {
  if (!hasRecordShape(schema)) {
    return false;
  }
  // TypeBox uses a Symbol.for("TypeBox.Kind") internally
  const kindSym = Symbol.for("TypeBox.Kind");
  return kindSym in schema;
}

async function parseWithTypebox(schema: unknown, input: unknown) {
  try {
    const { Value } = await import("@sinclair/typebox/value" as string);
    const errs = [...(Value as any).Errors(schema, input)];
    if (errs.length > 0) {
      const e = new Error(
        "Validation failed: " + errs.map((x: any) => x.message).join(", ")
      ) as Error & { issues?: unknown[] };
      e.issues = errs;
      throw e;
    }
    return (Value as any).Convert(schema, input);
  } catch {
    // If TypeBox runtime is not available, fall back to pass-through.
    return input;
  }
}

// ── Standard Schema adapter ───────────────────

type StandardSchemaWithJson<S extends StandardSchemaV1 = StandardSchemaV1> =
  S & {
    readonly "~standard": S["~standard"] & {
      readonly jsonSchema: NonNullable<S["~standard"]["jsonSchema"]>;
    };
  };

function hasJsonSchemaSupport<S extends StandardSchemaV1>(
  schema: S
): schema is StandardSchemaWithJson<S> {
  return typeof schema["~standard"].jsonSchema?.input === "function";
}

function createValidationError(issues: readonly StandardSchemaIssue[]) {
  const error = new Error("Validation failed") as Error & {
    issues: readonly StandardSchemaIssue[];
  };
  error.issues = issues;
  return error;
}

/**
 * Generic adapter for any library that implements Standard Schema V1.
 * Works with Zod, Valibot, ArkType, and any other compliant library.
 */
export function standardSchemaAdapter<
  S extends StandardSchemaV1 = StandardSchemaV1,
>(): SchemaAdapter<S, InferSchemaOutput<S>> {
  return {
    async parse(schema, input) {
      const result = await schema["~standard"].validate(input);
      if (result.issues) {
        throw createValidationError(result.issues);
      }
      return result.value as InferSchemaOutput<S>;
    },
    toJsonSchema(schema) {
      if (!hasJsonSchemaSupport(schema)) {
        throw new Error(
          "[redop] Schema provides validation but not JSON Schema generation. " +
            "Pass an explicit schemaAdapter or use the named adapter for your library."
        );
      }
      return schema["~standard"].jsonSchema.input({
        target: "draft-07",
      }) as JsonSchema;
    },
  };
}

/**
 * Named alias for Zod — same as standardSchemaAdapter since Zod 3.24+ implements Standard Schema.
 */
export function zodAdapter<
  S extends StandardSchemaV1 = StandardSchemaV1,
>(): SchemaAdapter<S, InferSchemaOutput<S>> {
  return standardSchemaAdapter<S>();
}

/**
 * Named alias for Valibot — same as standardSchemaAdapter since Valibot implements Standard Schema.
 */
export function valibotAdapter<
  S extends StandardSchemaV1 = StandardSchemaV1,
>(): SchemaAdapter<S, InferSchemaOutput<S>> {
  return standardSchemaAdapter<S>();
}

/**
 * Named alias for ArkType — same as standardSchemaAdapter since ArkType implements Standard Schema.
 */
export function arktypeAdapter<
  S extends StandardSchemaV1 = StandardSchemaV1,
>(): SchemaAdapter<S, InferSchemaOutput<S>> {
  return standardSchemaAdapter<S>();
}

/**
 * Explicit TypeBox adapter.
 * Uses the schema itself as JSON Schema and validates with TypeBox Value when available.
 */
export function typeboxAdapter<
  S extends JsonSchema = JsonSchema,
>(): SchemaAdapter<S, unknown> {
  return {
    toJsonSchema: (schema) => schema,
    parse: (schema, input) => parseWithTypebox(schema, input),
  };
}

/**
 * Plain JSON Schema adapter — no parsing, passes input through as-is.
 * Used when your tool input is already typed at the schema level.
 */
export function jsonSchemaAdapter(): SchemaAdapter<JsonSchema, JsonSchema> {
  return {
    parse: (_schema, input) => input as JsonSchema,
    toJsonSchema: (schema) => schema,
  };
}

/**
 * Auto-detect the schema type and return the appropriate adapter.
 * Called by Redop when no explicit schemaAdapter is configured.
 *
 * Detection order:
 *   1. Standard Schema V1 (Zod ≥3.24, Valibot ≥1.x, ArkType ≥2.x)
 *   2. TypeBox (detected via Symbol.for("TypeBox.Kind"))
 *   3. Plain JSON Schema (has "type", "properties", or "$schema")
 */
export function detectAdapter(schema: unknown): SchemaAdapter {
  if (isStandardSchema(schema)) {
    return standardSchemaAdapter();
  }

  if (isTypebox(schema)) {
    return typeboxAdapter();
  }

  if (isJsonSchema(schema)) {
    return jsonSchemaAdapter();
  }

  throw new Error(
    "[redop] Could not detect schema type. " +
      "Pass a Standard Schema V1-compatible instance, a TypeBox schema, or a plain JSON Schema object. " +
      "Alternatively, pass an explicit schemaAdapter to new Redop({ schemaAdapter })."
  );
}
