/**
 * Durable message delivery helpers.
 *
 * Trust model: a WebSocket send() returning TRUE proves only that the frame
 * was BUFFERED — not that the server received or persisted it. The only
 * trustworthy persistence signals are:
 *   1. a message:new echo carrying OUR clientMsgId (the hub emits it after
 *      the INSERT, so its arrival proves durability), or
 *   2. the REST POST response (the persisted row itself).
 *
 * waitForMessageEcho() implements (1) with a timeout; the caller falls back
 * to (2). Retries are safe server-side: (sender, client_msg_id) is unique
 * (migration 003), so a REST retry after a lost-but-persisted WS frame
 * returns the ORIGINAL row instead of duplicating it.
 */
import type { MedikaSocket } from "@/lib/ws/socket";

/** How long to wait for the persisted echo before falling back to REST.
 *  Generous for high-latency mobile networks, short enough to feel responsive. */
export const ECHO_TIMEOUT_MS = 8_000;

/**
 * Resolve TRUE when a message:new event carrying `clientMsgId` arrives on the
 * socket (the sender's echo — emitted only AFTER server-side persistence).
 * Resolves FALSE on timeout. Always unsubscribes; never rejects.
 */
export function waitForMessageEcho(
  socket: Pick<MedikaSocket, "onEvent">,
  clientMsgId: string,
  timeoutMs: number = ECHO_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let off: (() => void) | null = null;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        off?.();
      } catch {
        /* listener already gone */
      }
      resolve(ok);
    };
    try {
      off = socket.onEvent((event) => {
        if (
          event.type === "message:new" &&
          (event as { clientMsgId?: unknown }).clientMsgId === clientMsgId
        ) {
          finish(true);
        }
      });
    } catch {
      // Broken listener registration: never reject — the caller falls back
      // to the REST path, which carries its own persisted evidence.
      finish(false);
      return;
    }
    timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
  });
}

/** Monotonic merge of a REST-returned (already persisted) message into a
 *  list without duplicating by id — used when REST was the winning path. */
export function mergePersistedMessage<T extends { id: number }>(list: T[], msg: T): T[] {
  if (list.some((m) => m.id === msg.id)) return list;
  const next = [...list, msg];
  next.sort((a, b) => a.id - b.id);
  return next;
}
