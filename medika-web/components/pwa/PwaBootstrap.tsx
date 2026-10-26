"use client";

/**
 * Registers the service worker and renders the install prompt + offline
 * banner. Mounted once from the root layout.
 *
 * The install banner is deliberately hidden on chat/call screens — it would
 * cover the message composer — and auto-dismisses after 15 s elsewhere.
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, WifiOff, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALL_DISMISS_KEY = "medika_install_dismissed";

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
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
      let dismissed = "0";
      try {
        dismissed = window.localStorage.getItem(INSTALL_DISMISS_KEY) ?? "0";
      } catch {
        dismissed = "0";
      }
      if (dismissed !== "1") setShowInstall(true);
    };
    const onInstalled = () => setShowInstall(false);
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

  // Auto-dismiss the banner so it never lingers over content.
  useEffect(() => {
    if (!bannerVisible) return;
    const t = setTimeout(() => setShowInstall(false), 15_000);
    return () => clearTimeout(t);
  }, [bannerVisible]);

  const dismissInstall = () => {
    setShowInstall(false);
    try {
      window.localStorage.setItem(INSTALL_DISMISS_KEY, "1");
    } catch {
      // ignore
    }
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
