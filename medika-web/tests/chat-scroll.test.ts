/**
 * Chat scroll helpers (issue #16) — pure DOM-math tests with fake elements,
 * plus source contracts wiring the scroll controller into both chat pages.
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
