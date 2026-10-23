'use client';
import React, { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, Users, MessageSquare, DollarSign,
  LogOut, Menu, X, Stethoscope, Tag, Headphones, ChevronDown,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/doctors', label: 'Médecins', icon: Stethoscope },
  { href: '/patients', label: 'Patients', icon: Users },
  { href: '/consultations', label: 'Consultations', icon: MessageSquare },
  { href: '/tarification', label: 'Tarification', icon: Tag },
  { href: '/customer-care', label: 'Service client', icon: Headphones },
  { href: '/finance', label: 'Finance', icon: DollarSign },
];

function matches(pathname, href) {
  return pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
}

function AccountMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="acct" ref={ref}>
      <button
        className="acct-btn"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu du compte"
      >
        <span className="acct-avatar" aria-hidden>
          {user?.name?.charAt(0)?.toUpperCase() || 'A'}
        </span>
        <span className="acct-name">{user?.name}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="acct-menu" role="menu" aria-label="Compte">
          <div className="acct-menu-head">
            <div className="acct-menu-name">{user?.name}</div>
            <div className="acct-menu-role">Administrateur</div>
          </div>
          <button role="menuitem" className="danger" onClick={() => { setOpen(false); onLogout(); }}>
            <LogOut size={16} aria-hidden /> Déconnexion
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuBtnRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('medika_admin_token');
    if (!token) { router.push('/login'); return; }
    const userData = localStorage.getItem('medika_admin_user');
    if (userData) setUser(JSON.parse(userData));
  }, [router]);

  // Close the mobile drawer on navigation.
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  // Escape closes the drawer and restores focus to the menu button.
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
        menuBtnRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  const logout = () => {
    localStorage.removeItem('medika_admin_token');
    localStorage.removeItem('medika_admin_user');
    router.push('/login');
  };

  if (!user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  const currentPage = navItems.find(n => matches(pathname, n.href));

  return (
    <div className="admin-shell">
      {sidebarOpen && (
        <div className="drawer-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`} aria-label="Navigation principale">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z" fill="currentColor" />
            </svg>
          </span>
          <div>
            <div className="brand-word">Medika</div>
            <div className="brand-sub">Administration</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => {
            const isActive = matches(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon size={18} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="sidebar-avatar" aria-hidden>
              {user.name?.charAt(0)?.toUpperCase() || 'A'}
            </span>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div className="sidebar-user-name">{user.name}</div>
              <div className="sidebar-user-role">Administrateur</div>
            </div>
          </div>
          <button className="sidebar-link" onClick={logout}>
            <LogOut size={18} aria-hidden />
            Déconnexion
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="admin-header">
          <div className="admin-header-left">
            <button
              ref={menuBtnRef}
              onClick={() => setSidebarOpen(!sidebarOpen)}
              style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: 'var(--mk-text-secondary)' }}
              className="mobile-menu-btn"
              aria-label={sidebarOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
              aria-expanded={sidebarOpen}
            >
              {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            <div className="admin-page-name">
              {currentPage?.label || 'Medika'}
            </div>
          </div>
          <div className="admin-header-right">
            <span className="admin-date">
              {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
            <AccountMenu user={user} onLogout={logout} />
          </div>
        </header>
        <div className="admin-content">{children}</div>
      </main>
    </div>
  );
}
