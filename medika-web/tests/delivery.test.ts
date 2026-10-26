/**
 * Durable delivery helpers — echo waiting + persisted-message merging.
 *
 * waitForMessageEcho models the ONLY trustworthy persistence signal on the WS
 * path: the message:new echo carrying OUR clientMsgId (the hub emits it after
 * the INSERT). Everything else (a successful send() return value) proves
 * nothing about durability.
 */
import { describe, expect, it } from "vitest";
import { waitForMessageEcho, mergePersistedMessage } from "@/lib/chat/delivery";
import type { MedikaSocket } from "@/lib/ws/socket";

type Listener = (event: { type: string; [k: string]: unknown }) => void;

type FakeSocket = Pick<MedikaSocket, "onEvent">;

function fakeSocket(): FakeSocket & { emit(event: unknown): void; listenerCount(): number } {
  const listeners = new Set<Listener>();
  return {
    onEvent(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event: unknown) {
      for (const l of listeners) l(event as { type: string; [k: string]: unknown });
    },
    listenerCount: () => listeners.size,
  };
}

describe("waitForMessageEcho", () => {
  it("resolves TRUE when the persisted echo with our clientMsgId arrives", async () => {
    const socket = fakeSocket();
    const promise = waitForMessageEcho(socket, "cmp-1", 500);
    socket.emit({ type: "message:new", id: 10, clientMsgId: "cmp-1" });
    await expect(promise).resolves.toBe(true);
  });

  it("ignores echoes for OTHER clientMsgIds", async () => {
    const socket = fakeSocket();
    const promise = waitForMessageEcho(socket, "cmp-mine", 100);
    socket.emit({ type: "message:new", id: 11, clientMsgId: "cmp-other" });
    socket.emit({ type: "message:new", id: 12 }); // legacy echo without id
    await expect(promise).resolves.toBe(false);
  });

  it("resolves FALSE on timeout (drives the REST fallback)", async () => {
    const socket = fakeSocket();
    await expect(waitForMessageEcho(socket, "cmp-2", 20)).resolves.toBe(false);
  });

  it("always unsubscribes after settling (no listener leak)", async () => {
    const socket = fakeSocket();
    const before = socket.listenerCount();
    const p = waitForMessageEcho(socket, "cmp-3", 20);
    await p;
    expect(socket.listenerCount()).toBe(before);
  });

  it("unsubscribes immediately after the matching echo", async () => {
    const socket = fakeSocket();
    const before = socket.listenerCount();
    const p = waitForMessageEcho(socket, "cmp-4", 1000);
    socket.emit({ type: "message:new", id: 13, clientMsgId: "cmp-4" });
    await p;
    expect(socket.listenerCount()).toBe(before);
  });

  it("never rejects — a broken listener registration falls back (false)", async () => {
    const socket = {
      onEvent() {
        throw new Error("boom");
      },
    } as unknown as FakeSocket;
    await expect(waitForMessageEcho(socket, "x", 10)).resolves.toBe(false);
  });
});

describe("mergePersistedMessage", () => {
  const mk = (id: number) => ({ id, text: `m${id}` });

  it("appends a REST-persisted message not yet known locally", () => {
    const merged = mergePersistedMessage([mk(1), mk(3)], mk(2));
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  it("deduplicates by id when the echo ALSO arrived (no double bubble)", () => {
    const list = [mk(1), mk(2), mk(3)];
    expect(mergePersistedMessage(list, mk(2))).toBe(list); // unchanged reference
  });

  it("merges into an empty list", () => {
    expect(mergePersistedMessage([], mk(7)).map((m) => m.id)).toEqual([7]);
  });
});
