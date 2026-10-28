/**
 * Deterministic America/Port-au-Prince timezone tests for the chat formatters.
 * Fixed fixtures + an explicit `now`; nothing depends on the machine's
 * timezone or current time.
 *
 * Reference facts (IANA tz database):
 *  - America/Port-au-Prince is EST (UTC-5) today;
 *  - it observed EDT (UTC-4) in the summers before DST was dropped (1983–2005).
 */
import { describe, expect, it } from "vitest";
import {
  MEDIKA_TIMEZONE,
  formatDateShort,
  formatDateTime,
  formatDaySeparator,
  formatTime,
} from "@/lib/format";
import { wsEventToServerMessage } from "@/lib/ws/socket";

describe("MEDIKA_TIMEZONE", () => {
  it("is the IANA id — never a hardcoded UTC offset", () => {
    expect(MEDIKA_TIMEZONE).toBe("America/Port-au-Prince");
  });
});

describe("formatTime (canonical timezone, 24-hour)", () => {
  it("renders a UTC instant as Haiti local time (EST, UTC-5)", () => {
    // 2026-01-15T18:30:00Z → 13:30 in Port-au-Prince (EST).
    expect(formatTime(Date.UTC(2026, 0, 15, 18, 30, 0) / 1000)).toBe("13:30");
  });

  it("uses the tz database for historical DST (EDT, UTC-4, summer 2005)", () => {
    // Same wall-clock UTC as above, but Haiti observed DST in 2005 → 14:30.
    expect(formatTime(Date.UTC(2005, 6, 15, 18, 30, 0) / 1000)).toBe("14:30");
  });

  it("handles instants near UTC midnight that fall on the previous Haiti day", () => {
    // 2026-01-15T02:30:00Z → 2026-01-14 21:30 in Haiti.
    expect(formatTime(Date.UTC(2026, 0, 15, 2, 30, 0) / 1000)).toBe("21:30");
  });

  it("rejects invalid or missing timestamps", () => {
    expect(formatTime(null)).toBe("");
    expect(formatTime(undefined)).toBe("");
    expect(formatTime(0)).toBe("");
    expect(formatTime(Number.NaN)).toBe("");
  });
});

describe("formatDaySeparator (calendar days in Haiti)", () => {
  it("labels today even when the UTC dates differ", () => {
    // Message: 2026-01-09T23:30:00Z (Haiti Jan 9, 18:30 EST)
    // Now:     2026-01-10T04:30:00Z (Haiti Jan 9, 23:30 EST) — SAME Haiti day.
    // (January fixtures avoid any DST-transition ambiguity across tzdb versions.)
    const ts = Date.UTC(2026, 0, 9, 23, 30, 0) / 1000;
    const now = Date.UTC(2026, 0, 10, 4, 30, 0);
    expect(formatDaySeparator(ts, now)).toBe("Jodi a");
  });

  it("labels yesterday across the Haiti midnight boundary", () => {
    const ts = Date.UTC(2026, 0, 9, 10, 0, 0) / 1000; // Haiti Jan 9, 05:00
    const now = Date.UTC(2026, 0, 10, 12, 0, 0);      // Haiti Jan 10, 07:00
    expect(formatDaySeparator(ts, now)).toBe("Yè");
  });

  it("uses the previous calendar day for early-UTC instants", () => {
    // 2026-01-15T02:30:00Z → Haiti 2026-01-14.
    const ts = Date.UTC(2026, 0, 15, 2, 30, 0) / 1000;
    const now = Date.UTC(2026, 0, 20, 12, 0, 0);
    expect(formatDaySeparator(ts, now)).toBe("14 janvye 2026");
  });

  it("formats older days with Kreyòl month names", () => {
    const ts = Date.UTC(2026, 4, 20, 15, 0, 0) / 1000; // Haiti 2026-05-20
    const now = Date.UTC(2026, 11, 1, 12, 0, 0);
    expect(formatDaySeparator(ts, now)).toBe("20 me 2026");
  });

  it("handles year boundaries without device-local getters", () => {
    // 2025-12-31T23:30:00Z → Haiti 2025-12-31 18:30; now = Haiti 2026-01-01.
    const ts = Date.UTC(2025, 11, 31, 23, 30, 0) / 1000;
    const now = Date.UTC(2026, 0, 1, 10, 0, 0); // Haiti Jan 1, 05:00
    expect(formatDaySeparator(ts, now)).toBe("Yè");
  });

  it("returns an empty string for missing timestamps", () => {
    expect(formatDaySeparator(undefined)).toBe("");
    expect(formatDaySeparator(null)).toBe("");
  });
});

describe("REST and WS timestamps describe the same persisted instant", () => {
  it("formats identically from REST seconds and the WS envelope (ms)", () => {
    const createdSeconds = Math.floor(Date.UTC(2026, 5, 1, 21, 5, 0) / 1000);
    // REST bootstrap row:
    const restDisplay = formatTime(createdSeconds);
    // Same message over WS: envelope ms = seconds × 1000 (server truncates),
    // converted back to seconds EXACTLY ONCE by wsEventToServerMessage.
    const wsMessage = wsEventToServerMessage({
      id: 42,
      consultationId: "cons_tz",
      senderId: "doctor_tz",
      senderName: "Dr Tz",
      text: "men tan an",
      timestamp: createdSeconds * 1000,
      messageType: "text",
    });
    expect(wsMessage.created_at).toBe(createdSeconds);
    expect(formatTime(wsMessage.created_at ?? null)).toBe(restDisplay);
  });

  it("converts milliseconds to seconds exactly once (sub-second dropped)", () => {
    const msWithRemainder = Date.UTC(2026, 5, 1, 21, 5, 0) + 789;
    const m = wsEventToServerMessage({
      id: 43,
      consultationId: "cons_tz",
      senderId: "doctor_tz",
      senderName: "Dr Tz",
      text: "ti fraksyon",
      timestamp: msWithRemainder,
      messageType: "text",
    });
    expect(m.created_at).toBe(Math.floor(msWithRemainder / 1000));
  });

  it("does not confuse a millisecond value with epoch seconds", () => {
    const seconds = Date.UTC(2026, 5, 1, 21, 5, 0) / 1000;
    // A ms value misused as seconds would land in a far-future year.
    expect(formatTime(seconds)).not.toBe(formatTime(seconds * 1000));
  });
});

describe("other formatters use the canonical timezone", () => {
  it("formatDateShort renders the Haiti calendar day with Kreyòl months", () => {
    // 2026-01-01T03:00:00Z → Haiti 2025-12-31 22:00 → "31 des".
    expect(formatDateShort(Date.UTC(2026, 0, 1, 3, 0, 0) / 1000)).toBe("31 des");
    expect(formatDateShort(Date.UTC(2026, 6, 4, 20, 0, 0) / 1000)).toBe("04 jiy");
  });

  it("formatDateTime uses Haiti time, not the machine timezone", () => {
    const out = formatDateTime(Date.UTC(2026, 0, 15, 18, 30, 0) / 1000);
    expect(out).toContain("13:30");
    expect(out).toContain("15/01/2026");
  });

  it("handles invalid inputs", () => {
    expect(formatDateShort(null)).toBe("N/A");
    expect(formatDateTime(null)).toBe("N/A");
    expect(formatDateTime(Number.NaN)).toBe("N/A");
  });
});
