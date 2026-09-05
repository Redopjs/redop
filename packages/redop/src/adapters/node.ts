import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import {
  createSecureServer as createHttp2SecureServer,
  createServer as createHttp2Server,
  type Http2ServerRequest,
  type Http2ServerResponse,
} from "node:http2";
import { Readable } from "node:stream";
import type { HandlerOptions, ListenOptions, TlsOptions } from "../types";
import type { Redop } from "../redop";
import type { HttpFetch } from "../transports/runtime";

export type NodeIncoming = IncomingMessage | Http2ServerRequest;
export type NodeOutgoing = ServerResponse | Http2ServerResponse;

export type NodeListenOptions = HandlerOptions &
  Pick<
    ListenOptions,
    | "hostname"
    | "port"
    | "tls"
    | "http1"
    | "http2"
    | "unix"
    | "reusePort"
    | "idleTimeout"
  > & {
    onListen?: (info: { hostname: string; port: number; url: string }) => void;
  };

function tlsToNode(tls: TlsOptions): { key: Buffer | string; cert: Buffer | string } {
  const toNodeSecret = (value: TlsOptions["key"] | TlsOptions["cert"]) => {
    if (value === undefined) {
      throw new Error("[redop:node] tls.key and tls.cert are required");
    }
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" || Buffer.isBuffer(first)) {
      return first;
    }
    if (first && typeof first === "object") {
      return Buffer.from(first as unknown as ArrayBuffer);
    }
    throw new Error(
      "[redop:node] tls.key / tls.cert must be a string or Buffer"
    );
  };
  return { key: toNodeSecret(tls.key), cert: toNodeSecret(tls.cert) };
}

/**
 * Convert a Node `IncomingMessage` into a Web `Request`.
 */
