'use client';
import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, Users, MessageSquare, DollarSign,
  LogOut, Menu, X, Stethoscope, Tag, Activity,
  ChevronRight
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/doctors', label: 'Médecins', icon: Stethoscope },
  { href: '/patients', label: 'Patients', icon: Users },
  { href: '/consultations', label: 'Consultations', icon: MessageSquare },
  { href: '/tarification', label: 'Tarification', icon: Tag },
  { href: '/finance', label: 'Finance', icon: DollarSign },
];

function NavLink({ item, isActive, onClick }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`sidebar-link ${isActive ? 'active' : ''}`}
      onClick={onClick}
    >
      <Icon size={16} className="nav-icon" />
      <span style={{ flex: 1 }}>{item.label}</span>
      {isActive && (
        <ChevronRight size={13} style={{ opacity: 0.5 }} />
      )}
    </Link>
  );
}

export default function AdminLayout({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('medika_admin_token');
    if (!token) { router.push('/login'); return; }
    const userData = localStorage.getItem('medika_admin_user');
    if (userData) setUser(JSON.parse(userData));
  }, [router]);

  const logout = () => {
    localStorage.removeItem('medika_admin_token');
    localStorage.removeItem('medika_admin_user');
    router.push('/login');
  };

  if (!user) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg-app)'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: 20, margin: '0 auto 16px',
            boxShadow: '0 0 0 1px rgba(5,150,105,0.3), 0 4px 10px rgba(5,150,105,0.3)'
          }}>M</div>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      </div>
    );
  }

  const currentPage = navItems.find(
    n => pathname === n.href || (n.href !== '/dashboard' && pathname.startsWith(n.href))
  );

  const initials = user.name?.split(' ').map(w => w[0]).slice(0, 2).join('') || 'A';
  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(8,13,24,0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 35,
            animation: 'fadeIn 150ms ease'
          }}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>

        {/* Logo */}
        <div className="sidebar-logo-area">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="sidebar-logo-mark">M</div>
            <div>
              <div style={{
                fontWeight: 800, fontSize: 15, color: '#fff',
                letterSpacing: '-0.03em', lineHeight: 1.2
              }}>Medika</div>
              <div style={{
                fontSize: 10, color: 'rgba(139,151,176,0.7)',
                fontWeight: 600, letterSpacing: '0.04em',
                textTransform: 'uppercase', marginTop: 1
              }}>Administration</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Navigation</div>
          {navItems.map(item => {
            const isActive = pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <NavLink
                key={item.href}
                item={item}
                isActive={isActive}
                onClick={() => setSidebarOpen(false)}
              />
            );
          })}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initials}</div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{
                fontSize: 12.5, fontWeight: 700, color: '#E2E8F0',
                letterSpacing: '-0.01em',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>{user.name}</div>
              <div style={{
                fontSize: 11, color: 'rgba(139,151,176,0.6)',
                marginTop: 1, fontWeight: 500
              }}>Administrateur</div>
            </div>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#10B981', flexShrink: 0,
              boxShadow: '0 0 0 2px rgba(16,185,129,0.2)'
            }} />
          </div>
          <button
            className="sidebar-link"
            onClick={logout}
            style={{ color: '#F87171', margin: 0, width: '100%' }}
          >
            <LogOut size={15} className="nav-icon" />
            <span>Déconnexion</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="main-content">

        {/* Top bar */}
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="mobile-menu-btn btn btn-secondary btn-icon"
            >
              {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {currentPage && (
                <>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Medika</span>
                  <ChevronRight size={12} color="var(--text-placeholder)" />
                  <span style={{
                    fontSize: 14, fontWeight: 700, color: 'var(--text-primary)',
                    letterSpacing: '-0.02em'
                  }}>{currentPage.label}</span>
                </>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 7, height: 7, borderRadius: '50%',
                background: '#10B981',
                boxShadow: '0 0 0 2px rgba(16,185,129,0.15)'
              }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
                {today}
              </span>
            </div>
          </div>
        </header>

        <div className="page-content">
          {children}
        </div>
      </main>
    </div>
  );
}
