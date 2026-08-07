// ─────────────────────────────────────────────
//  redop — Internal SSE mechanics
// ─────────────────────────────────────────────

const enc = new TextEncoder();

export type SubscriptionFilter = {
  promptsListChanged?: boolean;
  resourcesListChanged?: boolean;
  toolsListChanged?: boolean;
};

type StreamEntry = {
  ctrl: ReadableStreamDefaultController<Uint8Array>;
  filter?: SubscriptionFilter;
};

export function encodeSse(
  data: unknown,
  init: {
    id?: string;
    event?: string;
    retry?: number;
  } = {}
): Uint8Array {
  const lines: string[] = [];
  if (init.id) {
    lines.push(`id: ${init.id}`);
  }
  if (init.event) {
    lines.push(`event: ${init.event}`);
  }
  if (init.retry != null) {
    lines.push(`retry: ${init.retry}`);
  }

  const payload = typeof data === "string" ? data : JSON.stringify(data ?? "");
  for (const line of payload.split("\n")) {
    lines.push(`data: ${line}`);
  }

  return enc.encode(`${lines.join("\n")}\n\n`);
}

function notificationMatchesFilter(
  payload: unknown,
  filter: SubscriptionFilter | undefined
): boolean {
  if (!filter) {
    // Legacy session streams (no filter) receive everything.
    return true;
  }
  const method =
    payload &&
    typeof payload === "object" &&
    "method" in payload &&
    typeof (payload as { method?: unknown }).method === "string"
      ? (payload as { method: string }).method
      : undefined;

  if (!method) {
    return true;
  }

  if (method === "notifications/tools/list_changed") {
    return Boolean(filter.toolsListChanged);
  }
  if (method === "notifications/prompts/list_changed") {
    return Boolean(filter.promptsListChanged);
  }
  if (method === "notifications/resources/list_changed") {
    return Boolean(filter.resourcesListChanged);
  }
  // Resource updated and progress always allowed when subscribed via URI map.
  return true;
}

export class SseHub {
  // streamKey (sessionId or subscriptionId) -> active stream controllers
  private streams = new Map<string, Set<StreamEntry>>();
  private heartbeats = new Map<string, ReturnType<typeof setInterval>>();

  public open(
    sessionId: string,
    _lastEventId: string | null,
    options?: {
      filter?: SubscriptionFilter;
      onOpen?: (ctrl: ReadableStreamDefaultController<Uint8Array>) => void;
    }
  ): { stream: ReadableStream<Uint8Array> } {
    // Capture ctrl outside the ReadableStream constructor so cancel() can reference it.
    // start() fires synchronously before open() returns, so this is always assigned.
    let entry!: StreamEntry;

    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        entry = { ctrl: c, filter: options?.filter };

        let sessionStreams = this.streams.get(sessionId);
        if (!sessionStreams) {
          sessionStreams = new Set();
          this.streams.set(sessionId, sessionStreams);

          // One shared heartbeat per session, shared across concurrent streams.
          const timer = setInterval(() => {
            const streams = this.streams.get(sessionId);
            if (!streams) {
              return;
            }
            for (const sc of streams) {
              try {
                sc.ctrl.enqueue(enc.encode(": keep-alive\n\n"));
              } catch {
                // Dead controller — will be pruned on next send() or cancel()
              }
            }
          }, 15_000);
          this.heartbeats.set(sessionId, timer);
        }

        sessionStreams.add(entry);

        // 2025-11-25 spec: priming comment + retry hint.
        // A SSE comment (: …) keeps proxies alive without firing a client
        // `message` event. We also advertise a retry backoff here.
        c.enqueue(encodeSse("", { id: crypto.randomUUID(), retry: 5000 }));
        options?.onOpen?.(c);
      },

      cancel: () => {
        const sessionStreams = this.streams.get(sessionId);
        if (!sessionStreams) {
          return;
        }

        sessionStreams.delete(entry);

        if (sessionStreams.size === 0) {
          this.streams.delete(sessionId);
          const timer = this.heartbeats.get(sessionId);
          if (timer !== undefined) {
            clearInterval(timer);
            this.heartbeats.delete(sessionId);
          }
        }
      },
    });

    return { stream };
  }

  /**
   * Send a payload to a session.
   *
   * The spec says the server MUST choose one stream per message, not broadcast.
   * We walk the Set in insertion order and use the first live controller,
   * pruning dead ones as we go. Returns false only when no live stream exists.
   */
  public send(
    sessionId: string,
    payload: unknown,
    options?: { event?: string; id?: string }
  ): boolean {
    const sessionStreams = this.streams.get(sessionId);
    if (!sessionStreams || sessionStreams.size === 0) {
      return false;
    }

    const chunk = encodeSse(payload, {
      id: options?.id ?? crypto.randomUUID(),
      event: options?.event,
    });

    for (const sc of sessionStreams) {
      if (!notificationMatchesFilter(payload, sc.filter)) {
        continue;
      }
      try {
        sc.ctrl.enqueue(chunk);
        return true;
      } catch {
        // Controller is closed/errored — prune and try the next one.
        sessionStreams.delete(sc);
      }
    }

    return false;
  }

  /**
   * Fan out a notification to every open stream whose subscription filter
   * accepts it. Used for 2026-07-28 `subscriptions/listen` streams.
   */
  public broadcastFiltered(
    payload: unknown,
    options?: { event?: string; id?: string }
  ): void {
    for (const sid of [...this.streams.keys()]) {
      this.send(sid, payload, options);
    }
  }

  public hasSession(sessionId: string): boolean {
    const s = this.streams.get(sessionId);
    return s !== undefined && s.size > 0;
  }

  public closeSession(sessionId: string): void {
    const sessionStreams = this.streams.get(sessionId);
    if (!sessionStreams) {
      return;
    }

    for (const sc of sessionStreams) {
      try {
        sc.ctrl.close();
      } catch {}
    }

    this.streams.delete(sessionId);

    const timer = this.heartbeats.get(sessionId);
    if (timer !== undefined) {
      clearInterval(timer);
      this.heartbeats.delete(sessionId);
    }
  }

  public closeAll(): void {
    // Snapshot keys so we're not mutating while iterating.
    for (const sid of [...this.streams.keys()]) {
      this.closeSession(sid);
    }
  }
}
