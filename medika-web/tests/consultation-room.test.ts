/**
 * Consultation ROOM route (issue #56) tests.
 *
 * Issue #56 RETIRES the issue #33 video-first PLACEHOLDER as a destination:
 * the real call page (../call) is the primary consultation surface
 * and it handles waiting/eligibility/terminal states itself, server-gated.
 *
 * Contracts verified (source-contract pattern — no jsdom in this package):
 *  - the /room route still EXISTS (stale links must resolve) but is a
 *    compact compatibility redirect to the real call (mode=video);
 *  - the placeholder UI is gone — no fake call affordances, no duplicate
 *    voice/video buttons, no second chat entry;
 *  - the redirect page itself never touches call tokens/media;
 *  - the chat page's acceptance transition now navigates DIRECTLY to the
 *    real call (patient never detours through the placeholder), while
 *    duplicate realtime events still cannot loop navigation;
 *  - patient dashboard entries route ACTIVE consultations to the real call;
 *  - the 5-hour expiry display survives on the chat page (server rule
 *    untouched — covered by the backend suite).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("consultation room route — compatibility redirect (issue #56)", () => {
  const room = read("../app/app/consultations/[id]/room/page.tsx");

  it("exists as a dedicated route under the consultation", () => {
    expect(room.length).toBeGreaterThan(0);
  });

  it("redirects stale visits to the REAL call, video mode", () => {
    expect(room).toContain("router.replace(");
    expect(room).toContain("/call?mode=video");
    expect(room).toContain("encodeURIComponent");
    // The redirect must be unconditional — no eligibility guessing here;
    // the call page owns waiting/eligibility/terminal states.
    expect(room).not.toMatch(/status\s*===\s*"EN_COURS"/);
  });

  it("retires the placeholder UI entirely (no fake call affordances)", () => {
    // Old placeholder affordances that must NOT come back:
    expect(room).not.toContain("Ouvri chat la");
    expect(room).not.toContain("Apèl vwa");
    expect(room).not.toContain("Apèl videyo");
    expect(room).not.toContain("room-placeholder");
    expect(room).not.toContain("Koneksyon videyo dirèk");
    // No status polling of its own — it is a redirect, not a mini-app.
    expect(room).not.toContain("getConsultation");
  });

  it("the redirect page never joins a call, mints tokens or requests media", () => {
    expect(room).not.toContain("ZegoCallSession");
    expect(room).not.toContain("getCallToken");
    expect(room).not.toContain("getUserMedia");
  });

  it("documents WHY the route survives (retired, not deleted)", () => {
    expect(room).toContain("RETIRED");
    expect(room).toContain("issue #56");
  });
});

describe("chat page ↔ real call (issue #56)", () => {
  const page = read("../app/app/consultations/[id]/page.tsx");

  it("every room-entry affordance targets the REAL call, video mode", () => {
    expect(page).toContain(
      "const callHref = `/app/consultations/${encodeURIComponent(consultationId)}/call?mode=video`;",
    );
    expect(page).not.toContain("`/app/consultations/${encodeURIComponent(consultationId)}/room`");
    expect(page).toContain("Antre nan apèl videyo a");
    expect(page).toContain("Ouvri apèl videyo a");
  });

  it("acceptance navigates DIRECTLY to the call (server-confirmed transition only)", () => {
    // The transition still consumes refetched SERVER state, not event payloads.
    expect(page).toMatch(/prevStatusRef\.current === "RECHERCHE_MEDECIN" && c\.status === "EN_COURS"/);
    // Issue #56: the edge auto-navigates to the real call — video is the
    // primary experience; the banner is only a fallback.
    expect(page).toMatch(
      /setJustAccepted\(true\);\s*router\.replace\(`\/app\/consultations\/\$\{encodeURIComponent\(consultationId\)\}\/call\?mode=video`\);/,
    );
    expect(page).toMatch(/consultation:updated[\s\S]*?getConsultation[\s\S]*?applyConsultation\(c\)/);
  });

  it("navigation can only ever target the call — never the retired placeholder", () => {
    const navigations = [
      ...(page.match(/router\.(?:push|replace)\([^)]*\)/g) ?? []),
      ...(page.match(/href=\{`[^`]*\}`/g) ?? []),
    ];
    expect(navigations.length).toBeGreaterThan(0);
    for (const nav of navigations) {
      expect(nav.includes("/room")).toBe(false);
    }
  });

  it("the chat page uses calm static copy for the 5-hour window — no ticking countdown (issue #71)", () => {
    expect(page).toContain("Konsiltasyon sa a disponib jiska 5 èdtan apre doktè a aksepte");
    expect(page).not.toContain("<OfferCountdown");
    expect(page).not.toContain("Konsiltasyon an ekspire nan:");
  });
});

describe("patient dashboard entries (issue #56)", () => {
  const dash = read("../components/consultation/PatientDashboard.tsx");

  it("ACTIVE consultations open the REAL call (video mode)", () => {
    expect(dash).toContain('c.status === "EN_COURS"');
    expect(dash).toContain("`/app/consultations/${encodeURIComponent(c.id)}/call?mode=video`");
    expect(dash).toContain('"Antre nan apèl la"');
    // The placeholder is no longer a destination anywhere in the dashboard.
    expect(dash).not.toContain("/room");
  });

  it("waiting/finished consultations still open the existing chat", () => {
    expect(dash).toContain('"Gade detay yo"');
    expect(dash).toContain("`/app/consultations/${encodeURIComponent(current.id)}`");
  });
});

describe("room styles (issue #33 — reused by the call-entry bars)", () => {
  const css = read("../app/globals.css");

  it("keeps the entry-bar styles the chat page still uses", () => {
    expect(css).toContain(".room-entry-bar {");
  });
});
