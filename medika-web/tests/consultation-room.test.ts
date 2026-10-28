/**
 * Consultation room — video-first placeholder (issue #33) tests.
 *
 * Contracts verified (source-contract pattern — no jsdom in this package):
 *  - the room route exists and its dominant surface is a clearly labelled
 *    video PLACEHOLDER;
 *  - no LiveKit usage, no token minting, no media permissions, no claim of a
 *    live call (scope constraint of the testing phase);
 *  - obvious Chat switch to the EXISTING chat route for the same
 *    consultation, and an equally obvious way back (room entry bar);
 *  - server-authoritative state via refetch on consultation:updated and on
 *    socket reconnect (refresh/delayed/duplicate events safe);
 *  - patient entries route ACTIVE consultations to the room (video-first),
 *    everything else to the existing chat;
 *  - chat functionality, payment and lifecycle rules untouched.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("consultation room page (issue #33)", () => {
  const room = read("../app/app/consultations/[id]/room/page.tsx");

  it("exists as a dedicated route under the consultation", () => {
    expect(room.length).toBeGreaterThan(0);
  });

  it("dominant surface is a labelled video placeholder with identity + status", () => {
    expect(room).toContain('className={`room-placeholder ${waiting ? "waiting" : canChat ? "active" : "terminal"}`}');
    expect(room).toContain('aria-label="Zòn videyo konsiltasyon an"');
    expect(room).toContain("<Avatar");
    expect(room).toContain("presenceLabel(presence)");
  });

  it("does NOT pretend a call is connected (honest placeholder copy)", () => {
    expect(room).toMatch(/Koneksyon\s+videyo dirèk ap disponib byento/);
    expect(room).toContain("VideoOff");
  });

  it("never joins LiveKit, mints tokens or requests media permissions", () => {
    expect(room).not.toContain("livekit");
    expect(room).not.toContain("getCallToken");
    expect(room).not.toContain("getUserMedia");
    expect(room).not.toContain("new Room(");
    // It links to the EXISTING call routes only via plain navigation.
    expect(room).toContain("/call?mode=voice");
    expect(room).toContain("/call?mode=video");
  });

  it("offers an obvious Chat action to the EXISTING chat route (same consultation)", () => {
    expect(room).toContain("const chatHref = `/app/consultations/${encodeURIComponent(consultationId)}`");
    expect(room).toContain("Ouvri chat la");
    expect(room).toContain("<MessageCircle");
  });

  it("derives state from the SERVER and refetches on updates + reconnects", () => {
    expect(room).toContain("getConsultation(token, consultationId, controller.signal)");
    expect(room).toMatch(/consultation:updated[\s\S]*?if \(e\.id === consultationId\) load\(\);/);
    // Reconnect safety: missed events are healed by a refetch + presence resubscribe.
    expect(room).toMatch(/socketStatus === "open"[\s\S]*?sendPresenceSubscribe\(consultationId\);[\s\S]*?load\(\);/);
  });

  it("understands waiting, terminal, loading and error states", () => {
    expect(room).toContain("N ap tann doktè a aksepte demann lan");
    expect(room).toContain("Konsiltasyon sa a fini.");
    expect(room).toContain("Konsiltasyon sa a ekspire otomatikman apre 5 zè.");
    expect(room).toContain("N ap chaje sal konsiltasyon an...");
    expect(room).toContain("Nou pa t kapab chaje sal konsiltasyon an");
  });

  it("preserves the 5-hour expiry rule display without altering it", () => {
    expect(room).toContain("<OfferCountdown");
    expect(room).toContain("warnUnderSeconds={30 * 60}");
  });
});

describe("chat page ↔ room switching (issue #33)", () => {
  const page = read("../app/app/consultations/[id]/page.tsx");

  it("the chat page carries an obvious room entry while the consultation is active", () => {
    expect(page).toContain("Ouvri sal videyo a");
    expect(page).toContain('const roomHref = `/app/consultations/${encodeURIComponent(consultationId)}/room`');
  });

  it("acceptance guides the patient to the room (server-confirmed transition only)", () => {
    expect(page).toMatch(/prevStatusRef\.current === "RECHERCHE_MEDECIN" && c\.status === "EN_COURS"/);
    expect(page).toContain("Antre nan sal videyo a");
    // The transition tracker consumes refetched SERVER state, not event payloads.
    expect(page).toMatch(/consultation:updated[\s\S]*?getConsultation[\s\S]*?applyConsultation\(c\)/);
  });

  it("duplicate realtime events cannot loop navigation (no auto-redirect)", () => {
    // The chat page GUIDES (banner + CTA); it never router.push'es to the
    // room on its own — the user navigates explicitly.
    const pushes = page.match(/router\.push\([^)]*\)/g) ?? [];
    expect(pushes.every((p) => !p.includes("/room"))).toBe(true);
  });
});

describe("patient dashboard entries (issue #33)", () => {
  const dash = read("../components/consultation/PatientDashboard.tsx");

  it("ACTIVE consultations open the video-first room", () => {
    expect(dash).toContain('c.status === "EN_COURS"');
    expect(dash).toContain("`/app/consultations/${encodeURIComponent(c.id)}/room`");
    expect(dash).toContain('"Antre nan sal la"');
  });

  it("waiting/finished consultations still open the existing chat", () => {
    expect(dash).toContain('"Gade detay yo"');
    expect(dash).toContain("`/app/consultations/${encodeURIComponent(current.id)}`");
  });
});

describe("room styles (issue #33)", () => {
  const css = read("../app/globals.css");

  it("ships a dominant, professional video stage", () => {
    expect(css).toContain(".room-placeholder {");
    expect(css).toContain(".room-stage {");
    expect(css).toContain(".room-entry-bar {");
    expect(css).toContain(".room-controls {");
  });
});
