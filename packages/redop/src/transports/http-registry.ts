import type {
  CapabilityOptions,
  ListenOptions,
  PromptHandlerResult,
  RequestMeta,
  ResolvedPrompt,
  ResolvedResource,
  ResolvedTool,
  ResourceContents,
  ServerInfoOptions,
} from "../types";
import type { TransportHandle } from "./http-app";

export type BunHttpTransportStarter = (
  tools: Map<string, ResolvedTool>,
  resources: Map<string, ResolvedResource>,
  prompts: Map<string, ResolvedPrompt>,
  runTool: (
    name: string,
    args: Record<string, unknown>,
    meta: RequestMeta
  ) => Promise<
    | { afterResponse: () => Promise<void>; ok: true; result: unknown }
    | { afterResponse: () => Promise<void>; error: unknown; ok: false }
  >,
  readResource: (
    uri: string,
    req: RequestMeta
  ) => Promise<
    | {
        afterResponse: () => Promise<void>;
        ok: true;
        result: ResourceContents;
      }
    | { afterResponse: () => Promise<void>; error: unknown; ok: false }
  >,
  getPrompt: (
    name: string,
    args: Record<string, string> | undefined,
    req: RequestMeta
  ) => Promise<
    | {
        afterResponse: () => Promise<void>;
        ok: true;
        result: PromptHandlerResult;
      }
    | { afterResponse: () => Promise<void>; error: unknown; ok: false }
  >,
  subscribeRes: (uri: string, sid: string) => void,
  unsubscribeRes: (uri: string, sid: string) => void,
  opts: ListenOptions,
  serverInfo: Required<ServerInfoOptions>,
  caps: Required<CapabilityOptions>
) => TransportHandle;

let bunHttpStarter: BunHttpTransportStarter | null = null;

/**
 * Register the Bun `Bun.serve` transport. Called by the main `@redopjs/redop`
 * entry so adapter entrypoints can stay free of Bun imports.
 */
export function registerBunHttpTransport(starter: BunHttpTransportStarter) {
  bunHttpStarter = starter;
}

export function getBunHttpTransport(): BunHttpTransportStarter | null {
  return bunHttpStarter;
}
