/**
 * Read-receipt state derivation — pure functions over ServerMessage so the
 * chat page stays declarative and the logic stays testable.
 *
 * Trust model: only the persisted `read_at` (REST bootstrap or a
 * messages:read event) proves a read. A WebSocket.send() success proves
 * NOTHING — the minimum trustworthy states are "persisted" (single tick)
 * and "read" (double tick + "Li"). "pending" exists only locally while the
 * optimistic send is unresolved.
 */
import type { ServerMessage, WsMessagesReadEvent } from "../api/types";

export type ReceiptState = "pending" | "sent" | "read";

/**
 * Receipt for one of the viewer's OWN messages; null for other people's
 * messages and for system messages (system bubbles show no ticks).
 */
export function receiptFor(message: ServerMessage, viewerId: string | null | undefined): ReceiptState | null {
  if (!viewerId) return null;
  if (message.sender_id === "system") return null;
  if (message.sender_id !== viewerId) return null;
  return message.read_at != null ? "read" : "sent";
}

/**
 * Apply a messages:read event: set read_at on the affected messages. Only
 * messages the READER did not send can be marked (server-enforced; mirrored
 * here so a malformed event can never fake the viewer's own reads).
 */
export function applyMessagesRead(
  messages: ServerMessage[],
  event: WsMessagesReadEvent,
): ServerMessage[] {
  const ids = new Set(event.messageIds);
  let changed = false;
  const next = messages.map((m) => {
    if (!ids.has(m.id)) return m;
    if (m.sender_id === event.readerId) return m; // reader cannot mark own messages
    if (m.read_at != null) return m; // already read — no regression
    changed = true;
    return { ...m, read_at: event.readAt };
  });
  return changed ? next : messages;
}

/**
 * Ids of incoming messages that still need a mark-read call: from another
 * real participant, not system, not yet read.
 */
export function unreadIncomingIds(messages: ServerMessage[], viewerId: string | null | undefined): number[] {
  if (!viewerId) return [];
  return messages
    .filter((m) => m.sender_id !== viewerId && m.sender_id !== "system" && m.read_at == null)
    .map((m) => m.id);
}

/** Merge a fresh message list (refresh/reconnect) without losing read state:
 *  existing entries (which may carry live receipt updates) win over incoming
 *  duplicates that lack read_at. */
export function mergeMessages(
  existing: ServerMessage[],
  incoming: ServerMessage[],
): ServerMessage[] {
  const byId = new Map<number, ServerMessage>();
  for (const m of incoming) byId.set(m.id, m);
  for (const m of existing) {
    const prev = byId.get(m.id);
    if (!prev) byId.set(m.id, m);
    else if ((prev.read_at ?? null) == null && m.read_at != null) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}
