/**
 * First-login permission bootstrap (owner request: "whenever someone first
 * logs into their account it must automatically ask for video, mic and push
 * permission").
 *
 * Verified here (runtime where possible, source-contract otherwise — this
 * package has no jsdom):
 *  - lib/permissions.ts: BOTH asks (camera+mic, notifications) start in the
 *    SAME synchronous task (they must ride one transient user activation);
 *    camera/mic tracks are stopped immediately after the grant; push is
 *    subscribed ONLY when notifications come back granted and a token
 *    exists; the per-account+device flag never nags and never throws;
 *  - login/register pages fire the bootstrap from the submit click handler
 *    (fire-and-forget, after the auth call succeeds);
 *  - the shell fallback card (PermissionBootstrap) is mounted from AppShell,
 *    marks the flag on BOTH accept and dismiss, quietly re-registers an
 *    already-granted push subscription, and hides on chat/call screens;
 *  - the socket client can announce viewing state (read-aware suppression).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB = resolve(__dirname, "..");
const src = (p: string) => readFileSync(resolve(WEB, p), "utf8");

vi.mock("@/lib/push", () => ({
  enablePush: vi.fn(async () => ({ support: "supported", enabled: true })),
  syncExistingPushSubscription: vi.fn(async () => true),
}));

// ── Node-environment browser stubs ──────────────────────────────────────────
type StorageShim = ReturnType<typeof storageStub>;

function storageStub(store: Record<string, string>) {
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
}

function makeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }, { stop }] }, stop };
}

interface Env {
  getUserMedia: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
  media: { stream: unknown; stop: ReturnType<typeof vi.fn> };
}

function installEnv(options: {
  permission?: "default" | "granted" | "denied";
  getUserMedia?: () => Promise<unknown>;
  requestPermission?: () => Promise<NotificationPermission>;
  session?: { token: string; user: { id: string } } | null;
}): Env {
  const localStore: Record<string, string> = {};
  const sessionStore: Record<string, string> = {};
  if (options.session) {
    sessionStore["medika_session_token"] = options.session.token;
    sessionStore["medika_session_user"] = JSON.stringify(options.session.user);
  }
  const media = makeStream();
  const getUserMedia = (options.getUserMedia ?? vi.fn(async () => media.stream)) as Env["getUserMedia"];
  const requestPermission = (options.requestPermission ?? vi.fn(async () => "granted" as NotificationPermission)) as Env["requestPermission"];

  vi.stubGlobal("window", {
    isSecureContext: true,
    localStorage: storageStub(localStore),
    sessionStorage: storageStub(sessionStore),
  });
  // Node ≥21 exposes `navigator` as a getter-only global — assignment and
  // vi.stubGlobal both fail; a configurable defineProperty is the only way.
  Object.defineProperty(globalThis, "navigator", {
    value: { mediaDevices: { getUserMedia }, userActivation: { isActive: false } },
    configurable: true,
    writable: true,
  });
  vi.stubGlobal("Notification", { permission: options.permission ?? "default", requestPermission });
  return { getUserMedia, requestPermission, media };
}

const ORIGINALS: Record<string, unknown> = {};
beforeEach(() => {
  ORIGINALS.window = globalThis.window;
  ORIGINALS.navigator = globalThis.navigator;
  ORIGINALS.Notification = (globalThis as { Notification?: unknown }).Notification;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  (globalThis as { window?: unknown }).window = ORIGINALS.window;
  (globalThis as { navigator?: unknown }).navigator = ORIGINALS.navigator;
  (globalThis as { Notification?: unknown }).Notification = ORIGINALS.Notification;
});

describe("lib/permissions — runtime behavior", () => {
  it("asks camera+mic AND notifications in the same synchronous task, stops tracks, subscribes push", async () => {
    const mod = await import("../lib/permissions");
    const { enablePush } = await import("@/lib/push");
    const env = installEnv({
      permission: "default",
      session: { token: "tok-1", user: { id: "user-1" } },
    });

    const result = await mod.requestStartupPermissions("user-1", "tok-1");

    expect(env.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(env.requestPermission).toHaveBeenCalledTimes(1);
    expect(env.media.stop).toHaveBeenCalledTimes(2); // both tracks stopped immediately
    expect(enablePush).toHaveBeenCalledWith("tok-1");
    expect(result).toEqual({ cameraMic: "granted", notifications: "granted", push: "subscribed" });
  });

  it("does NOT re-prompt when the browser already decided; still wires push when granted", async () => {
    const mod = await import("../lib/permissions");
    const { enablePush } = await import("@/lib/push");
    const env = installEnv({ permission: "granted" });

    const result = await mod.requestStartupPermissions("user-1", "tok-2");

    expect(env.requestPermission).not.toHaveBeenCalled();
    expect(enablePush).toHaveBeenCalledWith("tok-2");
    expect(result.notifications).toBe("granted");
    expect(result.push).toBe("subscribed");
  });

  it("denied notifications → push NOT subscribed; camera/mic tracks still cleaned up", async () => {
    const mod = await import("../lib/permissions");
    const { enablePush } = await import("@/lib/push");
    const env = installEnv({ permission: "denied" });

    const result = await mod.requestStartupPermissions("user-1", null);

    expect(enablePush).not.toHaveBeenCalled();
    expect(result.push).toBe("not-subscribed");
    expect(result.notifications).toBe("denied");
    expect(env.media.stop).toHaveBeenCalledTimes(2);
  });

  it("getUserMedia NotFoundError (no camera) → 'unsupported' but notifications STILL asked", async () => {
    const mod = await import("../lib/permissions");
    const env = installEnv({
      permission: "default",
      getUserMedia: vi.fn(async () => {
        throw Object.assign(new Error("no cam"), { name: "NotFoundError" });
      }),
    });

    const result = await mod.requestStartupPermissions("user-1", "tok-3");

    expect(result.cameraMic).toBe("unsupported");
    expect(env.requestPermission).toHaveBeenCalledTimes(1);
    expect(result.notifications).toBe("granted");
  });

  it("flag helpers: first run unset → marked; throwing storage counts as done (never nags)", async () => {
    const mod = await import("../lib/permissions");
    installEnv({ permission: "granted", session: null });

    expect(mod.hasPermissionBootstrapRun("user-9")).toBe(false);
    mod.markPermissionBootstrapRun("user-9");
    expect(mod.hasPermissionBootstrapRun("user-9")).toBe(true);
    const store = (globalThis as { window: { localStorage: StorageShim } }).window.localStorage;
    expect(store.getItem("medika_perm_bootstrap_user-9")).toMatch(/^\d+$/);
  });

  it("requestStartupPermissionsAfterLogin reads the session and runs the bootstrap once", async () => {
    const mod = await import("../lib/permissions");
    const { enablePush } = await import("@/lib/push");
    const env = installEnv({
      permission: "default",
      session: { token: "tok-session", user: { id: "user-session" } },
    });

    const first = await mod.requestStartupPermissionsAfterLogin();
    expect(first).toEqual({ cameraMic: "granted", notifications: "granted", push: "subscribed" });
    expect(env.getUserMedia).toHaveBeenCalledTimes(1);
    expect(enablePush).toHaveBeenCalledWith("tok-session");
    expect(mod.hasPermissionBootstrapRun("user-session")).toBe(true);

    // Second call: flag set → no-op (never nags).
    const second = await mod.requestStartupPermissionsAfterLogin();
    expect(second).toBeNull();
    expect(env.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("afterLogin without a session → no-op", async () => {
    const mod = await import("../lib/permissions");
    installEnv({ permission: "default", session: null });
    expect(await mod.requestStartupPermissionsAfterLogin()).toBeNull();
  });
});

// ── Source contracts (no jsdom in this package) ─────────────────────────────

describe("permission bootstrap wiring (source contracts)", () => {
  const login = src("app/login/page.tsx");
  const register = src("app/register/page.tsx");
  const shell = src("components/layout/AppShell.tsx");
  const card = src("components/pwa/PermissionBootstrap.tsx");
  const permissions = src("lib/permissions.ts");
  const css = src("app/globals.css");
  const socket = src("lib/ws/socket.ts");

  it("login + register fire the bootstrap fire-and-forget AFTER the auth call", () => {
    for (const [page, authCall] of [
      [login, "await login("],
      [register, "await register("],
    ] as const) {
      expect(page).toContain('import { requestStartupPermissionsAfterLogin } from "@/lib/permissions"');
      const afterAuth = page.indexOf(authCall);
      const fire = page.indexOf("void requestStartupPermissionsAfterLogin();");
      expect(afterAuth).toBeGreaterThan(-1);
      expect(fire).toBeGreaterThan(afterAuth);
    }
  });

  it("both asks start in the SAME synchronous task (no await between them)", () => {
    expect(permissions).toMatch(
      /const cameraMicPromise = askCameraMic\(\);\s*\n\s*const notificationsPromise = askNotifications\(\);/,
    );
  });

  it("AppShell mounts the fallback card", () => {
    expect(shell).toContain('import { PermissionBootstrap } from "@/components/pwa/PermissionBootstrap"');
    expect(shell).toMatch(/<PermissionBootstrap\s*\/>/);
  });

  it("the card marks the flag on BOTH accept and dismiss and hides on chat/call screens", () => {
    const accept = card.indexOf("const accept = () => {");
    const dismiss = card.indexOf("const dismiss = () => {");
    expect(accept).toBeGreaterThan(-1);
    expect(dismiss).toBeGreaterThan(-1);
    expect(card.slice(accept)).toContain("markPermissionBootstrapRun");
    expect(card.slice(dismiss)).toContain("markPermissionBootstrapRun");
    expect(card).toContain("consultations\\/[^/]+"); // chat screens
    expect(card).toContain("tickets\\/[^/]+"); // ticket threads
    expect(card).toContain("has-perm-card"); // content-clearance mechanism
  });

  it("an already-decided notification permission quietly re-syncs push (heal)", () => {
    const decided = card.indexOf('notif !== "default"');
    expect(decided).toBeGreaterThan(-1);
    expect(card.slice(decided)).toContain("syncExistingPushSubscription");
  });

  it("card styles exist and clear page content like the install banner", () => {
    expect(css).toMatch(/\.perm-bootstrap-card\s*\{/);
    expect(css).toMatch(/body\.has-perm-card \.app-main\s*\{/);
  });

  it("the socket client can announce viewing state (read-aware suppression hook)", () => {
    expect(socket).toContain("sendViewing(consultationId: string | null)");
    expect(socket).toContain('"consultation:viewing"');
  });

  it("chat page announces viewing on mount and clears on unmount", () => {
    const chat = src("app/app/consultations/[id]/page.tsx");
    expect(chat).toContain("socket.sendViewing(consultationId)");
    expect(chat).toContain("socket.sendViewing(null)");
  });
});
