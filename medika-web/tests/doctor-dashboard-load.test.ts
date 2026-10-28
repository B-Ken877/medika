/**
 * Issue #35 regression — doctor dashboard error states.
 *
 * Original bug: DoctorDashboard's load() catch did setConsultations([]), so a
 * FAILED request rendered as a confident empty queue: counters showed 0, the
 * generic "Sèvis la pa disponib…" banner appeared, and no retry explained
 * what had failed. Requirements:
 *   - a failed load must never look like an empty queue;
 *   - the message must specifically say consultation requests failed, with a
 *     working retry action;
 *   - previously loaded data is preserved on a refresh failure.
 *
 * medika-web has no jsdom/RTL dependency, so the component is verified via
 * source-contract guards (the established pattern in this suite) plus runtime
 * checks of the API error vocabulary the dashboard surfaces.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(__dirname, "../components/consultation/DoctorDashboard.tsx"),
  "utf8",
);

describe("DoctorDashboard load-failure contract (issue #35)", () => {
  it("no longer fabricates an empty list when the request fails", () => {
    // The bug: catch handler overwrote consultations with [].
    expect(source).not.toContain("setConsultations([])");
    // The fix keeps previous data and only records the error.
    expect(source).toMatch(/\.catch\(\(err\) => \{[\s\S]*?setError\(err\);[\s\S]*?\}\);/);
  });

  it("counters show an unknown marker instead of zero while data is missing", () => {
    expect(source).toContain('const countersUnknown = consultations === null && error !== null;');
    expect(source).toContain('countersUnknown ? "—" : String(n)');
    // All three stat cards and the tab counts go through counterValue().
    const uses = source.match(/counterValue\(buckets\.\w+\.length\)/g) ?? [];
    expect(uses.length).toBe(6); // 3 stat cards + 3 tab badges
  });

  it("shows a consultation-specific error message with a retry action", () => {
    expect(source).toContain("Nou pa t kapab chaje demann konsiltasyon yo");
    expect(source).toMatch(/<ErrorAlert[\s\S]*?onRetry=\{load\}/);
  });

  it("a failed refresh keeps the previously loaded list visible", () => {
    // Stale-data branch wording differs from the first-load branch.
    expect(source).toContain("Nou pa t kapab mete ajou demann konsiltasyon yo");
    expect(source).toContain("dènye versyon ki reyisi");
  });

  it("the empty state is only reachable after a successful load", () => {
    // Empty state requires data AND no error — a failed load can't show "no
    // requests" reassurance.
    expect(source).toMatch(
      /consultations !== null && list\.length === 0 && !error/,
    );
  });

  it("the panel retry button stays usable after a failed first load", () => {
    // Before the fix the Refrèchi button was disabled whenever consultations
    // === null, including the error path (no data). Now disabled only while
    // loading (no data AND no error yet).
    expect(source).toContain(
      "disabled={consultations === null && !error}",
    );
  });
});
