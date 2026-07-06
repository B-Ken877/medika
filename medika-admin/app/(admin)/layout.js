'use client';
import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, Users, MessageSquare, DollarSign,
  LogOut, Menu, X, Stethoscope, Tag
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { href: '/doctors', label: 'Medecins', icon: Stethoscope },
  { href: '/patients', label: 'Patients', icon: Users },
  { href: '/consultations', label: 'Consultations', icon: MessageSquare },
  { href: '/tarification', label: 'Tarification', icon: Tag },
  { href: '/finance', label: 'Finance', icon: DollarSign },
];

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  const currentPage = navItems.find(n => pathname === n.href || (n.href !== '/dashboard' && pathname.startsWith(n.href)));

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 35 }} />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div style={{ padding: '24px 20px', borderBottom: '1px solid #1f2937' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, background: '#059669',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 16
            }}>M</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>Medika</div>
              <div style={{ fontSize: 11, color: '#9ca3af' }}>Administration</div>
            </div>
          </div>
        </div>

        <nav style={{ padding: '12px 0' }}>
          {navItems.map(item => {
            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}
                className={`sidebar-link ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}>
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '16px', borderTop: '1px solid #1f2937' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', background: '#374151',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#d1d5db', fontSize: 13, fontWeight: 600
            }}>{user.name?.charAt(0) || 'A'}</div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.name}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Administrateur</div>
            </div>
          </div>
          <button className="sidebar-link" onClick={logout} style={{ width: '100%', margin: 0, color: '#ef4444' }}>
            <LogOut size={18} />
            Deconnexion
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header style={{
          background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '12px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 30
        }}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
            className="mobile-menu-btn">
            {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>
            {currentPage?.label || 'Medika'}
          </div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </header>
        <div style={{ padding: 24 }}>{children}</div>
      </main>
    </div>
  );
}
