/**
 * Optimistic pending-entry state machine (issue #48).
 *
 * Trust model: a pending entry represents a send whose persistence is
 * UNCONFIRMED. The client can miss BOTH persistence signals (the persisted
 * WS echo and the REST response) while the server actually stored the
 * message — the recipient's copy proves this happens on slow networks. The
 * entry therefore must never be silently dropped on a transport failure: it
 * is marked `failed` ("pa t konfime") and reconciled later with the SAME
 * clientMsgId, which the server dedupes ((sender_id, client_msg_id) unique,
 * migration 003): an already-persisted send returns the ORIGINAL row (the
 * bubble merges by id), an unsent one is delivered fresh. Either way the
 * sender's view converges to the server's truth WITHOUT a page refresh and
 * never duplicates.
 */

export interface PendingMessage {
  clientMsgId: string;
  createdAt: number;
  text: string;
  messageType: "text" | "image" | "video" | "voice" | "file";
  fileUrl: string | null;
  fileSize: number | null;
  duration: number | null;
  failed?: boolean;
  /** In-memory File for the retry path (never serialized). */
  fileRef?: File | null;
  /** Already-uploaded attachment reference — a retry skips re-uploading. */
  attachmentRef?: { url: string; size: number } | null;
}

/** Mark an entry unconfirmed ("pa t konfime"). Pure: returns the SAME array
 *  reference when nothing changed so React state updates stay cheap. */
export function markPendingFailed<T extends { clientMsgId: string; failed?: boolean }>(
  list: T[],
  clientMsgId: string,
): T[] {
  let changed = false;
  const next = list.map((p) => {
    if (p.clientMsgId !== clientMsgId || p.failed) return p;
    changed = true;
    return { ...p, failed: true };
  });
  return changed ? next : list;
}

/** Clear the failed flag while a retry is in flight. No-op when absent. */
export function markPendingRetrying<T extends { clientMsgId: string; failed?: boolean }>(
  list: T[],
  clientMsgId: string,
): T[] {
  let changed = false;
  const next = list.map((p) => {
    if (p.clientMsgId !== clientMsgId || !p.failed) return p;
    changed = true;
    return { ...p, failed: false };
  });
  return changed ? next : list;
}

/** Remove a resolved entry. Pure: same reference when the id is absent. */
export function removePending<T extends { clientMsgId: string }>(
  list: T[],
  clientMsgId: string,
): T[] {
  const next = list.filter((p) => p.clientMsgId !== clientMsgId);
  return next.length === list.length ? list : next;
}

/** Whether the PAGE can re-send this entry itself. Voice is excluded — the
 *  recorder owns the clip and its retry flow. Media needs the in-memory File
 *  (a completed upload is referenced by attachmentRef, but the frame send
 *  goes through sendMedia which re-uses it without a second upload). */
export function isReconcilablePending(entry: PendingMessage): boolean {
  if (entry.messageType === "voice") return false;
  if (entry.messageType === "text") return Boolean(entry.text);
  return Boolean(entry.fileRef);
}
