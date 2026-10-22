"use client";

/**
 * Authenticated app shell: header (brand, notifications, profile) +
 * role-aware bottom navigation on small screens + content area.
 * Redirects to /login when unauthenticated; restores session first.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Bell, CalendarDays, Home, Stethoscope, User } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { useSocket } from "@/lib/ws/socket-context";
import { Avatar, Spinner } from "@/components/ui/primitives";

function navItems(role: "patient" | "doctor") {
  if (role === "doctor") {
    return [
      { href: "/app", label: "Accueil", icon: Home, exact: true },
      { href: "/app/consultations", label: "Consultations", icon: CalendarDays },
      { href: "/app/notifications", label: "Notifications", icon: Bell },
      { href: "/app/profile", label: "Profil", icon: User },
    ];
  }
  return [
    { href: "/app", label: "Accueil", icon: Home, exact: true },
    { href: "/app/doctors", label: "Médecins", icon: Stethoscope },
    { href: "/app/consultations", label: "Consultations", icon: CalendarDays },
    { href: "/app/profile", label: "Profil", icon: User },
  ];
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, status, logout } = useAuth();
  const { status: wsStatus } = useSocket();
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
        <Spinner label="Restauration de votre session…" />
      </div>
    );
  }

  const items = navItems(user.role === "doctor" ? "doctor" : "patient");
  const onCallPage = pathname?.startsWith("/app/consultations/") && pathname.endsWith("/call");

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link href="/app" className="brand" aria-label="Medika — Accueil">
          <span className="brand-mark" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z" fill="currentColor" />
            </svg>
          </span>
          Medika
        </Link>
        {wsStatus !== "open" && !onCallPage && (
          <span className="badge badge-gray" title="Reconnexion en cours">
            Hors ligne
          </span>
        )}
        <div className="header-actions">
          <Link
            href="/app/notifications"
            className="icon-btn"
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell size={20} />
          </Link>
          <Link href="/app/profile" aria-label="Mon profil" title="Mon profil" style={{ display: "inline-flex" }}>
            <Avatar name={user.name} src={user.avatar_url} size="sm" alt={`Avatar de ${user.name}`} />
          </Link>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              logout();
              router.replace("/login");
            }}
          >
            Déconnexion
          </button>
        </div>
      </header>

      <main className="app-main">{children}</main>

      <nav className="bottom-nav" aria-label="Navigation principale">
        {items.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname?.startsWith(href) && href !== "/app";
          return (
            <Link key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
              <Icon size={21} aria-hidden />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
