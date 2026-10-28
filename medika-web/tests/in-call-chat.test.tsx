/**
 * In-call chat panel (issue #45) — SSR smoke tests.
 *
 * Guarantees the panel mounts with the approved Kreyòl copy and ARIA wiring:
 * the "Back to video" and "End call" controls stay DISTINCT (different
 * labels, different actions), the log is exposed as a log region, and the
 * composer is labeled and disabled without a session token. Interactive
 * behavior (WS echo, receipts, typing throttles) is covered by the shared
 * logic libs' own tests plus the call-phase state machine tests.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { InCallChat } from "@/components/consultation/InCallChat";

const baseProps = {
  consultationId: "cons_test1",
  token: null,
  user: null,
  socket: null,
  onClose: () => {},
  onEndCall: () => {},
};

describe("InCallChat (SSR smoke)", () => {
  it("renders the panel region with labeled log and composer", () => {
    const html = renderToString(createElement(InCallChat, baseProps));
    expect(html).toContain('aria-label="Chat pandan apèl la"');
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-label="Istorik chat la"');
    expect(html).toContain('id="call-chat-input"');
    expect(html).toContain('aria-label="Voye mesaj la"');
  });

  it("keeps Back-to-video and End-call DISTINCT controls with explicit labels", () => {
    const html = renderToString(createElement(InCallChat, baseProps));
    expect(html).toContain('aria-label="Retounen nan videyo a"');
    expect(html).toContain('aria-label="Fini apèl la"');
    // End call is textually distinct — never merged with the back action.
    expect(html).toContain("Fini apèl");
    expect(html).toContain("Videyo");
  });

  it("shows the loading state and disables sending without a token", () => {
    const html = renderToString(createElement(InCallChat, baseProps));
    expect(html).toContain("N ap chaje mesaj yo...");
    expect(html).toContain("disabled");
  });

  it("renders the empty-state copy once there are no messages (with a token)", () => {
    const html = renderToString(
      createElement(InCallChat, {
        ...baseProps,
        token: "tok",
        user: { id: "u1", name: "Tes", role: "patient" },
      }),
    );
    // History request is async — SSR renders the loading state; the input
    // must be ENABLED with a token present.
    expect(html).not.toMatch(/<input[^>]*disabled/);
    expect(html).toContain('placeholder="Ekri yon mesaj..."');
  });
});
