import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import type { HandlerOptions } from "../types";
import type { Redop } from "../redop";
import type { HttpFetch } from "../transports/runtime";

export type NodeListenOptions = HandlerOptions & {
  hostname?: string;
  port?: number | string;
  onListen?: (info: { hostname: string; port: number; url: string }) => void;
};

/**
 * Convert a Node `IncomingMessage` into a Web `Request`.
 */
export async function incomingMessageToRequest(
  req: IncomingMessage,
  opts: { hostname?: string; port?: number; protocol?: string } = {}
): Promise<Request> {
  const protocol = opts.protocol ?? "http";
  const host =
    req.headers.host ??
    `${opts.hostname ?? "127.0.0.1"}${opts.port ? `:${opts.port}` : ""}`;
  const url = `${protocol}://${host}${req.url ?? "/"}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else {
      headers.set(key, value);
    }
  }

  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";

  if (!hasBody) {
    return new Request(url, { method, headers });
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const body = Buffer.concat(chunks);

  return new Request(url, {
    method,
    headers,
    body: body.byteLength > 0 ? body : undefined,
  });
}

/**
 * Write a Web `Response` to a Node `ServerResponse`.
 */
export async function writeNodeResponse(
  webResponse: Response,
  res: ServerResponse
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
export function toNodeListener(
  app: Redop,
  opts: HandlerOptions = {}
): (req: IncomingMessage, res: ServerResponse) => void {
  const handler = app.handler(opts);
  return (req, res) => {
    void (async () => {
      try {
        const request = await incomingMessageToRequest(req);
        const response = await handler(request);
        await writeNodeResponse(response, res);
      } catch (error) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end(
            error instanceof Error ? error.message : "Internal Server Error"
          );
        } else {
          res.destroy(error instanceof Error ? error : undefined);
        }
      }
    })();
  };
}

/**
 * Alias for `toNodeListener`.
 */
export function toNodeHandler(
  app: Redop,
  opts: HandlerOptions = {}
): (req: IncomingMessage, res: ServerResponse) => void {
  return toNodeListener(app, opts);
}

/**
 * Start a Node HTTP server for a Redop app.
 *
 * Long-lived Node process — `afterResponse` uses microtasks (same as Bun).
 */
export function listenNode(
  app: Redop,
  opts: NodeListenOptions = {}
): Server {
  const port = Number(opts.port ?? 3000);
  const hostname = opts.hostname ?? "127.0.0.1";
  const mcpPath = opts.path ?? "/mcp";
  const listener = toNodeListener(app, opts);

  const server = createServer(listener);
  server.listen(port, hostname, () => {
    const url = `http://${hostname}:${port}${mcpPath}`;
    opts.onListen?.({ hostname, port, url });
  });

  return server;
}

/**
 * Expose the portable fetch handler for Node runtimes that already speak Fetch
 * (e.g. undici-based hosts).
 */
export function toNodeFetch(
  app: Redop,
  opts: HandlerOptions = {}
): HttpFetch {
  return app.handler(opts);
}
