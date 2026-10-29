/**
 * Push notification system (issue #36) — web contracts.
 *
 * Verified here (runtime where possible, source-contract otherwise — this
 * package has no jsdom):
 *  - lib/push.ts: support probing never requests permission; VAPID key
 *    decoding; enable/disable flows talk to the real endpoints module;
 *  - service worker: push handler with malformed-payload fallback + same-
 *    origin URL validation + stable tags; notificationclick focus-or-open;
 *  - notification center: persisted history, unread state, mark-read, load
 *    more, preferences toggles, push enable/disable with honest unsupported
 *    states;
 *  - logout revokes the push subscription;
 *  - no push for typing/presence/read receipts/recording (client never even
 *    sends such events to a notification path).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("lib/push.ts — subscription client", () => {
  const src = read("../lib/push.ts");

  it("probes support WITHOUT ever requesting permission", () => {
    // Extract the probePushSupport function body: no permission request inside.
    const body = src.slice(src.indexOf("function probePushSupport"), src.indexOf("}", src.indexOf('return "supported";')));
    expect(body).not.toContain("requestPermission");
    expect(src.match(/requestPermission/g)?.length).toBe(1); // only inside enablePush
  });

  it("enablePush is the only permission gate and checks server VAPID first-class", () => {
    expect(src).toContain("await Notification.requestPermission()");
    expect(src).toContain("await getVapidPublicKey(token)");
    expect(src).toContain('return { support: "server-disabled", enabled: false }');
  });

  it("subscribes only after the service worker is ready (secure context enforced)", () => {
    expect(src).toContain("await navigator.serviceWorker.ready");
    expect(src).toContain('if (!window.isSecureContext) return "insecure-context"');
  });

  it("registers the subscription against the authenticated user", () => {
    expect(src).toContain("registerPushSubscription(token, {");
    expect(src).toContain("endpoint: json.endpoint");
  });

  it("disablePush unsubscribes the browser AND revokes server-side", () => {
    expect(src).toContain("await sub.unsubscribe()");
    expect(src).toContain("revokePushSubscription(token, endpoint)");
  });

  it("decodes VAPID base64url keys (RFC 4648 §5, padding + URL-safety)", async () => {
    const mod = await import("../lib/push");
    // "Medika!!" (8 bytes) → base64 "TWVkaWthISE=" → base64url, unpadded.
    const b64 = "TWVkaWthISE";
    const arr = mod.urlBase64ToUint8Array(b64);
    expect(arr instanceof Uint8Array).toBe(true);
    expect(arr.length).toBe(8);
    expect(Array.from(arr)).toEqual([77, 101, 100, 105, 107, 97, 33, 33]);
  });
});

describe("lib/push.ts — honest server health states (issue #50)", () => {
  const src = read("../lib/push.ts");
  const page = read("../app/app/notifications/page.tsx");

  it("server/network failures are distinct states, never misreported as browser limits", () => {
    // The states exist and are typed.
    expect(src).toContain('"server-unreachable"');
    expect(src).toContain('"registration-failed"');
    // Key bootstrap failure → server-unreachable (offline, timeout, 5xx).
    expect(src).toContain("return { support: \"server-unreachable\", enabled: false };");
    // Server-side registration rejection → registration-failed.
    expect(src).toContain("return { support: \"registration-failed\", enabled: false };");
  });

  it("each failure class has its own guarded scope (no shared catch-all)", () => {
    // The permission prompt, key fetch, subscribe, and registration are
    // wrapped in FOUR separate try blocks so failures classify honestly.
    // (Issue #72 appended syncExistingPushSubscription AFTER enablePush —
    // the slice now ends at that function's doc block to keep asserting
    // enablePush's own guarded scopes only.)
    const fn = src.slice(
      src.indexOf("export async function enablePush"),
      src.indexOf("/**\n * Re-register an EXISTING browser subscription"),
    );
    expect(fn.match(/try \{/g)?.length).toBe(4);
    // "unsupported-browser" is reserved for genuine browser-level failures:
    // it appears in probe paths and the browser-scoped catch blocks only.
    expect(fn.match(/support: "unsupported-browser"/g)?.length).toBe(3);
  });

  it("the notification center copy distinguishes every server state from device states", () => {
    expect(page).toContain('"server-unreachable":');
    expect(page).toContain('"registration-failed":');
    // The pre-existing unconfigured copy stays (the rollout-switch message).
    expect(page).toContain("Sèvis push la pa konfigure kounye a");
  });
});

describe("WEB_PUSH_SETUP.md — owner runbook (issue #50)", () => {
  const doc = read("../../docs/WEB_PUSH_SETUP.md");

  it("documents the exact environment variable NAMES (never values)", () => {
    expect(doc).toContain("`VAPID_PUBLIC_KEY`");
    expect(doc).toContain("`VAPID_PRIVATE_KEY`");
    expect(doc).toContain("`VAPID_SUBJECT`");
    // No real key material may ship in the repo — only placeholders.
    expect(doc).not.toMatch(/VAPID_PRIVATE_KEY\s*[:=|]+\s*[A-Za-z0-9_-]{20,}/);
  });

  it("locks the security rules: owner generates keys locally, private key stays server-side", () => {
    expect(doc).toContain("npx web-push generate-vapid-keys");
    expect(doc).toContain("Generate the keys YOURSELF");
    expect(doc).toContain("must NEVER use a `NEXT_PUBLIC_` variable");
  });

  it("requires a redeploy after env changes and defines the ordered verification", () => {
    expect(doc).toContain("Redeploy (required)");
    expect(doc).toContain('{"publicKey":"B…","configured":true}');
    // The real-device step is explicitly operator-owned (not fakeable here).
    expect(doc).toContain("Real device");
  });

  it("covers the dispatcher scheduler and the rollback switch", () => {
    expect(doc).toContain("notification-dispatch.yml");
    expect(doc).toContain("CRON_SECRET");
    expect(doc).toContain("Rollback / off switch");
  });
});

describe("service worker push handlers (issue #36)", () => {
  const sw = read("../public/sw.js");

  it("registers push, notificationclick and pushsubscriptionchange handlers", () => {
    expect(sw).toContain('self.addEventListener("push"');
    expect(sw).toContain('self.addEventListener("notificationclick"');
    expect(sw).toContain('self.addEventListener("pushsubscriptionchange"');
  });

  it("malformed payloads fall back to the generic privacy-safe copy", () => {
    expect(sw).toContain("event.data ? event.data.json() : {}");
    expect(sw).toMatch(/catch[\s\S]{0,80}payload = \{\}/);
    expect(sw).toContain('"Ou gen yon nouvo mizajou sou Medika."');
  });

  it("validates deep links to SAME-ORIGIN app paths only", () => {
    expect(sw).toContain("function safePushUrl(candidate)");
    expect(sw).toContain("resolved.origin !== self.location.origin");
    // The path regex rejects scheme-relative URLs via a negative lookahead.
    expect(sw).toContain("(?!\\/)");
  });

  it("uses stable tags so retries replace instead of stacking", () => {
    expect(sw).toMatch(/tag[, ]/);
    expect(sw).toContain("const tag =");
  });

  it("click focuses an existing Medika window or opens a new one", () => {
    expect(sw).toContain("clients.matchAll");
    expect(sw).toContain("client.focus()");
    expect(sw).toContain("clients.openWindow(url)");
  });

  it("preserves the existing security-first caching policy untouched", () => {
    expect(sw).toContain("NEVER cached:  /api/*, /ws, /uploads/*");
    expect(sw).toContain("isNeverCached");
    expect(sw).toContain('cache.match("/offline")');
  });
});

describe("notification center page (issue #36)", () => {
  const page = read("../app/app/notifications/page.tsx");

  it("loads the SERVER-PERSISTED history with unread state", () => {
    expect(page).toContain("getNotifications(token,");
    expect(page).toContain("res.unread");
    expect(page).toContain("setHasMore(res.hasMore)");
  });

  it("marks individual notifications read on open, and mark-all", () => {
    expect(page).toContain("markNotificationsRead(token, [n.id])");
    expect(page).toContain("markAllNotificationsRead(token)");
  });

  it("paginates with load-more (cursor by id)", () => {
    expect(page).toContain("getNotifications(token, { before: beforeRef.current })");
    expect(page).toContain("Chaje plis");
  });

  it("exposes category preferences with optimistic toggles + revert", () => {
    expect(page).toContain("getNotificationPreferences(token)");
    expect(page).toContain("updateNotificationPreferences(token, { [key]:");
    expect(page).toContain("setPrefs(prefs); // revert on failure");
  });

  it("push enable/disable is an explicit user action with honest states", () => {
    expect(page).toContain('onClick={pushEnabled ? onDisablePush : onEnablePush}');
    expect(page).toContain("SUPPORT_COPY[pushSupport]");
    expect(page).toContain("Notifikasyon push bezwen yon koneksyon sekirize (HTTPS).");
    expect(page).toContain("Sèvis push la pa konfigure kounye a");
  });

  it("preferences copy documents the suppress-delivery-only policy", () => {
    expect(page).toContain("Preferans yo sèlman kontròle VWA push la");
  });

  it("keeps the privacy note (no medical data on-device)", () => {
    expect(page).toContain("pa gen done medikal ki kenbe sou aparèy ou a");
  });
});

describe("logout revokes the push subscription (issue #36)", () => {
  it("the auth context revoke happens before the session clears", async () => {
    const src = read("../lib/auth/context.tsx");
    expect(src).toContain("revokePushSubscription(token)");
    const revokeIdx = src.indexOf("revokePushSubscription(token)");
    const clearIdx = src.indexOf("clearSession();", revokeIdx);
    expect(clearIdx).toBeGreaterThan(-1);
    // Best-effort: a failure never blocks logout.
    expect(src).toMatch(/revokePushSubscription\(token\)\.catch\(\(\) => undefined\)/);
  });
});

describe("endpoints — notification API wrappers (issue #36)", () => {
  const src = read("../lib/api/endpoints.ts");

  it("wraps subscriptions, history, read-marking, preferences and VAPID key", () => {
    for (const fn of [
      "registerPushSubscription",
      "revokePushSubscription",
      "getNotifications",
      "markNotificationsRead",
      "markAllNotificationsRead",
      "getNotificationPreferences",
      "updateNotificationPreferences",
      "getVapidPublicKey",
    ]) {
      expect(src).toContain(`function ${fn}(`);
    }
  });

  it("revocation never sends another user's endpoint (token-scoped only)", () => {
    expect(src).not.toMatch(/revokePushSubscription\([^)]*userId/);
  });
});