export async function incomingMessageToRequest(
  req: NodeIncoming,
  opts: {
    hostname?: string;
    port?: number;
    protocol?: string;
    maxBodySize?: number;
  } = {}
): Promise<Request> {
  const encrypted =
    "encrypted" in req.socket && Boolean(req.socket.encrypted);
  const protocol = opts.protocol ?? (encrypted ? "https" : "http");
  const host =
    req.headers.host ??
    (typeof req.headers[":authority"] === "string"
      ? req.headers[":authority"]
      : undefined) ??
    `${opts.hostname ?? "127.0.0.1"}${opts.port ? `:${opts.port}` : ""}`;
  const url = `${protocol}://${host}${req.url ?? "/"}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key.startsWith(":")) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else {
      headers.set(key, String(value));
    }
  }

  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";

  if (!hasBody) {
    return new Request(url, { method, headers });
  }

  const maxBodySize = opts.maxBodySize;
  const declared = Number(req.headers["content-length"] ?? NaN);
  if (
    maxBodySize !== undefined &&
    Number.isFinite(declared) &&
    declared > maxBodySize
  ) {
    const err = new Error("Payload Too Large");
    (err as Error & { status: number }).status = 413;
    throw err;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buf.byteLength;
    if (maxBodySize !== undefined && size > maxBodySize) {
      const err = new Error("Payload Too Large");
      (err as Error & { status: number }).status = 413;
      throw err;
    }
    chunks.push(buf);
  }
  const body = Buffer.concat(chunks);

  return new Request(url, {
    method,
    headers,
    body: body.byteLength > 0 ? new Uint8Array(body) : undefined,
  });
}

/**
 * Write a Web `Response` to a Node `ServerResponse`.
 */
export async function writeNodeResponse(
  webResponse: Response,
  res: NodeOutgoing
): Promise<void> {
  res.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => {
    // Node handles set-cookie specially; append individually if needed.
    if (key.toLowerCase() === "set-cookie") {
      const existing = res.getHeader("set-cookie");
      if (!existing) {
        res.setHeader("set-cookie", value);
      } else if (Array.isArray(existing)) {
        res.setHeader("set-cookie", [...existing, value]);
      } else {
        res.setHeader("set-cookie", [String(existing), value]);
      }
      return;
    }
    res.setHeader(key, value);
  });

  if (!webResponse.body) {
    res.end();
    return;
  }

  const readable = Readable.fromWeb(
    webResponse.body as unknown as import("node:stream/web").ReadableStream
  );
  await new Promise<void>((resolve, reject) => {
    readable.pipe(res);
    readable.on("error", reject);
    res.on("finish", () => resolve());
    res.on("close", () => resolve());
  });
}

/**
 * Create a Node `(req, res) => void` listener from a Redop app.
 */
export function nodeListener(
  app: Redop,
  opts: HandlerOptions = {}
): (req: NodeIncoming, res: NodeOutgoing) => void {
  const handler = app.handler(opts);
  return (req, res) => {
    void (async () => {
      try {
        const request = await incomingMessageToRequest(req, {
          maxBodySize: opts.maxBodySize,
        });
        const response = await handler(request);
        await writeNodeResponse(response, res);
      } catch (error) {
        const status =
          error &&
          typeof error === "object" &&
          "status" in error &&
          typeof (error as { status: unknown }).status === "number"
            ? (error as { status: number }).status
            : 500;
        if (!res.headersSent) {
          res.statusCode = status;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end(
            error instanceof Error
              ? error.message
              : status === 413
                ? "Payload Too Large"
                : "Internal Server Error"
          );
        } else {
          res.destroy(error instanceof Error ? error : undefined);
        }
      }
    })();
  };
}

/**
 * Alias for {@link nodeListener}.
 */
export const toNodeListener = nodeListener;

/**
 * Alias for {@link nodeListener}.
 */
export const toNodeHandler = nodeListener;

/**
 * Start a Node HTTP server for a Redop app.
 *
 * Long-lived Node process — `afterResponse` uses microtasks (same as Bun).
 *
 * @example
 * ```ts
 * import { Redop } from "@redopjs/redop"
 * import { listenNode } from "@redopjs/redop/node"
 *
 * const app = new Redop({ serverInfo: { name: "node-mcp", version: "0.1.0" } })
 * listenNode(app, { port: 3000, hostname: "0.0.0.0" })
 * ```
 */
export function listenNode(
  app: Redop,
  opts: NodeListenOptions = {}
): Server {
  const port = Number(opts.port ?? 3000);
  const hostname = opts.hostname ?? "127.0.0.1";
  const mcpPath = opts.path ?? "/mcp";
  const listener = nodeListener(app, opts);
  const http2 = opts.http2 ?? Boolean(opts.tls);
  const http1 = opts.http1 ?? true;

  let server: Server;
  const nodeListenerFn = listener as (
    req: IncomingMessage,
    res: ServerResponse
  ) => void;

  if (opts.tls && http2) {
    server = createHttp2SecureServer(
      {
        ...tlsToNode(opts.tls),
        allowHTTP1: http1,
      },
      nodeListenerFn as never
    ) as unknown as Server;
  } else if (opts.tls) {
    server = createHttpsServer(tlsToNode(opts.tls), nodeListenerFn);
  } else if (http2) {
    server = createHttp2Server(nodeListenerFn as never) as unknown as Server;
  } else {
    server = createHttpServer(nodeListenerFn);
  }

  if (opts.idleTimeout !== undefined && "keepAliveTimeout" in server) {
    server.keepAliveTimeout = opts.idleTimeout * 1000;
  }

  const onListening = () => {
    if (opts.unix) {
      opts.onListen?.({
        hostname: "unix",
        port: 0,
        url: `unix:${opts.unix}${mcpPath}`,
      });
      return;
    }
    const address = server.address();
    const boundPort =
      address && typeof address === "object" ? address.port : port;
    const proto = opts.tls ? "https" : "http";
    const url = `${proto}://${hostname}:${boundPort}${mcpPath}`;
    opts.onListen?.({ hostname, port: boundPort, url });
  };

  if (opts.unix) {
    server.listen(
      {
        path: opts.unix,
        ...(opts.reusePort ? { reusePort: true } : {}),
      },
      onListening
    );
  } else {
    server.listen(
      {
        port,
        host: hostname,
        ...(opts.reusePort ? { reusePort: true } : {}),
      },
      onListening
    );
  }

  return server;
}

/**
 * Expose the portable fetch handler for Node runtimes that already speak Fetch
 * (e.g. undici-based hosts).
 */
export function nodeFetch(
  app: Redop,
  opts: HandlerOptions = {}
): HttpFetch {
  return app.handler(opts);
}

/**
 * @deprecated Prefer {@link nodeFetch}. Kept for compatibility.
 */
export const toNodeFetch = nodeFetch;
