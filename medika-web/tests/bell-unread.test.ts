/**
 * Issue #72 regression — header bell unread badge + notification sync.
 *
 * Root cause fixed: the bell was a bare <Link> with NO unread count and no
 * component subscribed to unread state anywhere in the shell, so new
 * messages never changed the bell; the notification center also ignored
 * message:new while open, and pushsubscriptionchange renewals never reached
 * the server.
 *
 * Verified here (source-contract pattern — no jsdom in this package):
 *   - AppShell renders a count badge bound to useUnread + accessible label;
 *   - UnreadProvider treats the SERVER endpoint as the only source of truth
 *     (WS events/reconnect/visibility/poll only prompt refetches);
 *   - the notification center reloads on message:new and re-syncs the bell
 *     after read actions;
 *   - the push subscription re-sync never requests permission.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

const shell = read("../components/layout/AppShell.tsx");
const provider = read("../components/notifications/UnreadProvider.tsx");
const page = read("../app/app/notifications/page.tsx");
const endpoints = read("../lib/api/endpoints.ts");
const push = read("../lib/push.ts");
const css = read("../app/globals.css");

describe("header bell unread badge (issue #72)", () => {
  it("the bell renders a server-authoritative count badge", () => {
    expect(shell).toContain("const { unread } = useUnread();");
    expect(shell).toContain('className="bell-count"');
    expect(shell).toMatch(/unread > 0 &&\s*\(/); // hidden at zero
    expect(shell).toContain('unread > 99 ? "99+" : unread');
  });

  it("the accessible label announces the pending count", () => {
    expect(shell).toContain("`Notifikasyon — ${unread} pa li`");
    expect(shell).toContain('aria-label={unread > 0 ?');
  });

  it("the badge uses the Medika green tokens and is hidden at zero", () => {
    const badge = css.slice(css.indexOf(".icon-btn .bell-count"));
    expect(badge).toContain("background: var(--green-600)");
    expect(badge).toContain("position: absolute");
    expect(badge).toContain("pointer-events: none");
  });
});

describe("UnreadProvider — server truth + prompt-based refresh", () => {
  it("fetches the dedicated unread endpoint (never trusts WS numbers)", () => {
    expect(endpoints).toContain('"/api/notifications/unread"');
    expect(provider).toContain("getUnreadNotificationCount(token)");
    // No WS payload may set the count directly.
    expect(provider).not.toMatch(/setUnread\(\s*(?!n\b)[^)]*(event|payload)/);
  });

  it("prompts a debounced refetch on message and consultation events", () => {
    expect(provider).toContain('event.type === "message:new"');
    expect(provider).toContain('event.type === "consultation:new"');
    expect(provider).toContain('event.type === "consultation:updated"');
    expect(provider).toContain("REFETCH_DEBOUNCE_MS");
  });

  it("survives refresh, reconnect, visibility changes and missed events", () => {
    expect(provider).toMatch(/wsStatus === "open"/); // refetch on reconnect
    expect(provider).toContain('document.addEventListener("visibilitychange", onVisible)');
    expect(provider).toContain("POLL_INTERVAL_MS");
  });

  it("re-syncs the existing push subscription without prompting", () => {
    expect(provider).toContain("syncExistingPushSubscription(token)");
    const sync = push.slice(push.indexOf("export async function syncExistingPushSubscription"));
    expect(sync).toContain("getSubscription()");
    expect(sync).not.toContain("requestPermission"); // never prompts
  });
});

describe("notification center sync (issue #72)", () => {
  it("reloads the persisted view when a message:new arrives", () => {
    expect(page).toContain('event.type === "message:new"');
  });

  it("keeps the header bell in sync after read actions", () => {
    expect(page).toContain("refreshBellCount()");
  });
});
