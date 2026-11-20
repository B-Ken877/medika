/**
 * Contract tests — agent console + member payment popup (migration 017,
 * owner brief). The agent answers the call, fills the intake ON BEHALF of
 * the member (form OPEN during the call), searches the member's preferred
 * doctor by name, clicks "Submit Payment" → the member's device shows the
 * MonCash-style simulated popup (amount + phone + 4-digit PIN) WITHOUT the
 * call ever dropping → on Pay the consultation is created FOR THE MEMBER,
 * nobody is redirected, and it appears on the member's dashboard.
 *
 * Web suite has no jsdom/RTL: source-contract style (assert the exact
 * strings, paths and structural guarantees in the sources), mirroring
 * tests/consult-flow.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

const sessionPage = read("../app/app/agent/session/[id]/page.tsx");
const endpoints = read("../lib/api/endpoints.ts");
const modal = read("../components/payment/MemberPaymentModal.tsx");
const watcher = read("../components/payment/PaymentRequestWatcher.tsx");
const shell = read("../components/layout/AppShell.tsx");
const login = read("../app/login/page.tsx");
const globalsCss = read("../app/globals.css");
const types = read("../lib/api/types.ts");

describe("agent console — on-behalf intake (owner brief)", () => {
  it("the intake form is OPEN during the call: reason, symptoms, urgency", () => {
    // The form renders whenever the session is live (not completed).
    expect(sessionPage).toContain("s.status !== \"completed\" && (\n              <form className=\"stack intake-card\"");
    expect(sessionPage).toContain("Entèvyou pasyan an (ou ranpli l pou li)");
    expect(sessionPage).toContain("Rezon vizit la");
    expect(sessionPage).toContain("Sa pasyan an ap santi (mo pasyan an)");
    // Raw backend values only in state; display labels via urgencyLabel —
    // the same contract as the manual flow.
    expect(sessionPage).toContain('const URGENCY_LEVELS = ["Faible", "Moyenne", "Haute", "Critique"] as const;');
    expect(sessionPage).toContain("urgencyLabel(u)");
    expect(sessionPage).not.toMatch(/urgencyLevel:\s*urgencyLabel/);
    // Optional medical-history update is captured as a session note.
    expect(sessionPage).toContain("Mizajou dosye medikal");
    expect(sessionPage).toContain("`Dosye medikal: ${historyNote.trim()}`");
    // Saved through the dedicated endpoint with the raw values.
    expect(sessionPage).toMatch(/agentSessionIntake\(token, sessionId, \{\s*reason: intakeReason\.trim\(\),\s*description: intakeDescription\.trim\(\),\s*urgencyLevel: intakeUrgency,?\s*\}\)/);
  });

  it("a poll/WS refresh never clobbers the agent's in-progress typing", () => {
    expect(sessionPage).toContain("intakeHydratedFor");
    expect(sessionPage).toContain("must never overwrite what the agent is typing");
  });

  it("the stage advances on the captured intake", () => {
    expect(sessionPage).toContain("(s.intake.description || s.reason) ? 2 : 1");
  });
});

describe("agent console — preferred doctor search (owner brief)", () => {
  it("the member's preferred doctor is searchable by name across specialties", () => {
    expect(sessionPage).toContain("Doktè pi renmen pasyan an? Chèche non l");
    expect(sessionPage).toMatch(/agentDoctors\(token, \{ q: docQuery\.trim\(\) \}\)/);
    // The specialty-scoped list uses the same agent-gated endpoint.
    expect(sessionPage).toMatch(/agentDoctors\(token, \{ specialty \}\)/);
    // The patient-facing /api/doctors endpoint is no longer used here.
    expect(sessionPage).not.toContain("getDoctorsBySpecialty");
  });
});

describe("agent console — Submit Payment flow (owner brief)", () => {
  it("the agent pushes the payment request to the member's device", () => {
    expect(sessionPage).toContain("Voye demann peman an");
    expect(sessionPage).toMatch(/agentCreatePaymentRequest\(token!, sessionId!\)/);
  });

  it("while pending: the call MUST stay open (explicit instruction)", () => {
    expect(sessionPage).toContain("APÈL LA RETE LOUVRI");
    expect(sessionPage).toContain("Pa finis apèl la pandan pwosesis sa a");
    expect(sessionPage).toContain("Anile demann an");
    expect(sessionPage).toMatch(/agentCancelPaymentRequest\(token!, sessionId!\)/);
    // 5s poll while pending (safety net under the WS events).
    expect(sessionPage).toMatch(/payReq\?\.status !== "pending"[\s\S]{0,140}5000/);
  });

  it("on paid: the consultation exists and the member is not redirected", () => {
    expect(sessionPage).toContain("Peman konfime — konsiltasyon kreye.");
    expect(sessionPage).toContain("konsiltasyon an parèt nan tablodbò li");
  });
});

describe("member-side payment popup (simulated MonCash)", () => {
  it("MonCash-style: amount, phone field, 4-digit PIN, one Pay action", () => {
    expect(modal).toContain('Kòd sekirite MonCash (4 chif)');
    expect(modal).toContain('type="password"');
    expect(modal).toContain("maxLength={4}");
    // Digits only — strip anything else on input.
    expect(modal).toContain("replace(/\\D/g, \"\")");
    expect(modal).toContain("Peye ${request.amount} ${request.currency}");
    expect(modal).toContain('role="dialog"');
  });

  it("clearly labeled as a simulation (never real money)", () => {
    expect(modal).toContain("Similasyon tès — pa gen vrè lajan k ap deplase.");
  });

  it("NO redirect after payment — the member stays on the call", () => {
    expect(modal).toContain("Ou ka rete nan apèl la");
    // The modal never navigates: no router import/push anywhere in it.
    expect(modal).not.toContain("useRouter");
    expect(modal).not.toContain("router.push");
    expect(modal).not.toContain("router.replace");
  });

  it("the watcher polls + listens and mounts patient-only in the shell", () => {
    expect(watcher).toMatch(/getMyPaymentRequest/);
    expect(watcher).toContain("8000");
    expect(watcher).toMatch(/type\?\.startsWith\("payment:"\)/);
    // Dismissing hides THAT request only; a new request id reopens the popup.
    expect(watcher).toContain("dismissedId");
    expect(watcher).toMatch(/request\.id !== dismissedId/);
    // Shell mount: patient-only, never for agents.
    expect(shell).toContain("user.role === \"patient\" && <PaymentRequestWatcher />");
    // Paid requests show the confirmation state (reload-safe UX).
    expect(watcher).toMatch(/request\?\.status === "paid"/);
  });

  it("the API client talks to exactly the new backend routes", () => {
    expect(endpoints).toContain('"/api/assist/payment-requests/current"');
    expect(endpoints).toMatch(/\/api\/assist\/payment-requests\/\$\{encodeURIComponent\(requestId\)\}\/confirm/);
    expect(endpoints).toContain("`/api/agent/sessions/${encodeURIComponent(sessionId)}/intake`");
    expect(endpoints).toContain("`/api/agent/sessions/${encodeURIComponent(sessionId)}/payment-request`");
    expect(endpoints).toContain("`/api/agent/sessions/${encodeURIComponent(sessionId)}/payment-request/cancel`");
    expect(endpoints).toContain('"/api/agent/doctors"');
    // Confirm can take long (create + verify + routing) — 25s timeout.
    expect(endpoints).toMatch(/confirm[\s\S]{0,400}timeoutMs: 25_000/s);
  });

  it("the popup styles exist (overlay, MonCash-like card, PIN input)", () => {
    expect(globalsCss).toContain(".payreq-overlay {");
    expect(globalsCss).toContain(".payreq-modal {");
    expect(globalsCss).toContain(".payreq-pin input {");
    expect(globalsCss).toContain(".payreq-card.pending {");
    expect(globalsCss).toContain(".payreq-card.paid {");
  });
});

describe("roles + landing", () => {
  it("the Role union knows the contact-center roles", () => {
    expect(types).toContain('"agent" | "agent_supervisor"');
  });

  it("agents land in their console after login (owner brief)", () => {
    expect(login).toContain('"/app/agent"');
    expect(login).toMatch(/\["agent", "agent_supervisor"\]\.includes\(user\?\.role \?\? ""\)/);
    // A specific ?next= always wins — unchanged behavior otherwise.
    expect(login).toContain("!params.get(\"next\")");
  });
});

describe("agent console shared CSS", () => {
  it("the previously-unstyled agent classes are defined once", () => {
    expect(globalsCss).toContain(".banner {");
    expect(globalsCss).toContain(".banner-error {");
    expect(globalsCss).toContain(".table-wrap {");
    expect(globalsCss).toContain(".doctor-row {");
    expect(globalsCss).toContain(".intake-card {");
  });
});
