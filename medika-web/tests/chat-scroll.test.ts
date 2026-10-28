/**
 * Chat scroll helpers (issue #16) — pure DOM-math tests with fake elements,
 * plus source contracts wiring the scroll controller into both chat pages.
 * Issue #47 extends the contracts to the Android keyboard layout behavior:
 * viewport resize mode, container re-pinning, and composer input attributes.
 */
import { describe, expect, it } from "vitest";
import { isNearBottom, messageDelta, scrollToBottomInstant, shouldStickToBottom } from "@/lib/chat/scroll";

function fakeEl(scrollTop: number, clientHeight: number, scrollHeight: number) {
  return {
    scrollTop,
    clientHeight,
    scrollHeight,
    style: { scrollBehavior: "" } as { scrollBehavior: string },
    scrollTo: (_opts: { top: number }) => {
      throw new Error("instant path must not use scrollTo");
    },
  } as unknown as HTMLElement;
}

describe("isNearBottom", () => {
  it("is true exactly at the bottom", () => {
    // 1000 content, 400 viewport → scrollTop 600 is the floor.
    expect(isNearBottom(fakeEl(600, 400, 1000))).toBe(true);
  });

  it("tolerates the configured threshold", () => {
    expect(isNearBottom(fakeEl(600 - 96, 400, 1000))).toBe(true);
    expect(isNearBottom(fakeEl(600 - 97, 400, 1000))).toBe(false);
  });

  it("honors a custom threshold", () => {
    expect(isNearBottom(fakeEl(500, 400, 1000), 10)).toBe(false);
    expect(isNearBottom(fakeEl(592, 400, 1000), 10)).toBe(true);
  });

  it("is false while the user reads history", () => {
    expect(isNearBottom(fakeEl(0, 400, 1000))).toBe(false);
    expect(isNearBottom(fakeEl(120, 400, 2400))).toBe(false);
  });

  it("handles an empty list (nothing to scroll)", () => {
    expect(isNearBottom(fakeEl(0, 400, 400))).toBe(true);
  });
});

describe("scrollToBottomInstant", () => {
  it("jumps to the bottom without animation, even over CSS smooth", () => {
    const el = fakeEl(0, 400, 2000);
    el.style.scrollBehavior = ""; // CSS class carries `smooth`
    scrollToBottomInstant(el);
    expect(el.scrollTop).toBe(2000);
    // The inline override must disable smooth for the jump and be restored.
    expect(el.style.scrollBehavior).toBe("");
  });

  it("restores a pre-existing inline behavior", () => {
    const el = fakeEl(0, 400, 2000);
    el.style.scrollBehavior = "smooth";
    scrollToBottomInstant(el);
    expect(el.scrollTop).toBe(2000);
    expect(el.style.scrollBehavior).toBe("smooth");
  });
});

describe("messageDelta", () => {
  it("counts newly arrived messages", () => {
    expect(messageDelta(10, 13)).toBe(3);
  });

  it("never counts removals or resets as missed messages", () => {
    expect(messageDelta(13, 10)).toBe(0);
    expect(messageDelta(null, 10)).toBe(0);
  });
});

describe("shouldStickToBottom", () => {
  it("sticks only when the user is at the bottom", () => {
    expect(shouldStickToBottom(true)).toBe(true);
    expect(shouldStickToBottom(false)).toBe(false);
  });
});

