/**
 * Direct-to-video consultation entry (issue #56) — source contracts.
 *
 * Verified here (source-contract pattern — no jsdom in this package):
 *  - the call page waits for server-side eligibility BEFORE any Room
 *    exists (no room churn while waiting, no request storms);
 *  - "doctor not here yet" is a calm, neutral state — never an error;
 *  - terminal statuses stop the loop with clear copy and no auto-retry;
 *  - the wait is bounded and cancellable;
 *  - call:start stays once-per-session and End call stays the ONLY
 *    user action that sends call:end signaling;
 *  - the doctor's post-accept navigation lands in the real call;
 *  - the server-side token gate (EN_COURS check) is still intact — the
 *    client wait loop only READS status and can never bypass it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("call page bootstrap (issue #56)", () => {
  const call = read("../app/app/consultations/[id]/call/page.tsx");

  it("reads eligibility FIRST and creates the Room only after it", () => {
    const firstPoll = call.indexOf("await getConsultation(token, consultationId)");
    const roomCreation = call.indexOf("new Room(");
    expect(firstPoll).toBeGreaterThan(-1);
    expect(roomCreation).toBeGreaterThan(-1);
    expect(firstPoll).toBeLessThan(roomCreation);
    // Exactly ONE room creation site — waiting can never churn rooms.
    expect(call.match(/new Room\(/g)?.length).toBe(1);
  });

  it("waiting for the doctor is calm and neutral — never an error", () => {
    expect(call).toContain('dispatch({ type: "waiting-for-eligibility" })');
    expect(call).toContain("N ap tann doktè a konekte…");
    // The calm overlay covers both bootstrap stages.
    expect(call).toMatch(
      /\(state\.phase === "connecting" \|\| state\.phase === "waiting"\) && !chatOpen/,
    );
  });

  it("terminal statuses stop the loop with honest copy and no auto-retry", () => {
    expect(call).toContain("TERMINAL_CONSULTATION_STATUSES");
    expect(call).toContain('dispatch({ type: "terminal-status" })');
    expect(call).toContain("function ineligibleCopy(status: string)");
    for (const status of ["REFUSE", "TERMINE", "EXPIRE"]) {
      expect(call).toContain(`case "${status}"`);
    }
  });

  it("the wait is bounded (capped backoff + hard attempt budget)", () => {
    expect(call).toContain("eligibilityBackoffMs(poll)");
    expect(call).toContain("MAX_ELIGIBILITY_ATTEMPTS");
    expect(call).toContain("Doktè a poko aksepte konsiltasyon an.");
  });

  it("the wait is cancellable (cancellation flags checked around every await)", () => {
    // Before each poll and after each await, the loop must re-check the
    // cancellation flags — no stray polling after unmount or hang-up.
    // (The post-sleep check is the loop-top guard on the next iteration.)
    const loopStart = call.indexOf("for (let poll = 0; ; poll++)");
    const phaseTwo = call.indexOf("// ── Phase 2");
    const loop = call.slice(loopStart, phaseTwo);
    const checks = loop.match(/disposed \|\| endedRef\.current/g)?.length ?? 0;
    expect(checks).toBeGreaterThanOrEqual(4);
    expect(loop).toMatch(/for \(let poll = 0; ; poll\+\+\) \{\s*if \(disposed \|\| endedRef\.current\) return;/);
  });

  it("authorization failures surface as real errors (not silent waiting)", () => {
    expect(call).toMatch(/err\.status === 401 \|\| err\.status === 403 \|\| err\.status === 404/);
    expect(call).toContain("hardFailure");
  });

  it("call:start stays once-per-session; End call keeps its signaling guard", () => {
    expect(call).toContain("startCallSentRef");
    // Issue #56: leaving during the pre-room wait sends NO call:end.
    expect(call).toMatch(/if \(roomRef\.current\) \{\s*socket\?\.endCall/);
  });

  it("chat/video switching remains pure view state (no room teardown)", () => {
    expect(call).toContain("const openChat = useCallback(() => setChatOpen(true), []);");
    expect(call).toContain("const closeChat = useCallback(() => setChatOpen(false), []);");
    // The room-disconnecting path stays exactly the explicit endCall.
    expect(call.match(/room\?\.disconnect\(\)|room\.disconnect\(\)/g)?.length).toBe(2);
  });
});

describe("doctor entry point (issue #56)", () => {
  const dash = read("../components/consultation/DoctorDashboard.tsx");

  it("a freshly accepted consultation opens the REAL video call", () => {
    expect(dash).toMatch(
      /router\.push\(`\/app\/consultations\/\$\{encodeURIComponent\(id\)\}\/call\?mode=video`\);/,
    );
    expect(dash).not.toContain("/room");
  });
});

describe("server gate untouched (issue #56)", () => {
  it("the token endpoint still fail-closes on non-EN_COURS consultations", () => {
    const server = read("../../src/routes/call.js");
    expect(server).toMatch(/consultation\.status !== 'EN_COURS'/);
    expect(server).toMatch(/Appel indisponible pour cette consultation/);
  });
});
