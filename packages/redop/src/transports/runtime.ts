// ─────────────────────────────────────────────
//  redop — portable HTTP runtime primitives
// ─────────────────────────────────────────────

/**
 * Platform hooks passed into the portable fetch handler.
 *
 * Long-lived runtimes (Bun/Node) can omit these; serverless/edge adapters
 * should wire `waitUntil` so `afterResponse` work is not dropped.
 */
export type FetchRuntime = {
  /**
   * Disable idle timeouts for long-lived SSE streams.
   * Bun adapters map this to `server.timeout(req, 0)`.
   */
  disableIdleTimeout?: (req: Request) => void;
  /**
   * Keep the isolate alive until the promise settles (Cloudflare `ctx.waitUntil`,
   * Vercel `waitUntil`, etc.).
   */
  waitUntil?: (promise: Promise<unknown>) => void;
};

/**
 * Fetch handler returned by `app.handler()` and runtime adapters.
 */
export type HttpFetch = (
  req: Request,
  runtime?: FetchRuntime
) => Promise<Response>;

/**
 * Schedule `afterResponse` work using the platform primitive when available.
 */
export function scheduleAfterResponse(
  afterResponse: (() => Promise<void>) | undefined,
  runtime?: FetchRuntime,
  onError?: (error: unknown) => void
): void {
  if (!afterResponse) {
    return;
  }

  const work = Promise.resolve()
    .then(() => afterResponse())
    .catch((error) => {
      onError?.(error);
    });

  if (runtime?.waitUntil) {
    runtime.waitUntil(work);
    return;
  }

  queueMicrotask(() => {
    void work;
  });
}
