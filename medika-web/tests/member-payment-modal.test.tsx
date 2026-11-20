/**
 * SSR render test — the member-side payment popup (migration 017, owner
 * brief). medika-web has no jsdom/RTL; component tests render through
 * react-dom/server (same pattern as tests/medication-order.test.tsx).
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { MemberPaymentModal } from "@/components/payment/MemberPaymentModal";
import type { MemberPaymentRequest } from "@/lib/api/endpoints";

const strip = (html: string) => html.replace(/<!--.*?-->/g, "");

const pending: MemberPaymentRequest = {
  id: "apr_test123",
  sessionId: "sess_1",
  status: "pending",
  amount: 1500,
  currency: "HTG",
  specialty: "Cardiologie",
  doctorName: "Dr Deux",
  agentName: "Ajan Test",
  consultationId: null,
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
};

const paid: MemberPaymentRequest = { ...pending, status: "paid", consultationId: "cons_ab12cd34" };

describe("MemberPaymentModal (SSR)", () => {
  it("renders the MonCash-style pay form: amount, phone, 4-digit PIN", () => {
    const html = strip(renderToString(createElement(MemberPaymentModal, { request: pending })));
    expect(html).toContain("1500 HTG");
    expect(html).toContain("Nimewo telefòn ou");
    expect(html).toContain("Kòd sekirite MonCash (4 chif)");
    expect(html).toContain('type="password"');
    expect(html).toContain("Peye 1500 HTG");
    expect(html).toContain("Ajan Medika Ajan Test");
    expect(html).toContain("Kadyoloji"); // specialtyLabel("Cardiologie") — Creole display label
    expect(html).toContain("Dr Deux");
  });

  it("always discloses that this is a simulation", () => {
    const html = strip(renderToString(createElement(MemberPaymentModal, { request: pending })));
    expect(html).toContain("Similasyon tès — pa gen vrè lajan k ap deplase.");
  });

  it("the success state never redirects — the member stays on the call", () => {
    const html = strip(renderToString(createElement(MemberPaymentModal, { request: paid, done: true })));
    expect(html).toContain("Peman konfime!");
    expect(html).toContain("Ou ka rete nan apèl la");
    expect(html).toContain("tablodbò ou");
    expect(html).not.toContain("Peye 1500 HTG"); // the pay form is gone
  });

  it("is an accessible modal dialog", () => {
    const html = strip(renderToString(createElement(MemberPaymentModal, { request: pending })));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Demann peman");
  });

  it("shows the server-provided error without losing the form", () => {
    const html = strip(renderToString(
      createElement(MemberPaymentModal, { request: pending, error: "Demann peman an ekspire — mande ajan an voye l ankò" }),
    ));
    expect(html).toContain("Demann peman an ekspire");
    expect(html).toContain("Peye 1500 HTG");
  });
});
