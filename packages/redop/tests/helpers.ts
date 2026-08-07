import { PROTOCOL_LATEST } from "../src/transports/protocol";
import type { Redop } from "../src/index";

export function mcpRequest(
  method: string,
  opts: {
    args?: Record<string, unknown>;
    bodyParams?: Record<string, unknown>;
    headers?: Record<string, string>;
    name?: string;
    path?: string;
    protocolVersion?: string;
  } = {}
) {
  const protocolVersion = opts.protocolVersion ?? PROTOCOL_LATEST;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "mcp-protocol-version": protocolVersion,
    "mcp-method": method,
    ...opts.headers,
  };
  if (opts.name) {
    headers["mcp-name"] = opts.name;
  }

  let params: Record<string, unknown> = opts.bodyParams ?? {};
  if (method === "tools/call") {
    params = {
      name: opts.name,
      arguments: opts.args ?? {},
      ...opts.bodyParams,
    };
  } else if (method === "resources/read") {
    params = { uri: opts.name, ...opts.bodyParams };
  } else if (method === "prompts/get") {
    params = {
      name: opts.name,
      arguments: opts.args ?? {},
      ...opts.bodyParams,
    };
  } else if (
    method === "tasks/cancel" ||
    method === "tasks/get" ||
    method === "tasks/result" ||
    method === "tasks/update"
  ) {
    params = {
      taskId: opts.name,
      ...opts.bodyParams,
    };
  }

  return new Request(`http://localhost${opts.path ?? "/mcp"}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
}

export async function callHandler(
  app: Redop,
  method: string,
  opts: Parameters<typeof mcpRequest>[1] = {},
  handlerOpts: Parameters<Redop["handler"]>[0] = { health: true }
) {
  const handler = app.handler(handlerOpts);
  const response = await handler(mcpRequest(method, opts));
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

export function b64url(input: string | ArrayBuffer) {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function signHs256Jwt(
  payload: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }
) {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${h}.${p}`)
  );
  return `${h}.${p}.${b64url(sig)}`;
}
