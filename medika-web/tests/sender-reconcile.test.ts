/**
 * Sender-side reconciliation (issue #48) — a sent message whose confirmation
 * was missed (lost WS echo + failed REST fallback on a slow network) must
 * converge to the server's truth WITHOUT a page refresh and never duplicate.
 *
 * Layers tested:
 *  1. PURE: the pending-entry state machine (lib/chat/pending) — failed /
 *     retrying / removed transitions and what the page may re-send.
 *  2. CLIENT CONTRACT: the consultation page keeps the bubble marked
 *     unconfirmed, reconciles with the SAME clientMsgId, sweeps on reconnect,
 *     and retries on a bounded timer — instead of the old drop-bubble +
 *     restore-draft behavior that left the sender stale until refresh.
 *  3. SERVER CONTRACT: the guarantees every retry relies on — the hub echoes
 *     message:new back to the SENDER with the clientMsgId, the REST route
 *     does the same, and createMessage dedupes on (sender_id, client_msg_id)
 *     returning the ORIGINAL row.
 */
import { describe, expect, it } from "vitest";
import {
  isReconcilablePending,
  markPendingFailed,
  markPendingRetrying,
  removePending,
  type PendingMessage,
} from "@/lib/chat/pending";

const fs = await import("node:fs");
const read = (p: string) => fs.readFileSync(p, "utf8");

function entry(overrides: Partial<PendingMessage> = {}): PendingMessage {
  return {
    clientMsgId: "cm-1",
    createdAt: 1_700_000_000,
    text: "Bonjou",
    messageType: "text",
    fileUrl: null,
    fileSize: null,
    duration: null,
    ...overrides,
  };
}

describe("pending state machine (pure)", () => {
  it("markPendingFailed flags exactly the target entry and preserves the rest", () => {
    const list = [entry({ clientMsgId: "a" }), entry({ clientMsgId: "b" })];
    const next = markPendingFailed(list, "b");
    expect(next[0].failed).toBeFalsy();
    expect(next[1].failed).toBe(true);
    expect(next).not.toBe(list); // new array, original untouched
    expect(next[0]).toBe(list[0]); // untouched members keep identity
  });

  it("markPendingFailed is a no-op (same reference) when absent or already failed", () => {
    const once = markPendingFailed([entry()], "cm-1");
    expect(markPendingFailed(once, "cm-1")).toBe(once);
    expect(markPendingFailed([entry()], "other")).toEqual([entry()]);
  });

  it("markPendingRetrying clears the failed flag while a retry runs", () => {
    const failed = markPendingFailed([entry()], "cm-1");
    const retrying = markPendingRetrying(failed, "cm-1");
    expect(retrying[0].failed).toBe(false);
    expect(markPendingRetrying(retrying, "cm-1")).toBe(retrying); // no further churn
  });

  it("removePending drops only the resolved entry", () => {
    const list = [entry({ clientMsgId: "a" }), entry({ clientMsgId: "b" })];
    expect(removePending(list, "a").map((p) => p.clientMsgId)).toEqual(["b"]);
    expect(removePending(list, "zzz")).toBe(list); // absent → same reference
  });

  it("isReconcilablePending: text needs content, media needs the in-memory file, voice is recorder-owned", () => {
    expect(isReconcilablePending(entry({ text: "Bonjou" }))).toBe(true);
    expect(isReconcilablePending(entry({ text: "" }))).toBe(false);
    const file = new File(["x"], "x.png") as File;
    expect(isReconcilablePending(entry({ messageType: "image", text: "", fileRef: file }))).toBe(true);
    expect(isReconcilablePending(entry({ messageType: "image", text: "", fileRef: null }))).toBe(false);
    expect(isReconcilablePending(entry({ messageType: "voice", text: "", fileRef: file }))).toBe(false);
  });
});

