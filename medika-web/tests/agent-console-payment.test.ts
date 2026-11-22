/**
 * Contract tests — agent console + member payment popup (migration 017,
 * owner briefs). The agent IMPERSONATES the member: the session wizard is
 * the member's own scheduling experience — the exact /app/consult flow,
 * component for component (same iOS consult column, same card language,
 * same labels, the member's words) — with ONE agent-side difference at the
 * end: instead of paying, the wizard's LAST STEP is a "Voye demann peman an"
 * button that pushes the MonCash-style popup to the MEMBER'S device WITHOUT
 * the call ever dropping → on Pay the consultation is created FOR THE
 * MEMBER, nobody is redirected, and it appears on the member's dashboard.
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

describe("agent console — the wizard mirrors the member's own intake", () => {
  it("step 1 renders the member's consult column (.cf) with the member's classes", () => {
    // The same wrapper classes the member's /app/consult intake uses.
    expect(sessionPage).toContain('className="stack consult-intake cf"');
    expect(sessionPage).toContain('className="page-title"');
    expect(sessionPage).toContain("<h3 className=\"page-title\">Jwenn yon doktè</h3>");
    // The member's form: a .card with the .textarea field and the SAME
    // placeholder the member types into.
    expect(sessionPage).toContain("<form onSubmit={submitMemberForm} className=\"card\">");
    expect(sessionPage).toContain('className="textarea"');
    expect(sessionPage).toContain(
      "Eksplike sa w ap senti, depi kilè sa kòmanse, ak nenpòt lòt detay ki enpòtan...",
    );
    expect(sessionPage).toContain("Bay detay: enfòmasyon sa yo ap ede doktè a ede pasyan an pi byen.");
    // Same segmented urgency control, same SpecialtySelect, same large
    // primary "Kontinye" button with the search icon.
    expect(sessionPage).toContain('const URGENCY_LEVELS = ["Faible", "Moyenne", "Haute", "Critique"] as const;');
    expect(sessionPage).toContain("urgencyLabel(u)");
    expect(sessionPage).toContain("<SpecialtySelect");
    expect(sessionPage).toContain("btn btn-primary btn-block btn-lg");
    expect(sessionPage).toContain("<Search size={16} aria-hidden /> Kontinye");
  });

  it("the agent fills THE MEMBER'S words — on-behalf framing, raw values sent", () => {
    // The impersonation framing: the form belongs to the patient.
    expect(sessionPage).toContain("Sa pasyan an ap senti");
    expect(sessionPage).toContain("Di nou sa pasyan an ap santi epi chwazi kalite swen li bezwen an.");
    // Display labels via urgencyLabel; the RAW value is what goes on the
    // wire — the same contract as the manual member flow.
    expect(sessionPage).not.toMatch(/urgencyLevel:\s*urgencyLabel/);
    expect(sessionPage).toMatch(
      /agentSessionIntake\(token, sessionId, \{\s*description: symptoms\.trim\(\),\s*urgencyLevel: urgency,\s*specialty,\s*\}\)/,
    );
  });

  it("a poll/WS refresh never clobbers the agent's in-progress typing", () => {
    expect(sessionPage).toContain("intakeHydratedFor");
    expect(sessionPage).toContain("must never overwrite what the agent is typing");
  });
});

describe("agent console — the doctor step is the member's doctor list", () => {
  it("member-style rows (.list/.row) with credentials, price and pick action", () => {
    expect(sessionPage).toContain("N ap chèche doktè ki disponib");
    expect(sessionPage).toContain('<div className="list">');
    expect(sessionPage).toContain('className="row"');
    expect(sessionPage).toContain("<VerifiedBadge compact />");
    expect(sessionPage).toContain("Chwazi pou pasyan an");
    // Availability badge exactly like the member's list.
    expect(sessionPage).toContain('className="badge badge-green">Disponib</span>');
  });

  it("the member's preferred doctor is searchable by name across specialties", () => {
    expect(sessionPage).toContain("Doktè pi renmen pasyan an? Chèche non l");
    expect(sessionPage).toMatch(/agentDoctors\(token, \{ q: docQuery\.trim\(\) \}\)/);
    // The specialty-scoped list uses the same agent-gated endpoint.
    expect(sessionPage).toMatch(/agentDoctors\(token, \{ specialty: spec \}\)/);
    // The patient-facing /api/doctors endpoint is no longer used here.
    expect(sessionPage).not.toContain("getDoctorsBySpecialty");
  });

  it("picking a doctor auto-advances — the review state resets with the selection", () => {
    expect(sessionPage).toMatch(/agentSessionDoctor\(token!, sessionId, d\.id\)/);
    // Issue #31 parity: changing the selection resets the review phase.
    expect(sessionPage).toContain("setReviewed(false); }, [chosenDoctorId])");
  });
});

describe("agent console — review card, then Submit Payment Request as the LAST step", () => {
  it("the review card is the member's review card (doctor identity + summary)", () => {
    expect(sessionPage).toContain("Revize demann ou an");
    expect(sessionPage).toContain('className="card doctor-card"');
    expect(sessionPage).toContain('className="flex-between mb-1"');
    expect(sessionPage).toContain("Nivo ijans");
    expect(sessionPage).toContain("Sa pasyan an di l ap santi");
    expect(sessionPage).toContain('<hr className="divider" />');
    // The deliberate review phase before the request leaves (issue #31).
    expect(sessionPage).toContain("Kontinye ak peman an");
    expect(sessionPage).toContain("setReviewed(true)");
  });

  it("the LAST intake step pushes the payment request to the member's device", () => {
    expect(sessionPage).toContain("Voye demann peman an");
    expect(sessionPage).toMatch(/agentCreatePaymentRequest\(token!, sessionId!\)/);
    // The payment happens on the member's phone, not the agent's.
    expect(sessionPage).toContain("SOU TELEFÒN PAS YAN AN");
    expect(sessionPage).toContain("Peman an ap louvri sou telefòn pasyan an.");
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
    // The wizard derives the booked stage from SERVER state (poll + WS).
    expect(sessionPage).toContain("paid || (sessionOver && doctorDone) ? \"booked\"");
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
