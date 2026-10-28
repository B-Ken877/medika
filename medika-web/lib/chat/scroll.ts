/**
 * Chat scroll helpers — pure, testable pieces of the message-list scrolling
 * (issue #16).
 *
 * Contract implemented across the chat pages:
 *  - opening a conversation lands on the LATEST message (instant, no flicker,
 *    after the history has rendered — never a visible top→bottom jump);
 *  - switching conversations re-arms the initial scroll for the new thread;
 *  - new content (messages, optimistic entries, typing rows) only sticks to
 *    the bottom while the user is already NEAR the bottom — reading history
 *    is never interrupted by a forced scroll;
 *  - content resizes (images loading above the viewport) keep a pinned user
 *    pinned, and never yank a user who deliberately scrolled up.
 */

/** Distance (px) from the bottom that still counts as "at the bottom". */
export const NEAR_BOTTOM_PX = 96;

/** True when the element is scrolled to (near) its bottom. Pure DOM math. */
export function isNearBottom(el: { scrollHeight: number; scrollTop: number; clientHeight: number }, threshold = NEAR_BOTTOM_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/** Jump to the bottom WITHOUT animation, regardless of the CSS
 *  `scroll-behavior: smooth` on the container (the initial land must not be
 *  a visible smooth flight from the top). */
export function scrollToBottomInstant(el: HTMLElement): void {
  const previous = el.style.scrollBehavior;
  el.style.scrollBehavior = "auto";
  el.scrollTop = el.scrollHeight;
  el.style.scrollBehavior = previous || "";
}

/** Animated jump used by the explicit "jump to latest" affordance. */
export function scrollToBottomSmooth(el: HTMLElement): void {
  try {
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  } catch {
    // Very old engines without ScrollOptions — fall back to the CSS behavior.
    el.scrollTop = el.scrollHeight;
  }
}

/** How many messages arrived since the last observed count (never negative). */
export function messageDelta(previousCount: number | null, currentCount: number): number {
  if (previousCount === null) return 0;
  return Math.max(0, currentCount - previousCount);
}

/** Decision core: should new content stick the list to the bottom?
 *  Only when the user is already near the bottom (or explicitly asked). */
export function shouldStickToBottom(nearBottom: boolean): boolean {
  return nearBottom;
}
