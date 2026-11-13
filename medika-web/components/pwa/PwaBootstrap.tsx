"use client";

/**
 * Registers the service worker and renders the install prompt + offline
 * banner. Mounted once from the root layout.
 *
 * The install banner is deliberately hidden on chat/call screens — it would
 * cover the message composer — and auto-dismisses after 15 s elsewhere.
 * Dismissals open quiet windows (7 days for the timeout, 30 for the X,
 * forever once installed) so the banner never re-prompts on every visit,
 * and it never renders inside the installed standalone app.
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, WifiOff, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_UNTIL_KEY = "medika_install_dismissed_until";
const LEGACY_DISMISS_KEY = "medika_install_dismissed";
/**
 * Quiet windows after a dismissal, in days. The prompt is a nudge, not a
 * nag: explicitly closing it silences it for a month, letting it time out
 * for a week, and installing the app silences it forever. Without these
 * windows the banner re-appeared on every visit (owner report) and could
 * sit over primary CTAs.
 */
const AUTO_DISMISS_DAYS = 7;
const EXPLICIT_DISMISS_DAYS = 30;
const INSTALLED_DISMISS_DAYS = 365;

/** True when the app is already running as an installed PWA — the prompt
 *  must never appear there, there is nothing left to install. */
function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

/** Expiry timestamp (epoch ms) of the current quiet window, or 0 when none
 *  is active. Migrates the legacy boolean key once: a previous explicit
 *  dismissal becomes a 30-day window instead of blocking the prompt forever
 *  with no expiry. */
function dismissedUntilMs(): number {
  try {
    const raw = window.localStorage.getItem(DISMISS_UNTIL_KEY);
    if (raw) return parseInt(raw, 10) || 0;
    if (window.localStorage.getItem(LEGACY_DISMISS_KEY) === "1") {
      const until = Date.now() + EXPLICIT_DISMISS_DAYS * 86_400_000;
      window.localStorage.setItem(DISMISS_UNTIL_KEY, String(until));
      window.localStorage.removeItem(LEGACY_DISMISS_KEY);
      return until;
    }
  } catch {
    // localStorage unavailable (private mode etc.) — prompt as usual.
  }
  return 0;
}

function quietUntil(days: number): void {
  try {
    window.localStorage.setItem(DISMISS_UNTIL_KEY, String(Date.now() + days * 86_400_000));
  } catch {
    // ignore
  }
}

function isFullScreenInteractionPage(pathname: string | null): boolean {
  if (!pathname) return false;
  // Chat conversations and calls: the composer must never be covered.
  return /^\/app\/consultations\/[^/]+$/.test(pathname) || /^\/app\/tickets\/[^/]+$/.test(pathname);
}

/**
 * Auth and utility screens keep a tight vertical rhythm (form panels,
 * keyboard on mobile) — a floating install banner there can cover the
 * submit button or the registration link. Show it only on the landing
 * page and inside the authenticated app, where .app-main reserves space
 * for it via body.has-install-banner.
 */
function shouldHideInstallBanner(pathname: string | null): boolean {
  if (!pathname) return true;
  return (
    pathname === "/" ||
    pathname.startsWith("/app")
  ) ? false : true;
}

export function PwaBootstrap() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [offline, setOffline] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    // Service worker registration — production only (no SW over plain HTTP
    // on localhost IPs, and Next.js dev server hot-reload conflicts with it).
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      const onLoad = () => {
        navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
          // SW registration failure is non-fatal; the app still works online.
        });
      };
      if (document.readyState === "complete") onLoad();
      else window.addEventListener("load", onLoad);
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Always swallow the browser's own prompt UI, even when we decide not
      // to show our banner — otherwise Chrome stacks its mini-infobar on top.
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
      // Installed PWA: nothing left to install, never ask.
      if (isStandaloneDisplay()) return;
      // Inside a quiet window from a previous dismissal: stay quiet.
      if (Date.now() < dismissedUntilMs()) return;
      setShowInstall(true);
    };
    const onInstalled = () => {
      // Just installed: never prompt again (browsers still emit this after
      // our own banner's Enstale button succeeds).
      quietUntil(INSTALLED_DISMISS_DAYS);
      setShowInstall(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setShowInstall(false);
  };

  // Keep the banner from covering interactive content at the page bottom,
  // and hide it entirely on full-screen interaction pages (chats) and on
  // auth/utility screens (login, register, offline).
  const bannerVisible =
    showInstall && !isFullScreenInteractionPage(pathname) && !shouldHideInstallBanner(pathname);
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("has-install-banner", bannerVisible);
    return () => document.body.classList.remove("has-install-banner");
  }, [bannerVisible]);

  // While the offline toast is visible, auth screens reserve extra scroll
  // room (body.has-offline-toast .auth-form-pane padding in the CSS) so the
  // submit area can always be scrolled clear of the fixed toast — same
  // mechanism as the install banner above.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("has-offline-toast", offline);
    return () => document.body.classList.remove("has-offline-toast");
  }, [offline]);

  // Auto-dismiss the banner so it never lingers over content. Timing out is
  // NOT an explicit refusal, but it must not re-prompt on every visit
  // either: a one-week quiet window.
  useEffect(() => {
    if (!bannerVisible) return;
    const t = setTimeout(() => {
      quietUntil(AUTO_DISMISS_DAYS);
      setShowInstall(false);
    }, 15_000);
    return () => clearTimeout(t);
  }, [bannerVisible]);

  const dismissInstall = () => {
    setShowInstall(false);
    // An explicit X is a much stronger signal than the timeout: one month.
    quietUntil(EXPLICIT_DISMISS_DAYS);
  };

  return (
    <>
      {offline && (
        <div role="status" aria-live="polite" className="toast-stack">
          <div className="toast">
            <WifiOff size={18} aria-hidden />
            <span>Pa gen koneksyon entènèt. Gen kèk paj ki ka pa chaje.</span>
          </div>
        </div>
      )}
      {bannerVisible && (
        <div className="install-banner" role="dialog" aria-label="Enstale aplikasyon Medika a">
          <span className="brand-mark" aria-hidden>
            <Download size={17} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>Enstale Medika</strong>
            <div className="tiny muted">Jwenn aksè konsiltasyon ou yo depi ekranlakay ou.</div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={install}>
            Enstale
          </button>
          <button className="icon-btn" onClick={dismissInstall} aria-label="Fèmen sijesyon enstalasyon an">
            <X size={17} />
          </button>
        </div>
      )}
    </>
  );
}
