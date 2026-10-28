"use client";

/**
 * useChatScroll — issue #16 controller for a chat message list.
 *
 * Owns the full scroll lifecycle of a `.chat-log` container:
 *  1. INITIAL LAND — when `ready` first becomes true for a conversation the
 *     list is positioned at the bottom INSTANTLY (useLayoutEffect → before
 *     paint, so there is no top→bottom flicker), even when the history loads
 *     asynchronously.
 *  2. CONVERSATION SWITCH — changing `conversationId` re-arms the initial
 *     land (each thread opens on its latest message).
 *  3. STICK TO BOTTOM — new content appends scroll to the bottom ONLY while
 *     the user is near the bottom; reading history is never interrupted.
 *  4. MISSED-MESSAGES PILL — messages that arrive while the user is scrolled
 *     up are counted and surfaced (`jumpCount`) with a jump affordance.
 *  5. RESIZE PINNING — a ResizeObserver keeps a bottom-pinned user pinned
 *     when content above resizes (chat images finishing their load) AND when
 *     the container itself resizes (issue #47: Android keyboard open/close).
 *     A user reading history is never moved by a resize.
 *
 * Pages must render the scrollable children inside ONE wrapper element
 * (`.chat-log-inner`) so the observer can track content growth, and attach
 * the returned `logRef` (a callback ref — chat pages can render a full-page
 * loader first, so the log element may mount AFTER the data resolves; the
 * callback ref guarantees the effects re-arm when it appears).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isNearBottom, messageDelta, scrollToBottomInstant, scrollToBottomSmooth } from "@/lib/chat/scroll";

export interface ChatScrollOptions {
  /** Conversation/route identity — a change re-arms the initial land. */
  conversationId: string;
  /** False while the initial history is still loading. */
  ready: boolean;
  /** Total rendered entries (persisted + optimistic) — drives the missed count. */
  messageCount: number;
  /** Changes whenever the rendered content grows (length, last id, pending, typing). */
  contentVersion: string;
}

export interface ChatScrollState {
  /** Attach to the scroll container: <div className="chat-log" ref={logRef}>. */
  logRef: (el: HTMLDivElement | null) => void;
  /** Whether the "new messages / jump to latest" affordance is visible. */
  jumpVisible: boolean;
  /** How many messages arrived while the user was scrolled up (0 = none). */
  jumpCount: number;
  /** Smooth-scroll to the latest message and clear the affordance. */
  jumpToLatest: () => void;
}

export function useChatScroll(opts: ChatScrollOptions): ChatScrollState {
  const { conversationId, ready, messageCount, contentVersion } = opts;

  const [jumpVisible, setJumpVisible] = useState(false);
  const [jumpCount, setJumpCount] = useState(0);
  /** The mounted log element (state → effects re-run when it appears). */
  const [logEl, setLogEl] = useState<HTMLDivElement | null>(null);
  const logElRef = useRef<HTMLDivElement | null>(null);

  const atBottomRef = useRef(true);
  const initialLandRef = useRef(true);
  const prevCountRef = useRef<number | null>(null);
  const missedRef = useRef(0);

  // Callback ref: fires on mount/unmount (and Strict Mode replays) — the
  // guarded setState keeps it idempotent while still re-arming the effects.
  const logRef = useCallback((el: HTMLDivElement | null) => {
    logElRef.current = el;
    setLogEl((prev) => (prev === el ? prev : el));
  }, []);

  // Conversation switch: re-arm the initial land and clear the affordance.
  useEffect(() => {
    initialLandRef.current = true;
    prevCountRef.current = null;
    missedRef.current = 0;
    atBottomRef.current = true;
    setJumpVisible(false);
    setJumpCount(0);
  }, [conversationId]);

  // Track whether the user is at (or near) the bottom on every scroll.
  useEffect(() => {
    if (!logEl) return;
    const onScroll = () => {
      const near = isNearBottom(logEl);
      atBottomRef.current = near;
      if (near && missedRef.current > 0) {
        missedRef.current = 0;
        setJumpVisible(false);
        setJumpCount(0);
      }
    };
    logEl.addEventListener("scroll", onScroll, { passive: true });
    return () => logEl.removeEventListener("scroll", onScroll);
  }, [logEl, conversationId]);

  // Core: initial land (instant, pre-paint) + stick-to-bottom on new content.
  useLayoutEffect(() => {
    if (!logEl || !ready) return;
    if (initialLandRef.current) {
      scrollToBottomInstant(logEl);
      atBottomRef.current = true;
      initialLandRef.current = false;
      prevCountRef.current = messageCount;
      return;
    }
    const delta = messageDelta(prevCountRef.current, messageCount);
    prevCountRef.current = messageCount;
    if (isNearBottom(logEl)) {
      // Pinned: follow new content down (CSS scroll-behavior smoothens it).
      logEl.scrollTop = logEl.scrollHeight;
    } else if (delta > 0) {
      // Reading history: never yank — surface a missed-messages affordance.
      missedRef.current += delta;
      setJumpVisible(true);
      setJumpCount(missedRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentVersion, ready, logEl, messageCount, conversationId]);

  // Resize pinning: images and late content above must not unpin a user who
  // is at the bottom — and must never move the viewport for one who is not.
  // Issue #47: the scroll CONTAINER itself is observed too. On Android the
  // keyboard opening/closing resizes the container (interactive-widget=
  // resizes-content shrinks 100dvh); without this observation a bottom-pinned
  // user would be left staring at the middle of the conversation (the browser
  // keeps scrollTop while clientHeight shrinks). Re-pinning only happens when
  // the user is already at the bottom — a reader in the history is never moved.
  useEffect(() => {
    if (!logEl || typeof ResizeObserver === "undefined") return;
    const inner = logEl.firstElementChild;
    if (!(inner instanceof HTMLElement)) return;
    const repin = () => {
      if (initialLandRef.current) return;
      if (atBottomRef.current) logEl.scrollTop = logEl.scrollHeight;
    };
    const observer = new ResizeObserver(repin);
    observer.observe(inner);
    observer.observe(logEl);
    return () => observer.disconnect();
  }, [logEl, ready, conversationId]);

  const jumpToLatest = useCallback(() => {
    const log = logElRef.current;
    if (!log) return;
    missedRef.current = 0;
    atBottomRef.current = true;
    setJumpVisible(false);
    setJumpCount(0);
    scrollToBottomSmooth(log);
  }, []);

  return { logRef, jumpVisible, jumpCount, jumpToLatest };
}
