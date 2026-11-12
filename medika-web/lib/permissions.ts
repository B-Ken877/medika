/**
 * First-login permission bootstrap (owner request: "whenever someone first
 * logs into their account it must automatically ask for video, mic and push
 * permission").
 *
 * Why this exists: without it a fresh device never gets asked anything —
 * camera/mic only surface when joining a call, and push only from the
 * notification settings page — so pushes silently never arrive (no
 * subscription) and first calls stumble on a permission wall mid-consult.
 *
 * Browser-reality design notes (these constraints shaped the flow):
 *  - the login/register submit click IS a user gesture, so the PRIMARY ask
 *    is fired from the login/register success handlers while transient user
 *    activation is still alive;
 *  - some browsers still swallow programmatic requests (iOS Safari requires
 *    the call inside the gesture task; Chrome quiet-UI may defer), so the
 *    authenticated shell renders a ONE-TAP fallback card
 *    (components/pwa/PermissionBootstrap.tsx) whose tap is itself a user
 *    gesture and re-fires the same asks;
 *  - BOTH asks (camera+mic, notifications) are started in the SAME
 *    synchronous task — they must ride one transient activation;
 *  - every path is fire-and-forget and NEVER throws: permissions can delay
 *    nothing and break nothing in the login/redirect flow;
 *  - a per-account, per-device localStorage flag
 *    (`medika_perm_bootstrap_<userId>`) makes the flow FIRST-LOGIN-ONLY:
 *    denied permissions are respected and never re-prompted for the same
 *    account on the same device. A different account or device gets its own
 *    ask. Storage failures count as "already done" (never nag).
 *  - push subscription: when notifications end up granted and a session
 *    token exists, enablePush() runs immediately — permission was just
 *    granted through an explicit user-initiated flow, and subscribing right
 *    there is what makes push actually work on fresh devices (the missing
 *    piece behind "push notifications do not work").
 */

import { enablePush } from "@/lib/push";
import { readSession } from "@/lib/auth/session";

const FLAG_PREFIX = "medika_perm_bootstrap_";

export type CameraMicDecision = "granted" | "denied" | "unsupported" | "unavailable";

export type StartupPermissionResult = {
  cameraMic: CameraMicDecision;
  notifications: "granted" | "denied" | "unsupported" | "unavailable";
  push: "subscribed" | "not-subscribed";
};

function flagKey(userId: string): string {
  return `${FLAG_PREFIX}${userId}`;
}

/** True when this account already completed (or was offered) the bootstrap
 *  on this device. A THROWING/unavailable storage counts as done: the
 *  fallback card must never nag in an environment where it cannot remember. */
export function hasPermissionBootstrapRun(userId: string): boolean {
  try {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(flagKey(userId)) !== null;
  } catch {
    return true;
  }
}

/** Mark the bootstrap as done for this account+device. Never throws. */
export function markPermissionBootstrapRun(userId: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(flagKey(userId), String(Date.now()));
  } catch {
    // Storage unavailable/disabled: nothing to remember — the flow stays
    // non-nagging because hasPermissionBootstrapRun() treats this as done.
  }
}

/** Ask for camera + microphone in ONE combined prompt (browsers coalesce
 *  them). Tracks are stopped immediately — this asks for permission, it
 *  does not open a stream. Never throws. */
async function askCameraMic(): Promise<CameraMicDecision> {
  try {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return "unsupported";
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    for (const track of stream.getTracks()) track.stop();
    return "granted";
  } catch (err) {
    const name = (err as DOMException | undefined)?.name;
    if (name === "NotFoundError" || name === "OverconstrainedError") return "unsupported";
    if (name === "NotAllowedError" || name === "SecurityError") return "denied";
    return "unavailable";
  }
}

/** Ask for notification permission (a no-op resolution when the browser
 *  already decided). Never throws. */
async function askNotifications(): Promise<StartupPermissionResult["notifications"]> {
  try {
    if (typeof Notification === "undefined") return "unsupported";
    const current = Notification.permission;
    if (current === "granted" || current === "denied") return current;
    const result = await Notification.requestPermission();
    if (result === "granted" || result === "denied") return result;
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * Run BOTH asks + the push subscription. Called from the login/register
 * submit handlers (primary, gesture-bound) and from the shell fallback
 * card (one-tap). Only undecided permissions actually prompt; already-
 * granted ones resolve silently, so double-invocation is harmless.
 */
export async function requestStartupPermissions(
  userId: string,
  token: string | null,
): Promise<StartupPermissionResult> {
  // Same synchronous task: both asks must ride ONE transient user
  // activation (an await between them can let it expire).
  const cameraMicPromise = askCameraMic();
  const notificationsPromise = askNotifications();

  const [cameraMic, notifications] = await Promise.all([cameraMicPromise, notificationsPromise]);

  let push: StartupPermissionResult["push"] = "not-subscribed";
  if (notifications === "granted" && token) {
    // Notification permission was just granted through this explicit,
    // user-initiated flow — subscribe the device right away (best-effort;
    // a missing VAPID config or network problem reports through the
    // notification settings UI and never blocks the login flow).
    try {
      const state = await enablePush(token);
      push = state.enabled ? "subscribed" : "not-subscribed";
    } catch {
      push = "not-subscribed";
    }
  }

  return { cameraMic, notifications, push };
}

/**
 * Login/register entry point: reads the just-written session and runs the
 * bootstrap for the freshly authenticated account. Fire-and-forget by
 * contract — callers `void` it and never await it.
 */
export async function requestStartupPermissionsAfterLogin(): Promise<StartupPermissionResult | null> {
  try {
    if (typeof window === "undefined") return null;
    const session = readSession();
    const user = (session?.user ?? null) as { id?: string } | null;
    if (!session || !user?.id) return null;
    if (hasPermissionBootstrapRun(user.id)) return null;
    const result = await requestStartupPermissions(user.id, session.token);
    markPermissionBootstrapRun(user.id);
    return result;
  } catch {
    return null;
  }
}
