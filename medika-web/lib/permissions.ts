/**
 * First-login permission bootstrap (owner request, Nov 2026).
 *
 * Owner requirement: "whenever someone first logs into their account it must
 * automatically ask for video, mic and push permission."
 *
 * Why this module exists: before it, a fresh device never got asked anything —
 * camera/mic only surfaced when joining a call, and push only from the
 * notification settings page — so pushes silently never arrived (no
 * subscription) and first calls stumbled on a permission wall mid-consult.
 *
 * Browser-reality design notes (these constraints shaped the flow):
 *  - the login/register submit click IS a user gesture, so the PRIMARY ask is
 *    fired from the login/register success handlers while transient user
 *    activation is still alive;
 *  - some browsers still swallow programmatic requests (iOS Safari requires
 *    the call inside the gesture task; Chrome quiet-UI can suppress them),
 *    so the authenticated shell renders a ONE-TAP fallback card exactly
 *    once — <PermissionBootstrap /> — when permission is still undecided and
 *    this device never completed the bootstrap for this user;
 *  - "first login" is tracked per DEVICE+account in localStorage (permissions
 *    themselves are per-browser, and sessionStorage is wiped on tab close,
 *    so localStorage is the right scope): once the bootstrap ran for an
 *    account on a device it never nags again;
 *  - everything here is fire-and-forget and never throws: a blocked or
 *    denied permission NEVER blocks navigation, the session, or the shell.
 *
 * Note on lib/push.ts's "explicit user action only" rule: that rule governs
 * ITS callers. The two callers added here are the login/register click and
 * the one-tap card — both genuine user actions. The quiet re-enable inside
 * <PermissionBootstrap /> only runs when notification permission is ALREADY
 * granted (no prompt, no new browser ask) and merely wires the existing
 * grant to the server so pushes actually deliver.
 */
import { enablePush } from "@/lib/push";
import { readSession } from "@/lib/auth/session";

export type PermissionOutcome = "granted" | "denied" | "unsupported";

export interface PermissionBootstrapResult {
  cameraMic: PermissionOutcome;
  notifications: PermissionOutcome;
  push: "subscribed" | "not-subscribed";
}

/** localStorage flag namespace — one entry per account per device. */
const DONE_KEY_PREFIX = "medika_perm_bootstrap_";

/** True once the first-login bootstrap ran for THIS account on THIS device. */
export function hasPermissionBootstrapRun(userId: string): boolean {
  if (typeof window === "undefined") return true; // SSR: behave as done (never render the card)
  try {
    return window.localStorage.getItem(DONE_KEY_PREFIX + userId) === "1";
  } catch {
    return true; // storage blocked (private mode): never nag
  }
}

/** Mark the bootstrap as ran for THIS account on THIS device. Never throws. */
export function markPermissionBootstrapRun(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DONE_KEY_PREFIX + userId, "1");
  } catch {
    // ignore — a blocked flag means the fallback card may show again, which
    // is strictly better than a session that can never enable push.
  }
}

/**
 * Ask for camera + microphone (ONE prompt in most browsers — Chrome groups
 * them). On success the tracks are stopped immediately: the goal is the
 * permission grant, not holding the camera open.
 */
async function askCameraMic(): Promise<PermissionOutcome> {
  try {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return "unsupported";
    }
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    for (const track of stream.getTracks()) track.stop();
    return "granted";
  } catch (err) {
    const name = (err as DOMException | undefined)?.name;
    if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") {
      // No usable camera/mic on this device (or busy) — not a denial.
      return "unsupported";
    }
    return "denied"; // NotAllowedError, SecurityError, anything else
  }
}

/**
 * Ask for notification permission. When permission was already decided, the
 * browser resolves without showing any UI (so re-running is safe).
 */
async function askNotifications(): Promise<PermissionOutcome> {
  try {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      return "unsupported";
    }
    if (Notification.permission === "default") {
      return (await Notification.requestPermission()) === "granted" ? "granted" : "denied";
    }
    return Notification.permission === "granted" ? "granted" : "denied";
  } catch {
    // Some browsers throw when requestPermission is called outside a user
    // gesture — that is a swallowed prompt, not a device limitation, but the
    // one-tap fallback card covers it either way.
    return "denied";
  }
}

/**
 * Fire the asks. BOTH are started in the same synchronous task (before the
 * first await completes) so they ride the SAME transient user activation —
 * some browsers consume it on the first request, and a notification prompt
 * fired after that gap would be silently dropped.
 *
 * When notifications come back granted, the device is immediately subscribed
 * to web push via enablePush() (VAPID discovery, subscribe, server
 * registration inside). Server-side push problems surface through
 * enablePush's honest states and are never rethrown here.
 */
export async function requestStartupPermissions(
  userId: string,
  token: string | null,
): Promise<PermissionBootstrapResult> {
  const cameraMicPromise = askCameraMic();
  const notificationsPromise = askNotifications();

  const cameraMic = await cameraMicPromise;
  const notifications = await notificationsPromise;

  let push: PermissionBootstrapResult["push"] = "not-subscribed";
  if (notifications === "granted" && token) {
    try {
      const state = await enablePush(token);
      push = state.enabled ? "subscribed" : "not-subscribed";
    } catch {
      push = "not-subscribed"; // best-effort; the settings page can retry
    }
  }

  return { cameraMic, notifications, push };
}

/**
 * The one-liner the login/register pages call right after a successful auth
 * response (still inside the submit click's activation window). Reads the
 * freshly written session for the token + user id; never throws.
 */
export async function requestStartupPermissionsAfterLogin(): Promise<void> {
  try {
    const session = readSession();
    if (!session?.token) return;
    const user = session.user as { id?: string } | null;
    if (!user?.id) return;
    await requestStartupPermissions(user.id, session.token);
  } catch {
    // Never surface anything from a best-effort bootstrap.
  }
}