describe("client contract — consultation chat reconciliation wiring", () => {
  const page = () => read("app/app/consultations/[id]/page.tsx");

  it("a missed-confirmation send is marked unconfirmed, never dropped or draft-restored", async () => {
    const src = page();
    // The failure branch marks the entry instead of dropping it.
    expect(src).toContain("markPendingFailed(prev, clientMsgId)");
    // The old behavior (drop the bubble + restore the draft) is gone.
    expect(src).not.toContain("restore the draft, drop the bubble");
    expect(src).not.toContain("Mesaj la pa t ale");
    // Honest state naming: UNCONFIRMED, not "failed to send".
    expect(src).toContain("Pa t konfime.");
    expect(src).not.toContain("Pake voye.");
  });

  it("reconciliation re-sends with the SAME clientMsgId (idempotent verify, not a duplicate)", () => {
    const src = page();
    expect(src).toContain("sendText(entry.text, entry.clientMsgId)");
    expect(src).toContain("{ clientMsgId: entry.clientMsgId }");
    expect(src).toContain("isReconcilablePending(entry)");
    // One in-flight guard shared by all triggers — no concurrent double-send.
    expect(src).toContain("reconcilingRef.current.has(entry.clientMsgId)");
  });

  it("a socket recovery sweeps every unconfirmed entry immediately", () => {
    const src = page();
    expect(src).toContain("prevSocketStatusRef");
    // Fires on the transition INTO open only, then re-sends each failed entry.
    expect(src).toContain('if (socketStatus !== "open" || was === "open") return;');
    expect(src).toContain("for (const entry of pendingRef.current) {");
    expect(src).toContain("if (entry.failed) void reconcilePending(entry);");
  });

  it("failed entries retry on a bounded timer while the page stays open", () => {
    const src = page();
    expect(src).toContain("RECONCILE_DELAY_MS");
    expect(src).toContain("MAX_AUTO_RECONCILE");
    // Voice retries belong to the recorder — never auto-retried here.
    expect(src).toContain('if (!entry.failed || entry.messageType === "voice") continue;');
    // Timers cannot outlive the page.
    expect(src).toContain("for (const t of timers.values()) clearTimeout(t);");
  });

  it("the unconfirmed row offers retry for reconcilable entries and dismiss returns text to the draft", () => {
    const src = page();
    expect(src).toContain("{isReconcilablePending(p) && (");
    expect(src).toContain("onClick={() => retryPending(p)}");
    expect(src).toContain("onClick={() => dismissPending(p)}");
    // "Retire" hands the text back to the composer (draft-empty guard).
    expect(src).toContain("setDraft((prev) => (prev.trim() ? prev : entry.text))");
  });
});

describe("server contract — guarantees every retry relies on", () => {
  it("the hub echoes message:new back to the SENDER with the clientMsgId", () => {
    const hub = read("../src/realtime/hub.js");
    // Sender echo (persistence proof for the WS path)…
    expect(hub).toContain("this.publishToUser(user.id, envelope);");
    // …carrying the correlation id the client reconciles on.
    expect(hub).toContain("if (clientMsgId) envelope.clientMsgId = clientMsgId;");
  });

  it("the REST send route publishes the same echo, so the fallback resolves the pending entry too", () => {
    const route = read("../src/routes/consultations.js");
    expect(route).toContain("messageEnvelope(msg, { clientMsgId: correlationId || undefined })");
    expect(route).toContain("hub.publishToUser(req.user.id, envelope);");
  });

  it("createMessage dedupes on (sender_id, client_msg_id) and returns the ORIGINAL row", () => {
    const repo = read("../src/repos/consultations.js");
    // Idempotency backbone: a retry of an already-persisted send can never
    // insert a second row — the canonical row is handed back instead.
    expect(repo).toContain("ON CONFLICT (sender_id, client_msg_id) WHERE client_msg_id IS NOT NULL");
    expect(repo).toContain("DO NOTHING");
    expect(repo).toContain("SELECT * FROM messages WHERE sender_id = $1 AND client_msg_id = $2");
  });
});
