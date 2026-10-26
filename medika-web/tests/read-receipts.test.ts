/**
 * Read-receipt state derivation — trust model, event application, unread
 * tracking and refresh-safe merging.
 */
import { describe, expect, it } from "vitest";
import { applyMessagesRead, mergeMessages, receiptFor, unreadIncomingIds } from "@/lib/chat/receipts";
import type { ServerMessage, WsMessagesReadEvent } from "@/lib/api/types";

function msg(overrides: Partial<ServerMessage> = {}): ServerMessage {
  return {
    id: 1,
    consultation_id: "cons_1",
    sender_id: "partner",
    sender_name: "Partner",
    text: "bonjou",
    created_at: 1_700_000_000,
    message_type: "text",
    file_url: null,
    duration: null,
    file_size: null,
    read_at: null,
    ...overrides,
  };
}

describe("receiptFor", () => {
  it("returns null for incoming messages and system messages", () => {
    expect(receiptFor(msg({ sender_id: "partner" }), "me")).toBeNull();
    expect(receiptFor(msg({ sender_id: "system" }), "me")).toBeNull();
  });

  it("returns 'sent' for persisted own messages and 'read' once read", () => {
    expect(receiptFor(msg({ sender_id: "me" }), "me")).toBe("sent");
    expect(receiptFor(msg({ sender_id: "me", read_at: 1_700_000_500 }), "me")).toBe("read");
  });

  it("needs a viewer identity", () => {
    expect(receiptFor(msg({ sender_id: "me" }), null)).toBeNull();
    expect(receiptFor(msg({ sender_id: "me" }), undefined)).toBeNull();
  });
});

describe("applyMessagesRead", () => {
  const event: WsMessagesReadEvent = {
    type: "messages:read",
    consultationId: "cons_1",
    readerId: "partner",
    messageIds: [1, 2, 3],
    readAt: 1_700_000_900,
  };

  it("marks the affected own messages as read with the persisted instant", () => {
    const list = [
      msg({ id: 1, sender_id: "me" }),
      msg({ id: 2, sender_id: "me" }),
      msg({ id: 4, sender_id: "me" }),
    ];
    const out = applyMessagesRead(list, event);
    expect(out.find((m) => m.id === 1)?.read_at).toBe(1_700_000_900);
    expect(out.find((m) => m.id === 2)?.read_at).toBe(1_700_000_900);
    expect(out.find((m) => m.id === 4)?.read_at).toBeNull();
  });

  it("never regresses already-read messages", () => {
    const list = [msg({ id: 1, sender_id: "me", read_at: 1_700_000_100 })];
    const out = applyMessagesRead(list, event);
    expect(out[0].read_at).toBe(1_700_000_100);
  });

  it("mirrors the server rule: the reader cannot mark their own messages", () => {
    const list = [msg({ id: 2, sender_id: "partner" })];
    const out = applyMessagesRead(list, event); // readerId 'partner' sent id 2
    expect(out[0].read_at).toBeNull();
  });

  it("returns the same array reference when nothing changed", () => {
    const list = [msg({ id: 9, sender_id: "me" })];
    expect(applyMessagesRead(list, event)).toBe(list);
  });
});

describe("unreadIncomingIds", () => {
  it("collects only unread, non-system, non-own messages", () => {
    const list = [
      msg({ id: 1, sender_id: "partner" }),
      msg({ id: 2, sender_id: "partner", read_at: 5 }),
      msg({ id: 3, sender_id: "system" }),
      msg({ id: 4, sender_id: "me" }),
      msg({ id: 5, sender_id: "partner" }),
    ];
    expect(unreadIncomingIds(list, "me")).toEqual([1, 5]);
  });

  it("is empty without a viewer identity", () => {
    expect(unreadIncomingIds([msg()], null)).toEqual([]);
  });
});

describe("mergeMessages (refresh/reconnect race safety)", () => {
  it("keeps live receipt updates when a fresh list lacks read state", () => {
    const live = [msg({ id: 1, sender_id: "me", read_at: 1_700_000_900 })];
    const fresh = [msg({ id: 1, sender_id: "me", read_at: null })];
    const merged = mergeMessages(live, fresh);
    expect(merged.find((m) => m.id === 1)?.read_at).toBe(1_700_000_900);
  });

  it("adopts persisted read state the live list does not have yet", () => {
    const live = [msg({ id: 1, sender_id: "me", read_at: null })];
    const fresh = [msg({ id: 1, sender_id: "me", read_at: 1_700_000_900 })];
    const merged = mergeMessages(live, fresh);
    expect(merged.find((m) => m.id === 1)?.read_at).toBe(1_700_000_900);
  });

  it("unions both lists and sorts by id", () => {
    const merged = mergeMessages(
      [msg({ id: 3 })],
      [msg({ id: 1 }), msg({ id: 2 })],
    );
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
  });
});