describe("Source contracts — chat pages wiring (issue #16)", () => {
  const read = async (p: string) => (await import("node:fs")).readFileSync(p, "utf8");

  it("consultation chat uses the scroll controller and the inner wrapper", async () => {
    const src = await read("app/app/consultations/[id]/page.tsx");
    expect(src).toContain("useChatScroll({");
    expect(src).toContain("const { logRef, jumpVisible, jumpCount, jumpToLatest } = useChatScroll");
    // The initial land must replace the old unconditional force-scroll.
    expect(src).not.toContain("log.scrollTop = log.scrollHeight;");
    // Content lives inside one resize-observed wrapper.
    expect(src).toContain('className="chat-log-inner"');
    // Jump-to-latest affordance with a missed-messages count.
    expect(src).toContain("jump-latest");
    expect(src).toContain("mesaj nouvo");
  });

  it("ticket chat gets the same treatment", async () => {
    const src = await read("app/app/tickets/[id]/page.tsx");
    expect(src).toContain("useChatScroll({");
    expect(src).toContain("const { logRef, jumpVisible, jumpCount, jumpToLatest } = useChatScroll");
    expect(src).not.toContain("log.scrollTop = log.scrollHeight;");
    expect(src).toContain('className="chat-log-inner"');
    expect(src).toContain("jump-latest");
  });

  it("the hook implements the full lifecycle (initial land, pinning, pill)", async () => {
    const src = await read("components/consultation/useChatScroll.ts");
    expect(src).toContain("scrollToBottomInstant");
    expect(src).toContain("ResizeObserver");
    expect(src).toContain("isNearBottom");
    expect(src).toContain("useLayoutEffect"); // pre-paint initial land — no flicker
  });

  it("globals.css ships the pill and the wrapper styles", async () => {
    const css = await read("app/globals.css");
    expect(css).toContain(".jump-latest {");
    expect(css).toContain(".chat-log-inner");
  });
});

describe("Source contracts — Android keyboard layout (issue #47)", () => {
  const read = async (p: string) => (await import("node:fs")).readFileSync(p, "utf8");

  it("the viewport export opts into resizes-content so the keyboard shrinks the layout", async () => {
    const src = await read("app/layout.tsx");
    // The Viewport type must stay imported from "next" (typed config, not a
    // hand-written meta tag).
    expect(src).toContain('import type { Metadata, Viewport } from "next"');
    // The directive: without it, Chrome Android keeps the layout viewport at
    // full height (resizes-visual default) and pans the visual viewport up,
    // pushing the chat header out of view.
    expect(src).toContain('interactiveWidget: "resizes-content"');
    // The rationale must live next to the directive (audit trail).
    expect(src).toContain("Issue #47");
  });

  it("chat-mode CSS keeps the full-height flex column (header fixed, log flexible)", async () => {
    const css = await read("app/visual-polish.css");
    // The chat column is exactly the viewport height and never scrolls as a
    // whole — only .chat-log does.
    expect(css).toMatch(/\.app-shell\.chat-mode \{[^}]*height: 100dvh;[^}]*overflow: hidden;/s);
    // AppShell's own header/nav are hidden on the chat screen; the chat page
    // renders its own header as the first row of the column.
    expect(css).toMatch(
      /\.app-shell\.chat-mode > \.app-header,\s*\.app-shell\.chat-mode > \.bottom-nav \{[^}]*display: none !important;/s,
    );
    // The log is the flexible, scrolling member of the column.
    expect(css).toMatch(/\.chat-log \{[^}]*min-height: 0;[^}]*overflow-y: auto;/s);
    // The composer never shrinks and clears the Android safe area.
    expect(css).toMatch(/\.chat-composer \{[^}]*flex: 0 0 auto;[^}]*env\(safe-area-inset-bottom/s);
  });

  it("useChatScroll observes the scroll container so keyboard resize re-pins the bottom", async () => {
    const src = await read("components/consultation/useChatScroll.ts");
    // Container observation — the keyboard open/close resizes the container,
    // not the inner content.
    expect(src).toContain("observer.observe(logEl)");
    expect(src).toContain("observer.observe(inner)");
    // Re-pinning stays guarded: only a bottom-pinned user follows the resize.
    expect(src).toContain("if (atBottomRef.current) logEl.scrollTop = logEl.scrollHeight;");
    expect(src).toContain("if (initialLandRef.current) return;");
  });

  it("both chat composers declare non-autofillable inputs with a send action key", async () => {
    const consultation = await read("app/app/consultations/[id]/page.tsx");
    const tickets = await read("app/app/tickets/[id]/page.tsx");
    for (const [name, src] of [
      ["consultation chat", consultation],
      ["ticket chat", tickets],
    ] as const) {
      expect(src, name).toContain('autoComplete="off"');
      expect(src, name).toContain('autoCapitalize="sentences"');
      expect(src, name).toContain('enterKeyHint="send"');
      // The keyboard-owned accessory-bar limitation must be documented where
      // the attributes are justified (audit requirement of issue #47).
      expect(src, name).toContain("Issue #47");
      expect(src, name).toContain("keyboard");
    }
  });
});
