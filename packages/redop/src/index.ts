// Register the Bun HTTP transport for `.listen()` before exporting the public API.
import { startHttpTransport } from "./transports/http";
import { registerBunHttpTransport } from "./transports/http-registry";

registerBunHttpTransport(startHttpTransport);

// Core class

export { jwt, oauth } from "./plugins/auth";
// Built-in plugins
export { apiKey, logger } from "./plugins/index";
export { definePlugin, middleware, Redop } from "./redop";

// Types
export type {
  AfterHook,
  AfterResponseHook,
  AfterResponseHookEvent,
  BeforeHook,
  Context,
  CorsOptions,
  ErrorHook,
  HandlerOptions,
  HealthOptions,
  IconMimeType,
  IconSize,
  IconTheme,
  InferSchemaOutput,
  ListenOptions,
  PluginDefinition,
  PluginFactory,
  PluginMeta,
  PromptArgument,
  PromptAfterHook,
  PromptAfterResponseHook,
  PromptAfterResponseHookEvent,
  PromptAfterHookEvent,
  PromptArguments,
  PromptBeforeHook,
  PromptBeforeHookEvent,
  PromptContext,
  PromptDef,
  PromptErrorHook,
  PromptErrorHookEvent,
  PromptGetEvent,
  PromptHandler,
  PromptHandlerResult,
  PromptMessage,
  PromptMiddleware,
  PromptMiddlewareEvent,
  PromptNext,
  RedopOptions,
  RequestMeta,
  ResourceContents,
  ResourceDef,
  ResourceAfterHook,
  ResourceAfterResponseHook,
  ResourceAfterResponseHookEvent,
  ResourceAfterHookEvent,
  ResourceBeforeHook,
  ResourceBeforeHookEvent,
  ResourceContext,
  ResourceErrorHook,
  ResourceErrorHookEvent,
  ResourceHandler,
  ResourceMiddleware,
  ResourceMiddlewareEvent,
  ResourceNext,
  ResourceReadEvent,
  ResourceUriParams,
  ResolvedPrompt,
  ResolvedResource,
  ResolvedTool,
  ServerInfoOptions,
  StandardSchemaIssue,
  StandardSchemaJsonOptions,
  StandardSchemaResultFailure,
  StandardSchemaResultSuccess,
  StandardSchemaV1,
  ToolAfterHook,
  ToolAfterResponseHook,
  ToolAfterResponseHookEvent,
  ToolAfterHookEvent,
  ToolBeforeHook,
  ToolBeforeHookEvent,
  ToolDef,
  ToolHandler,
  ToolHandlerEvent,
  ToolMiddleware,
  ToolMiddlewareEvent,
  ToolNext,
  ToolRequest,
  TransformHook,
  TransportKind,
} from "./types";

export type { FetchRuntime, HttpFetch } from "./transports/runtime";

// Errors
export { McpError, McpErrorCode } from "./types";

// MCP 2026-07-28 MRTR helpers
export {
  InputRequiredError,
  PROTOCOL_LATEST,
  requireInput,
  SUPPORTED_PROTOCOL_VERSIONS,
  TASKS_EXTENSION_ID,
} from "./transports/protocol";
export type {
  InputRequest,
  InputRequests,
  InputResponses,
  SupportedProtocolVersion,
} from "./transports/protocol";
