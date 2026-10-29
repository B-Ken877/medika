/**
 * Web Push subscription client (issue #36).
 *
 * Rules honored here:
 *  - permission is requested ONLY after an explicit user action (the caller
 *    passes a "user gesture" context; never on page load);
 *  - the service worker must be ready and the context secure before
 *    subscribing; unsupported/blocked/denied states are reported honestly;
 *  - the subscription is registered server-side against the AUTHENTICATED
 *    user (the token rides the request; the server never trusts client
 *    identity claims);
 *  - logout revokes the subscription (see lib/auth/session logout wiring).
 */
import { getVapidPublicKey, registerPushSubscription, revokePushSubscription } from "@/lib/api/endpoints";

export type PushSupport =
  | "supported"
  | "unsupported-browser"
  | "insecure-context"
  | "no-service-worker"
  | "no-push-manager"
  | "denied"
  | "server-disabled"
  | "server-unreachable"
  | "registration-failed";

export type PushState = {
  support: PushSupport;
  enabled: boolean;
};

/** Probe the browser's push capabilities (never requests permission). */
export function probePushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported-browser";
  if (!("serviceWorker" in navigator)) return "no-service-worker";
  if (!window.isSecureContext) return "insecure-context";
  if (!("PushManager" in window)) return "no-push-manager";
  if (typeof Notification === "undefined") return "unsupported-browser";
  if (Notification.permission === "denied") return "denied";
  return "supported";
}

/** True when a push subscription already exists for THIS service worker. */
export async function hasPushSubscription(): Promise<boolean> {
  if (probePushSupport() !== "supported") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub !== null;
  } catch {
    return false;
  }
}

/**
 * Subscribe THIS device to push (explicit user action only). Returns the
 * honest end state; never throws.
 *
 * Issue #50 (health signal): server/network failures are reported AS server
 * states — `server-unreachable` (key bootstrap or subscription registration
 * could not be completed) — never as "unsupported-browser", so admins and
 * users can tell a connectivity/configuration problem apart from a device
 * limitation. "unsupported-browser" is reserved for genuine browser-level
 * failures (subscribe() rejection, malformed subscription).
 */
export async function enablePush(token: string): Promise<PushState> {
  const support = probePushSupport();
  if (support !== "supported") return { support, enabled: false };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { support: "denied", enabled: false };
  } catch {
    // Permission prompt refused at the browser level — a device limitation.
    return { support: "unsupported-browser", enabled: false };
  }

  let publicKey: string | null;
  let configured: boolean;
  try {
    ({ publicKey, configured } = await getVapidPublicKey(token));
  } catch {
    // Network/server failure during key bootstrap (offline, timeout, 5xx).
    return { support: "server-unreachable", enabled: false };
  }
  if (!configured || !publicKey) return { support: "server-disabled", enabled: false };

  let json: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    // Replace any stale subscription for this browser (server upserts by
    // endpoint, re-binding it to the current authenticated user).
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));
    json = sub.toJSON();
  } catch {
    // Browser-level failure (no SW, subscribe rejected by the push service).
    return { support: "unsupported-browser", enabled: false };
  }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { support: "unsupported-browser", enabled: false };
  }

  try {
    await registerPushSubscription(token, {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent,
    });
  } catch {
    // The subscription exists in the browser but the server rejected the
    // registration (auth expired, validation, 5xx) — a server state.
    return { support: "registration-failed", enabled: false };
  }
  return { support: "supported", enabled: true };
}

/**
 * Re-register an EXISTING browser subscription with the server (issue #72).
 *
 * Called by the authenticated shell on load and on reconnect. Heals the
 * `pushsubscriptionchange` renewal gap (a renewed subscription never reached
 * the server) and any earlier failed registration. IDEMPOTENT: the server
 * upserts by endpoint and re-binds it to the authenticated owner. Never
 * requests permission, never creates a new subscription, never throws.
 * Returns true when a subscription exists and was (re)registered.
 */
export async function syncExistingPushSubscription(token: string): Promise<boolean> {
  try {
    if (probePushSupport() !== "supported") return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
    await registerPushSubscription(token, {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent,
    });
    return true;
  } catch {
    return false; // best-effort heal; the explicit opt-in flow still works
  }
}

/** Unsubscribe this device (browser + server). Never throws. */
export async function disablePush(token: string): Promise<PushState> {
  try {
    if (probePushSupport() === "supported") {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await revokePushSubscription(token, endpoint);
        return { support: "supported", enabled: false };
      }
    }
    await revokePushSubscription(token); // revoke all (defensive logout path)
    return { support: probePushSupport(), enabled: false };
  } catch {
    return { support: probePushSupport(), enabled: false };
  }
}

/** VAPID base64url (RFC 4648 §5, no padding) → Uint8Array for subscribe(). */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
