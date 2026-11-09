/**
 * First-login permission bootstrap (owner request: "whenever someone first
 * logs into their account it must automatically ask for video, mic and push
 * permission").
 *
 * Verified here (runtime where possible, source-contract otherwise — this
 * package has no jsdom):
 *  - lib/permissions.ts: both asks (camera+mic, notifications) start in the
 *    SAME synchronous task (they must ride one transient user activation);
 *    camera/mic tracks are stopped immediately after the grant; push is
 *    subscribed ONLY when notifications come back granted and a token exists;
 *    the per-account+device flag never nags and never throws;
 *  - login/register pages fire the bootstrap from the submit click handler
 *    (fire-and-forget, after the auth call succeeds);
 *  - the shell fallback card (PermissionBootstrap) is mounted from AppShell,
 *    marks the flag on BOTH accept and dismiss, quietly wires an already-
 *    granted notification permission to the server, and never renders on
 *    chat/call screens;
 *  - the card reuses the install-banner design system (CSS tokens).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

// enablePush is lib/push.ts's job (fully covered by push-notifications.test.ts);
// here it is stubbed so the bootstrap's ORCHESTRATION is what gets verified.
vi.mock("@/lib/push", () => ({
  enablePush: vi.fn(async () => ({ support: "supported", enabled: true })),
}));

// ── DOM-ish environment shims (node environment: no window/navigator) ────────
type StorageShim = Record<string, string>;

function storageStub(store: StorageShim) {
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
}

function makeStream() {
  const stopped: string[] = [];
  const tracks = ["video", "audio"].map((kind) => ({ kind, stop: () => stopped.push(kind) }));
  return { stream: { getTracks: () => tracks }, stopped };
}

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;
const originalNotification = (globalThis as { Notification?: unknown }).Notification;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.window = originalWindow;
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true,
    writable: true,
  });
  (globalThis as { Notification?: unknown }).Notification = originalNotification;
});

function installEnv(options: {
  permission?: "default" | "granted" | "denied";
  getUserMedia?: () => Promise<unknown>;
  requestPermission?: () => Promise<NotificationPermission>;
  session?: { token: string; user: { id: string } } | null;
}) {
  const localStore: StorageShim = {};
  const sessionStore: StorageShim = {};
  if (options.session) {
    sessionStore["medika_session_token"] = options.session.token;
    sessionStore["medika_session_user"] = JSON.stringify(options.session.user);
  }
  const media = makeStream();
  const getUserMedia = options.getUserMedia ?? vi.fn(async () => media.stream);
  const requestPermission = options.requestPermission ?? vi.fn(async () => "granted" as NotificationPermission);

  vi.stubGlobal("window", {
    isSecureContext: true,
    localStorage: storageStub(localStore),
    sessionStorage: storageStub(sessionStore),
  });
  Object.defineProperty(globalThis, "navigator", {
    value: { mediaDevices: { getUserMedia } },
    configurable: true,
    writable: true,
  });
  (globalThis as { Notification?: unknown }).Notification = {
    permission: options.permission ?? "default",
    requestPermission,
  };

  return { localStore, getUserMedia, requestPermission, stopped: media.stopped };
}

describe("lib/permissions.ts — flag helpers (per account+device)", () => {
  it("starts unset, marks, and never re-nags once marked", async () => {
    const { hasPermissionBootstrapRun, markPermissionBootstrapRun } = await import("../lib/permissions");
    installEnv({ permission: "granted" });
    expect(hasPermissionBootstrapRun("user-1")).toBe(false);
    markPermissionBootstrapRun("user-1");
    expect(hasPermissionBootstrapRun("user-1")).toBe(true);
    // A DIFFERENT account on the same device still gets its own first login.
    expect(hasPermissionBootstrapRun("user-2")).toBe(false);
  });

  it("treats blocked storage as done — a private-mode session is never nagged", async () => {
    const { hasPermissionBootstrapRun } = await import("../lib/permissions");
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(hasPermissionBootstrapRun("user-1")).toBe(true);
  });
});

describe("lib/permissions.ts — requestStartupPermissions orchestration", () => {
  it("asks camera+mic and notifications, stops the tracks, subscribes push on grant", async () => {
    const mod = await import("../lib/permissions");
    const { enablePush } = await import("@/lib/push");
    const env = installEnv({ permission: "default", session: { token: "tok-1", user: { id: "user-1" } } });

    const result = await mod.requestStartupPermissions("user-1", "tok-1");

    expect(env.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(env.requestPermission).toHaveBeenCalledTimes(1);
    expect(env.stopped).toEqual(["video", "audio"]); // camera released immediately
    expect(enablePush).toHaveBeenCalledWith("tok-1");
    expect(result).toEqual({ cameraMic: "granted", notifications: "granted", push: "subscribed" });
  });

  it("does NOT call requestPermission when the browser already decided", async () => {
    const mod = await import("../lib/permissions");
    const { enablePush } = await import("@/lib/push");
    const env = installEnv({ permission: "granted" });

    const result = await mod.requestStartupPermissions("user-1", "tok-1");

    expect(env.requestPermission).not.toHaveBeenCalled(); // already decided → no prompt
    expect(enablePush).toHaveBeenCalledWith("tok-1"); // existing grant → wire it up
    expect(result.notifications).toBe("granted");
    expect(result.push).toBe("subscribed");
  });

  it("never subscribes push when notifications were denied", async () => {
    const mod = await import("../lib/permissions");
    const { enablePush } = await import("@/lib/push");
    installEnv({
      permission: "default",
      requestPermission: vi.fn(async () => "denied" as NotificationPermission),
    });

    const result = await mod.requestStartupPermissions("user-1", "tok-1");

    expect(enablePush).not.toHaveBeenCalled();
    expect(result.notifications).toBe("denied");
    expect(result.push).toBe("not-subscribed");
  });

  it("a missing camera is NOT a denial — notifications are still asked", async () => {
    const mod = await import("../lib/permissions");
    const notFound = Object.assign(new Error("no device"), { name: "NotFoundError" });
    installEnv({
      permission: "default",
      getUserMedia: vi.fn(async () => {
        throw notFound;
      }),
    });

    const result = await mod.requestStartupPermissions("user-1", "tok-1");

    expect(result.cameraMic).toBe("unsupported");
    expect(result.notifications).toBe("granted");
  });

  it("enablePush failures never propagate (settings page remains the retry path)", async () => {
    const mod = await import("../lib/permissions");
    const { enablePush } = await import("@/lib/push");
    vi.mocked(enablePush).mockRejectedValueOnce(new Error("server down"));
    installEnv({ permission: "granted" });

    const result = await mod.requestStartupPermissions("user-1", "tok-1");
    expect(result.push).toBe("not-subscribed");
  });
});

describe("lib/permissions.ts — after-login one-liner", () => {
  it("reads the fresh session and fires the asks with the authenticated identity", async () => {
    const mod = await import("../lib/permissions");
    const { enablePush } = await import("@/lib/push");
    const env = installEnv({
      permission: "default",
      session: { token: "tok-9", user: { id: "user-9" } },
    });

    await mod.requestStartupPermissionsAfterLogin();

    expect(env.getUserMedia).toHaveBeenCalled();
    expect(enablePush).toHaveBeenCalledWith("tok-9");
  });

  it("does nothing when there is no session (anonymous safety)", async () => {
    const mod = await import("../lib/permissions");
    const { enablePush } = await import("@/lib/push");
    installEnv({ permission: "default", session: null });

    await mod.requestStartupPermissionsAfterLogin();
    expect(enablePush).not.toHaveBeenCalled();
  });

  it("survives a broken environment without throwing", async () => {
    const mod = await import("../lib/permissions");
    vi.stubGlobal("window", undefined); // readSession → null
    await expect(mod.requestStartupPermissionsAfterLogin()).resolves.toBeUndefined();
  });
});

describe("both asks start in the SAME synchronous task (one user activation)", () => {
  it("the two promise starts sit back-to-back before the first await", () => {
    const src = read("../lib/permissions.ts");
    const body = src.slice(
      src.indexOf("export async function requestStartupPermissions("),
      src.indexOf("return { cameraMic, notifications, push };"),
    );
    const cameraStart = body.indexOf("const cameraMicPromise = askCameraMic();");
    const notifStart = body.indexOf("const notificationsPromise = askNotifications();");
    const firstAwait = body.indexOf("await");
    expect(cameraStart).toBeGreaterThan(-1);
    expect(notifStart).toBeGreaterThan(cameraStart);
    expect(firstAwait).toBeGreaterThan(notifStart);
  });

  it("camera/mic tracks are stopped immediately after the grant", () => {
    const src = read("../lib/permissions.ts");
    expect(src).toContain("for (const track of stream.getTracks()) track.stop();");
  });
});

describe("login + register pages fire the bootstrap from the submit click", () => {
  it("the login page fires it right after login() succeeds, fire-and-forget", () => {
    const page = read("../app/login/page.tsx");
    expect(page).toContain('import { requestStartupPermissionsAfterLogin } from "@/lib/permissions";');
    const firedIdx = page.indexOf("void requestStartupPermissionsAfterLogin();");
    const loginIdx = page.indexOf("await login(username.trim(), password);");
    expect(loginIdx).toBeGreaterThan(-1);
    expect(firedIdx).toBeGreaterThan(loginIdx);
    // Must stay inside the try (i.e. only on SUCCESS), not in a finally.
    const catchIdx = page.indexOf("} catch (err) {", loginIdx);
    expect(firedIdx).toBeLessThan(catchIdx);
  });

  it("the register page fires it too — a fresh account is a first login", () => {
    const page = read("../app/register/page.tsx");
    expect(page).toContain('import { requestStartupPermissionsAfterLogin } from "@/lib/permissions";');
    const firedIdx = page.indexOf("void requestStartupPermissionsAfterLogin();");
    const registerIdx = page.indexOf("await register({");
    expect(registerIdx).toBeGreaterThan(-1);
    expect(firedIdx).toBeGreaterThan(registerIdx);
    const catchIdx = page.indexOf("} catch (err) {", registerIdx);
    expect(firedIdx).toBeLessThan(catchIdx);
  });
});

describe("PermissionBootstrap — the shell's one-tap fallback card", () => {
  const component = read("../components/pwa/PermissionBootstrap.tsx");
  const shell = read("../components/layout/AppShell.tsx");

  it("is mounted from the AppShell (so every authenticated role gets it)", () => {
    expect(shell).toContain('import { PermissionBootstrap } from "@/components/pwa/PermissionBootstrap";');
    expect(shell).toContain("<PermissionBootstrap />");
  });

  it("honors the account+device flag: nothing renders once the bootstrap ran", () => {
    expect(component).toContain("hasPermissionBootstrapRun(user.id)");
    expect(component).toContain("markPermissionBootstrapRun(user.id)");
    // Marked on BOTH paths — accept and dismiss — so it never nags twice.
    const acceptIdx = component.indexOf("const accept = async () => {");
    const dismissIdx = component.indexOf("const dismiss = () => {");
    expect(component.slice(acceptIdx, dismissIdx)).toContain("markPermissionBootstrapRun");
    expect(component.slice(dismissIdx)).toContain("markPermissionBootstrapRun");
  });

  it("an already-granted notification permission is wired to the server QUIETLY", () => {
    // No prompt (permission already granted), just enablePush on the session.
    const grantedIdx = component.indexOf('notif === "granted"');
    const slice = component.slice(grantedIdx, component.indexOf('notif === "denied"'));
    expect(slice).toContain("await enablePush(token)");
    expect(slice).not.toContain("requestStartupPermissions(");
  });

  it("fires the full ask while transient activation is still alive (no card needed)", () => {
    expect(component).toContain("navigator.userActivation?.isActive");
    const slice = component.slice(component.indexOf("navigator.userActivation?.isActive"));
    expect(slice).toContain("await requestStartupPermissions(user.id, readSession()?.token ?? null)");
  });

  it("never renders on full-screen interaction pages (chat / call / tickets)", () => {
    for (const pattern of [
      "/^\\/app\\/consultations\\/[^/]+$/",
      "/^\\/app\\/consultations\\/[^/]+\\/call/",
      "/^\\/app\\/tickets\\/[^/]+$/",
    ]) {
      expect(component).toContain(pattern);
    }
    expect(component).toContain("isFullScreenInteractionPage(pathname)");
  });

  it("waits before deciding, so a pending login-page prompt is never covered", () => {
    expect(component).toContain("DECIDE_DELAY_MS");
    expect(component).toContain("setTimeout(() => void decide(), DECIDE_DELAY_MS)");
  });

  it("uses Creole copy consistent with the app and an accessible dialog", () => {
    expect(component).toContain('aria-label="Pèmèt notifikasyon, kamera ak mikro"');
    expect(component).toContain("Pèmèt notifikasyon, kamera ak mikro");
    expect(component).toContain("Owi, mande m");
    expect(component).toContain("Pa kounye a");
  });
});

describe("CSS — the card reuses the install-banner design system", () => {
  const css = read("../app/globals.css");

  it("has the fixed-slot card styled from the same tokens", () => {
    expect(css).toContain(".perm-bootstrap-card {");
    const block = css.match(/\.perm-bootstrap-card \{[^}]*\}/)?.[0] ?? "";
    expect(block).toContain("position: fixed");
    expect(block).toContain("var(--surface)");
    expect(block).toContain("var(--shadow-lg)");
    expect(block).toContain("max-width: 480px");
  });

  it("reserves page space while visible (same mechanism as the install banner)", () => {
    expect(css).toContain("body.has-perm-card .app-main { padding-bottom: calc(var(--bottomnav-h) + 110px); }");
    expect(css).toContain("@media (min-width: 900px) { .perm-bootstrap-card { bottom: 16px; } }");
  });
});
