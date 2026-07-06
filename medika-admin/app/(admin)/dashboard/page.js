'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch, formatCurrency } from '../../../lib/api';
import { Stethoscope, Users, MessageSquare, DollarSign, TrendingUp, Clock, CheckCircle, AlertCircle } from 'lucide-react';

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/admin/stats').then(setStats).catch(console.error).finally(() => setLoading(false));
    const iv = setInterval(() => { apiFetch('/admin/stats').then(setStats).catch(() => {}); }, 30000);
    return () => clearInterval(iv);
  }, []);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" /></div>;
  if (!stats) return <div className="empty-state"><p>Impossible de charger les statistiques</p></div>;

  const statCards = [
    { label: 'Medecins', value: stats.totalDoctors, icon: Stethoscope, color: '#059669', bg: '#d1fae5', href: '/doctors' },
    { label: 'Patients', value: stats.totalPatients, icon: Users, color: '#2563eb', bg: '#dbeafe', href: '/patients' },
    { label: 'Consultations actives', value: stats.activeConsultations, icon: Clock, color: '#d97706', bg: '#fef3c7', href: '/consultations' },
    { label: 'Consultations terminees', value: stats.completedConsultations, icon: CheckCircle, color: '#7c3aed', bg: '#ede9fe', href: '/consultations' },
    { label: 'En attente', value: stats.pendingConsultations, icon: AlertCircle, color: '#dc2626', bg: '#fee2e2', href: '/consultations' },
    { label: 'Messages', value: stats.totalMessages, icon: MessageSquare, color: '#0891b2', bg: '#cffafe', href: '/consultations' },
    { label: 'Revenu total', value: formatCurrency(stats.totalRevenue), icon: DollarSign, color: '#059669', bg: '#d1fae5', href: '/finance' },
    { label: 'Revenu du mois', value: formatCurrency(stats.monthlyRevenue), icon: TrendingUp, color: '#b45309', bg: '#fef3c7', href: '/finance' },
  ];

  return (
    <div>
      <div className="grid-stats">
        {statCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <Link key={i} href={card.href} style={{ textDecoration: 'none' }}>
              <div className="stat-card" style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>{card.label}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#111827' }}>{card.value}</div>
                  </div>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: card.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={20} color={card.color} />
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {stats.doctorEarnings && stats.doctorEarnings.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div style={{ padding: '16px 24px', borderBottom: '1px solid #e5e7eb', fontWeight: 600, fontSize: 15 }}>Performance des medecins (ce mois)</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr>
                <th>Medecin</th><th>Specialite</th><th style={{ textAlign: 'right' }}>Consult. (mois)</th>
                <th style={{ textAlign: 'right' }}>Gains (mois)</th><th style={{ textAlign: 'right' }}>Total consult.</th>
                <th style={{ textAlign: 'right' }}>Gains totaux</th><th style={{ textAlign: 'center' }}>Note</th>
              </tr></thead>
              <tbody>
                {stats.doctorEarnings.map(doc => (
                  <tr key={doc.id}>
                    <td style={{ fontWeight: 600 }}>{doc.name}</td>
                    <td><span className="badge badge-blue">{doc.specialty}</span></td>
                    <td style={{ textAlign: 'right' }}>{doc.monthlyConsultations}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#059669' }}>{formatCurrency(doc.monthlyEarnings)}</td>
                    <td style={{ textAlign: 'right' }}>{doc.totalConsultations}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(doc.totalEarnings)}</td>
                    <td style={{ textAlign: 'center' }}><span style={{ color: '#d97706', fontWeight: 600 }}>{doc.rating}/5</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {stats.monthlyBreakdown && (
        <div className="card" style={{ marginTop: 24, padding: 24 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 20 }}>Revenus mensuels (6 derniers mois)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 200 }}>
            {stats.monthlyBreakdown.map((m, i) => {
              const maxRev = Math.max(...stats.monthlyBreakdown.map(x => x.revenue), 1);
              const height = (m.revenue / maxRev) * 180;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#059669', marginBottom: 4 }}>{m.revenue > 0 ? formatCurrency(m.revenue) : ''}</div>
                  <div style={{ width: '100%', maxWidth: 60, height: Math.max(height, 4), background: m.revenue > 0 ? 'linear-gradient(180deg, #059669, #047857)' : '#e5e7eb', borderRadius: '6px 6px 0 0' }} />
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8, fontWeight: 500 }}>{m.month.substring(0, 3)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}