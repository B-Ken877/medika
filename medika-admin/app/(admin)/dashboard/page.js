'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch, formatCurrency } from '../../../lib/api';
import {
  Stethoscope, Users, MessageSquare, DollarSign, TrendingUp, Clock,
  CheckCircle, AlertCircle, Wallet,
} from 'lucide-react';

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/admin/stats').then(setStats).catch(console.error).finally(() => setLoading(false));
    const iv = setInterval(() => { apiFetch('/admin/stats').then(setStats).catch(() => {}); }, 30000);
    return () => clearInterval(iv);
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <div className="spinner" />
      </div>
    );
  }
  if (!stats) {
    return (
      <div className="empty-state">
        <p>Impossible de charger les statistiques.</p>
      </div>
    );
  }

  const statCards = [
    { label: 'Médecins', value: stats.totalDoctors, icon: Stethoscope, dot: 'gray', href: '/doctors' },
    { label: 'Patients', value: stats.totalPatients, icon: Users, dot: 'gray', href: '/patients' },
    { label: 'Consultations actives', value: stats.activeConsultations, icon: Clock, dot: 'green', href: '/consultations' },
    { label: 'Consultations terminées', value: stats.completedConsultations, icon: CheckCircle, dot: 'blue', href: '/consultations' },
    { label: 'En attente', value: stats.pendingConsultations, icon: AlertCircle, dot: 'yellow', href: '/consultations' },
    { label: 'Messages', value: stats.totalMessages, icon: MessageSquare, dot: 'gray', href: '/consultations' },
    { label: 'Revenu total', value: formatCurrency(stats.totalRevenue), icon: DollarSign, dot: 'green', href: '/finance' },
    { label: 'Revenu du mois', value: formatCurrency(stats.monthlyRevenue), icon: TrendingUp, dot: 'green', href: '/finance' },
  ];

  return (
    <div>
      {/* Page heading */}
      <div className="page-head">
        <div>
          <h1 className="page-title">Vue d&apos;ensemble</h1>
          <p className="page-desc">Suivez l&apos;activité et les indicateurs clés de Medika.</p>
        </div>
      </div>

      {/* KPI panels (real data) */}
      <div className="grid-stats">
        {statCards.map((card, i) => {
          const Icon = card.icon;
          return (
            <Link key={i} href={card.href} style={{ textDecoration: 'none' }}>
              <div className="stat-card" style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="stat-label">
                      <span className={`stat-dot ${card.dot}`} aria-hidden /> {card.label}
                    </div>
                    <div className="stat-value">{card.value}</div>
                  </div>
                  <Icon size={20} color="var(--mk-text-muted)" aria-hidden />
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* ── Earnings Split Card (Doctor vs Medika) ── */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">Répartition des revenus</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          <div style={{ padding: '24px', borderRight: '1px solid var(--mk-divider)', textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
              <Wallet size={18} color="var(--mk-success)" aria-hidden />
              <span className="stat-label" style={{ justifyContent: 'center' }}>Gains médecins (ce mois)</span>
            </div>
            <div className="stat-value num" style={{ color: 'var(--mk-success)', fontSize: 28 }}>
              {formatCurrency(stats.monthlyDoctorEarnings || 0)}
            </div>
          </div>
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
              <DollarSign size={18} color="var(--mk-brand)" aria-hidden />
              <span className="stat-label" style={{ justifyContent: 'center' }}>Gains Medika (ce mois)</span>
            </div>
            <div className="stat-value num" style={{ color: 'var(--mk-brand)', fontSize: 28 }}>
              {formatCurrency(stats.monthlyMedikaEarnings || 0)}
            </div>
          </div>
        </div>
      </div>

      {stats.doctorEarnings && stats.doctorEarnings.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header">Performance des médecins (ce mois)</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr>
                <th>Médecin</th><th>Spécialité</th><th style={{ textAlign: 'right' }}>Consult. (mois)</th>
                <th style={{ textAlign: 'right' }}>Gains médecin (mois)</th><th style={{ textAlign: 'right' }}>Total consult.</th>
                <th style={{ textAlign: 'right' }}>Gains totaux</th><th style={{ textAlign: 'center' }}>Note</th>
              </tr></thead>
              <tbody>
                {stats.doctorEarnings.map(doc => (
                  <tr key={doc.id}>
                    <td style={{ fontWeight: 600 }}>{doc.name}</td>
                    <td><span className="badge badge-blue">{doc.specialty}</span></td>
                    <td className="num" style={{ textAlign: 'right' }}>{doc.monthlyConsultations}</td>
                    <td className="num" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--mk-success)' }}>{formatCurrency(doc.monthlyEarnings)}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{doc.totalConsultations}</td>
                    <td className="num" style={{ textAlign: 'right' }}>{formatCurrency(doc.totalEarnings)}</td>
                    <td style={{ textAlign: 'center' }}><span className="num" style={{ color: 'var(--mk-warning)', fontWeight: 600 }}>{doc.rating}/5</span></td>
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
                  <div className="num" style={{ fontSize: 11, fontWeight: 600, color: 'var(--mk-success)', marginBottom: 4 }}>{m.revenue > 0 ? formatCurrency(m.revenue) : ''}</div>
                  <div style={{ width: '100%', maxWidth: 60, height: Math.max(height, 4), background: m.revenue > 0 ? 'var(--mk-brand)' : 'var(--mk-divider)', borderRadius: '6px 6px 0 0' }} />
                  <div style={{ fontSize: 11, color: 'var(--mk-text-muted)', marginTop: 8, fontWeight: 500 }}>{m.month.substring(0, 4)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
