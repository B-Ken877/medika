/**
 * Presence derivation — event scoping, labels, and the "never the local
 * user's socket status" rule.
 */
import { describe, expect, it } from "vitest";
import { presenceFromEvent, presenceLabel } from "@/lib/ws/presence";
import type { WsPresenceEvent } from "@/lib/api/types";

function event(overrides: Partial<WsPresenceEvent> = {}): WsPresenceEvent {
  return { type: "presence:update", userId: "partner", online: true, ...overrides };
}

describe("presenceFromEvent", () => {
  it("maps the partner's online event", () => {
    expect(presenceFromEvent(event(), { partnerId: "partner" })).toBe("online");
    expect(presenceFromEvent(event({ online: false }), { partnerId: "partner" })).toBe("offline");
  });

  it("ignores events about other users (no presence leaks across consultations)", () => {
    expect(presenceFromEvent(event({ userId: "stranger" }), { partnerId: "partner" })).toBeNull();
  });

  it("ignores events when there is no partner (unassigned consultation)", () => {
    expect(presenceFromEvent(event(), { partnerId: null })).toBeNull();
    expect(presenceFromEvent(event(), { partnerId: undefined })).toBeNull();
  });

  it("ignores malformed events without a boolean online flag", () => {
    expect(presenceFromEvent(event({ online: undefined as unknown as boolean }), { partnerId: "partner" })).toBeNull();
  });
});

describe("presenceLabel (accessible text — color alone never communicates)", () => {
  it("labels each state in Kreyòl", () => {
    expect(presenceLabel("online")).toBe("Sou entènèt");
    expect(presenceLabel("offline")).toBe("Pa sou entènèt");
    expect(presenceLabel("unknown")).toBe("");
  });
});
