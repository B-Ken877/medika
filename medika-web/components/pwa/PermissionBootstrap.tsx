"use client";

/**
 * First-login permission bootstrap — shell fallback card (owner request).
 *
 * The PRIMARY ask fires from the login/register submit handlers (see
 * lib/permissions.ts). This component is the SAFETY NET for browsers that
 * swallowed that programmatic attempt (iOS Safari gesture strictness, Chrome
 * quiet-UI): when the user is authenticated, this device never completed the
 * bootstrap for this account, and notification permission is still
 * undecided, a small one-tap card appears — its tap IS a user gesture, so
 * all three asks (camera+mic, notifications, push subscription) fire
 * legitimately. Both the tap and a dismissal mark the flag: the card never
 * nags twice for the same account on the same device.
 *
 * Placement rules mirror PwaBootstrap's install banner: never on full-screen
 * interaction pages (chat conversations / tickets / call rooms) where it
 * could cover the composer — the flag stays unset there, so the card simply
 * appears on the next regular /app page instead.
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BellRing, X } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { readSession } from "@/lib/auth/session";
import { enablePush } from "@/lib/push";
import {
  hasPermissionBootstrapRun,
  markPermissionBootstrapRun,
  requestStartupPermissions,
} from "@/lib/permissions";

/** Let a pending login-page prompt surface before deciding to show the card. */
const DECIDE_DELAY_MS = 2_000;

function isFullScreenInteractionPage(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    /^\/app\/consultations\/[^/]+$/.test(pathname) ||
    /^\/app\/consultations\/[^/]+\/call/.test(pathname) ||
    /^\/app\/tickets\/[^/]+$/.test(pathname)
  );
}

export function PermissionBootstrap() {
  const { user, status } = useAuth();
  const pathname = usePathname();
  const [shouldOffer, setShouldOffer] = useState(false);

  useEffect(() => {
    if (status !== "authenticated" || !user?.id) return;
    if (hasPermissionBootstrapRun(user.id)) return;

    let cancelled = false;

    const decide = async () => {
      // Notification support/decision is the gate: everything else (camera,
      // mic) is asked opportunistically in the same gesture.
      const notifSupported = typeof Notification !== "undefined";
      const notif = notifSupported ? Notification.permission : "denied";

      if (!notifSupported) {
        // Nothing to ask for push; camera/mic are handled by the call room.
        markPermissionBootstrapRun(user.id);
        return;
      }

      if (notif === "granted") {
        // The browser already decided (e.g. grant remembered from an earlier
        // visit): wire the existing grant to the server quietly — no prompt,
        // no new ask — so pushes actually deliver. Then mark done.
        const token = readSession()?.token ?? null;
        if (token) {
          try {
            await enablePush(token);
          } catch {
            // best-effort; the settings page remains the explicit retry path
          }
        }
        if (!cancelled) markPermissionBootstrapRun(user.id);
        return;
      }

      if (notif === "denied") {
        // Explicitly declined at browser level — re-asking is futile.
        markPermissionBootstrapRun(user.id);
        return;
      }

      // "default": the login-page ask was swallowed or is still pending.
      if (navigator.userActivation?.isActive) {
        // Transient activation is still alive (fast login → redirect): fire
        // the asks right now, no card needed. Only undecided permissions
        // actually prompt; everything already decided resolves silently.
        try {
          await requestStartupPermissions(user.id, readSession()?.token ?? null);
        } catch {
          // never propagate
        }
        if (!cancelled) markPermissionBootstrapRun(user.id);
        return;
      }

      if (!cancelled) setShouldOffer(true);
    };

    const timer = setTimeout(() => void decide(), DECIDE_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, user?.id]);

  const accept = async () => {
    if (user?.id) markPermissionBootstrapRun(user.id);
    setShouldOffer(false);
    try {
      await requestStartupPermissions(user?.id ?? "anonymous", readSession()?.token ?? null);
    } catch {
      // never propagate
    }
  };

  const dismiss = () => {
    if (user?.id) markPermissionBootstrapRun(user.id);
    setShouldOffer(false);
  };

  const visible = shouldOffer && !isFullScreenInteractionPage(pathname);

  // Same page-guard mechanism as the install banner: keep the card from
  // covering bottom content on regular pages.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("has-perm-card", visible);
    return () => document.body.classList.remove("has-perm-card");
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="perm-bootstrap-card" role="dialog" aria-label="Pèmèt notifikasyon, kamera ak mikro">
      <span className="brand-mark" aria-hidden>
        <BellRing size={17} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>Pèmèt notifikasyon, kamera ak mikro</strong>
        <div className="tiny muted">
          Pou w resevwa notifikasyon yo epi swiv konsiltasyon videyo ou, Medika bezwen pèmèt sa yo.
          Navigatè a pral mande w — peze Owi pou chak demann.
        </div>
      </div>
      <button className="btn btn-primary btn-sm" onClick={accept}>
        Owi, mande m
      </button>
      <button className="icon-btn" onClick={dismiss} aria-label="Pa kounye a">
        <X size={17} />
      </button>
    </div>
  );
}
