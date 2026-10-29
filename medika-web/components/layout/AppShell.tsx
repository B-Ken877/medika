"use client";

/**
 * Authenticated app shell — Clinical Calm redesign.
 * 68px white header: brand (logo + wordmark), offline indicator, desktop
 * primary navigation (>=900px, issue #71), notifications, and an account
 * menu (avatar + name → profile / logout dropdown).
 * Role-aware bottom navigation on small screens + content area.
 * Redirects to /login when unauthenticated; restores session first.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, CalendarDays, ChevronDown, Home, LogOut, Stethoscope, User, Wallet } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { useSocket } from "@/lib/ws/socket-context";
import { Avatar, Spinner } from "@/components/ui/primitives";
import { UnreadProvider, useUnread } from "@/components/notifications/UnreadProvider";

function navItems(role: "patient" | "doctor") {
  if (role === "doctor") {
    // Issue #34: concise one-line labels — five destinations must fit cleanly
    // on narrow phones (no wrapping inside the fixed bottom bar).
    return [
      { href: "/app", label: "Akèy", icon: Home, exact: true },
      { href: "/app/consultations", label: "Demann", icon: CalendarDays },
      { href: "/app/wallet", label: "Revni", icon: Wallet },
      { href: "/app/notifications", label: "Alèt", icon: Bell },
      { href: "/app/profile", label: "Pwofil", icon: User },
    ];
  }
  return [
    { href: "/app", label: "Akèy", icon: Home, exact: true },
    { href: "/app/doctors", label: "Doktè yo", icon: Stethoscope },
    { href: "/app/consultations", label: "Konsiltasyon", icon: CalendarDays },
    { href: "/app/profile", label: "Pwofil", icon: User },
  ];
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div className="acct" ref={ref}>
      <button
        className="acct-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Meni kont la"
      >
        <Avatar name={user.name} src={user.avatar_url} size="sm" alt={`Foto pwofil ${user.name}`} />
        <span className="acct-name">{user.name}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="acct-menu" role="menu" aria-label="Kont">
          <div className="acct-menu-head">
            <div className="acct-menu-name">{user.name}</div>
            <div className="acct-menu-role">
              {user.role === "doctor" ? "Doktè" : user.role === "admin" ? "Administratè" : "Pasyan"}
            </div>
          </div>
          <Link href="/app/profile" role="menuitem" onClick={() => setOpen(false)}>
            <User size={16} aria-hidden /> Pwofil mwen
          </Link>
          <button
            role="menuitem"
            className="danger"
            onClick={() => {
              setOpen(false);
              logout();
              router.replace("/login");
            }}
          >
            <LogOut size={16} aria-hidden /> Dekonekte
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <UnreadProvider>
      <AppShellInner>{children}</AppShellInner>
    </UnreadProvider>
  );
}

/**
 * Inner shell — must render BELOW UnreadProvider so useUnread() sees the
 * provider's context (a component cannot consume its own provider).
 */
function AppShellInner({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const { status: wsStatus } = useSocket();
  const { unread } = useUnread();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "anonymous") {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/app")}`);
    }
  }, [status, router, pathname]);

  if (status !== "authenticated" || !user) {
    return (
      <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>
        <Spinner label="N ap restore sesyon ou a..." />
      </div>
    );
  }

  const items = navItems(user.role === "doctor" ? "doctor" : "patient");
  const onCallPage = pathname?.startsWith("/app/consultations/") && pathname.endsWith("/call");
  const isConsultationChat =
    /^\/app\/consultations\/[^/]+$/.test(pathname ?? "");

  /**
   * Shared navigation link renderer — issue #71. Both navigation surfaces
   * (desktop header nav and mobile bottom bar) MUST use the identical
   * role-aware destinations and the identical active-state rule, so the
   * two can never drift apart.
   */
  const navLink = (
    { href, label, icon: Icon, exact }: (typeof items)[number],
    iconSize: number,
  ) => {
    const active = exact ? pathname === href : pathname?.startsWith(href) && href !== "/app";
    return (
      <Link key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
        <Icon size={iconSize} aria-hidden />
        <span>{label}</span>
      </Link>
    );
  };

  return (
    <div className={`app-shell${isConsultationChat ? " chat-mode" : ""}`}>
      <header className="app-header">
        <Link href="/app" className="brand" aria-label="Medika — Akèy">
          <span className="brand-mark" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z" fill="currentColor" />
            </svg>
          </span>
          <span className="brand-word">Medika</span>
        </Link>
        {wsStatus !== "open" && !onCallPage && (
          <span className="badge badge-gray" title="N ap rekonekte...">
            Pa gen koneksyon
          </span>
        )}
        {/* Issue #71: the mobile bottom bar is display:none at >=900px, which
            left desktop widths with NO primary navigation. The same role-aware
            destinations now render in the header; below 900px this nav stays
            display:none (CSS) and the bottom bar remains the navigation. The
            chat-mode shell hides the whole header, preserving the focused
            consultation-room layout. */}
        <nav className="header-nav" aria-label="Navigasyon prensipal">
          {items.map((item) => navLink(item, 17))}
        </nav>
        <div className="header-actions">
          {/* Issue #72: the bell now carries the SERVER-authoritative unread
              count (UnreadProvider). The badge is hidden at zero; the
              accessible label announces the pending count. */}
          <Link
            href="/app/notifications"
            className="icon-btn"
            aria-label={unread > 0 ? `Notifikasyon — ${unread} pa li` : "Notifikasyon"}
            title="Notifikasyon"
          >
            <Bell size={20} />
            {unread > 0 && (
              <span className="bell-count" aria-hidden>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
          <AccountMenu />
        </div>
      </header>

      <main className="app-main">{children}</main>

      <nav className="bottom-nav" aria-label="Navigasyon prensipal">
        {items.map((item) => navLink(item, 21))}
      </nav>
    </div>
  );
}
