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
 * appears on the next regular /app page instead of fighting the chat UI.
 *
 * Already-granted permissions are never re-prompted: when notifications are
 * already decided, the flow marks itself done (and quietly re-registers an
 * existing push subscription — the heal that makes previously-granted
 * devices actually receive pushes).
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { BellRing } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import {
  hasPermissionBootstrapRun,
  markPermissionBootstrapRun,
  requestStartupPermissions,
} from "@/lib/permissions";
import { syncExistingPushSubscription } from "@/lib/push";

/** Let a genuinely-pending browser prompt (fired by the login page) surface
 *  before this card considers appearing over it. */
const DECISION_DELAY_MS = 2_000;

export function PermissionBootstrap() {
  const { user, status, token } = useAuth();
  const pathname = usePathname();
  const [shouldOffer, setShouldOffer] = useState(false);

  useEffect(() => {
    if (status !== "authenticated" || !user?.id) return;
    if (hasPermissionBootstrapRun(user.id)) return;

    let cancelled = false;
    // A short delay lets a genuinely-pending browser prompt (fired by the
    // login page) surface and be decided first; while it pends the
    // permission stays "default" and we simply never open over it.
    const timer = setTimeout(() => {
      const notif =
        typeof Notification === "undefined" ? "unsupported" : Notification.permission;
      if (cancelled) return;
      if (notif !== "default") {
        // Already decided (granted on the login page, or denied anywhere):
        // wire push when granted, mark done either way. The media question
        // is answered by the call room when the user first joins a call.
        if (notif === "granted" && token) void syncExistingPushSubscription(token);
        markPermissionBootstrapRun(user.id);
        return;
      }
      if (typeof navigator !== "undefined" && navigator.userActivation?.isActive) {
        // Transient activation is still alive (fast login): fire now —
        // only undecided permissions actually prompt.
        void requestStartupPermissions(user.id, token)
          .catch(() => undefined)
          .finally(() => {
            if (!cancelled) markPermissionBootstrapRun(user.id);
          });
        return;
      }
      setShouldOffer(true); // swallowed ask → one-tap card
    }, DECISION_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, user?.id, token]);

  const accept = () => {
    if (user?.id) markPermissionBootstrapRun(user.id);
    setShouldOffer(false);
    void requestStartupPermissions(user?.id ?? "", token).catch(() => undefined);
  };

  const dismiss = () => {
    if (user?.id) markPermissionBootstrapRun(user.id);
    setShouldOffer(false);
  };

  // Same visibility rule as the install banner: never on chat/tickets/call
  // screens where a floating card would cover the composer or the room UI.
  const onFullScreenInteractionPage =
    /^\/app\/consultations\/[^/]+/.test(pathname ?? "") || /^\/app\/tickets\/[^/]+/.test(pathname ?? "");
  const visible = shouldOffer && !onFullScreenInteractionPage;

  // Reserve the fixed slot's height on page content (same mechanism as the
  // install banner) so the card never covers the bottom of a list.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("has-perm-card", visible);
    return () => document.body.classList.remove("has-perm-card");
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="perm-bootstrap-card" role="dialog" aria-label="Pèmèt notifikasyon ak kamera">
      <span className="perm-card-icon" aria-hidden>
        <BellRing size={20} />
      </span>
      <div className="perm-card-copy">
        <p className="perm-card-title">Pèmèt notifikasyon, kamera ak mikro</p>
        <p className="perm-card-body">
          Pou resevwa notifikasyon epi fè konsiltasyon videyo, Medika bezwen pèmèt sa yo.
          Navigatè a pral mande w — peze Owi pou chak.
        </p>
      </div>
      <div className="perm-card-actions">
        <button type="button" className="btn btn-primary" onClick={accept}>
          Owi, mande m kounye a
        </button>
        <button type="button" className="btn btn-ghost" onClick={dismiss}>
          Pa kounye a
        </button>
      </div>
    </div>
  );
}
