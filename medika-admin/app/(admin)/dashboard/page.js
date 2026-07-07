'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { apiFetch, formatCurrency } from '../../../lib/api';
import {
  Stethoscope, Users, MessageSquare, DollarSign,
  TrendingUp, Clock, CheckCircle, AlertCircle, Wallet,
  ArrowUpRight
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid
} from 'recharts';

function StatCard({ label, value, icon: Icon, color, bg, href, accent }) {
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
      <div className="stat-card" style={{ '--stat-color': accent || color }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div className="stat-icon" style={{ background: bg }}>
            <Icon size={18} color={color} />
          </div>
          <ArrowUpRight size={14} color="var(--text-muted)" style={{ opacity: 0 }} className="link-arrow" />
        </div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
    </Link>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: '#0F172A', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10, padding: '10px 14px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
      }}>
        <p style={{ color: '#94A3B8', fontSize: 11, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
        {payload.map(p => (
          <p key={p.name} style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>
            {formatCurrency(p.value)}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

function SkeletonCard() {
  return (
    <div className="stat-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="skeleton" style={{ width: 42, height: 42, borderRadius: 10 }} />
      </div>
      <div className="skeleton" style={{ width: 80, height: 10, marginBottom: 10 }} />
      <div className="skeleton" style={{ width: 60, height: 26 }} />
    </div>
  );
}

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
      <div>
        <div style={{ marginBottom: 24 }}>
          <div className="skeleton" style={{ width: 160, height: 14, marginBottom: 6 }} />
          <div className="skeleton" style={{ width: 240, height: 28 }} />
        </div>
        <div className="grid-stats">
          {[...Array(8)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  if (!stats) return (
    <div className="empty-state">
      <div className="empty-state-icon"><AlertCircle size={22} /></div>
      <p>Impossible de charger les statistiques</p>
    </div>
  );

  const statCards = [
    { label: 'Médecins', value: stats.totalDoctors, icon: Stethoscope, color: '#059669', bg: '#DCFCE7', href: '/doctors', accent: '#059669' },
    { label: 'Patients', value: stats.totalPatients, icon: Users, color: '#2563EB', bg: '#DBEAFE', href: '/patients', accent: '#2563EB' },
    { label: 'Consultations actives', value: stats.activeConsultations, icon: Clock, color: '#D97706', bg: '#FEF3C7', href: '/consultations', accent: '#D97706' },
    { label: 'Consultations terminées', value: stats.completedConsultations, icon: CheckCircle, color: '#7C3AED', bg: '#EDE9FE', href: '/consultations', accent: '#7C3AED' },
    { label: 'En attente', value: stats.pendingConsultations, icon: AlertCircle, color: '#DC2626', bg: '#FEE2E2', href: '/consultations', accent: '#DC2626' },
    { label: 'Messages', value: stats.totalMessages, icon: MessageSquare, color: '#0891B2', bg: '#CFFAFE', href: '/consultations', accent: '#0891B2' },
    { label: 'Revenu total', value: formatCurrency(stats.totalRevenue), icon: DollarSign, color: '#059669', bg: '#DCFCE7', href: '/finance', accent: '#059669' },
    { label: 'Revenu du mois', value: formatCurrency(stats.monthlyRevenue), icon: TrendingUp, color: '#B45309', bg: '#FEF3C7', href: '/finance', accent: '#B45309' },
  ];

  const chartData = stats.monthlyBreakdown
    ? stats.monthlyBreakdown.map(m => ({
        name: m.month.substring(0, 3),
        revenue: m.revenue,
      }))
    : [];

  return (
    <div style={{ animation: 'slideUp 200ms ease' }}>

      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          Vue d&apos;ensemble
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>
          Tableau de bord
        </h1>
      </div>

      {/* Stat grid */}
      <div className="grid-stats" style={{ marginBottom: 24 }}>
        {statCards.map((card, i) => (
          <StatCard key={i} {...card} />
        ))}
      </div>

      {/* Earnings split */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">Répartition des revenus — ce mois</span>
          <Link href="/finance" style={{ textDecoration: 'none' }}>
            <button className="btn btn-secondary btn-sm">
              Voir les détails <ArrowUpRight size={12} />
            </button>
          </Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <div className="revenue-split-item" style={{ borderRight: '1px solid var(--border)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginBottom: 10
            }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Wallet size={15} color="#059669" />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Gains Médecins
              </span>
            </div>
            <div style={{ fontSize: 30, fontWeight: 900, color: '#059669', letterSpacing: '-0.04em' }}>
              {formatCurrency(stats.monthlyDoctorEarnings || 0)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Versement aux praticiens</div>
          </div>
          <div className="revenue-split-item">
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginBottom: 10
            }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <DollarSign size={15} color="#B45309" />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Gains Medika
              </span>
            </div>
            <div style={{ fontSize: 30, fontWeight: 900, color: '#B45309', letterSpacing: '-0.04em' }}>
              {formatCurrency(stats.monthlyMedikaEarnings || 0)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Frais de plateforme</div>
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: chartData.length > 0 ? '1fr 1fr' : '1fr', gap: 20, marginBottom: 20 }}>

        {/* Monthly chart */}
        {chartData.length > 0 && (
          <div className="card">
            <div className="card-header">
              <span className="card-title">Revenus mensuels (6 mois)</span>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(226,232,240,0.5)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#94A3B8', fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#94A3B8' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={v => v > 0 ? `${(v / 1000).toFixed(0)}k` : '0'}
                    width={36}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(5,150,105,0.04)' }} />
                  <Bar
                    dataKey="revenue"
                    fill="url(#greenGrad)"
                    radius={[6, 6, 0, 0]}
                  />
                  <defs>
                    <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#059669" />
                      <stop offset="100%" stopColor="#047857" />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Doctor performance */}
        {stats.doctorEarnings && stats.doctorEarnings.length > 0 && (
          <div className="card" style={{ flex: 1 }}>
            <div className="card-header">
              <span className="card-title">Performance médecins</span>
              <span className="badge badge-green">Ce mois</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Médecin</th>
                    <th style={{ textAlign: 'right' }}>Consult.</th>
                    <th style={{ textAlign: 'right' }}>Gains</th>
                    <th style={{ textAlign: 'center' }}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.doctorEarnings.slice(0, 5).map(doc => (
                    <tr key={doc.id}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{doc.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{doc.specialty}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{doc.monthlyConsultations}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: '#059669' }}>
                        {formatCurrency(doc.monthlyEarnings)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 2,
                          background: '#FEF9C3', color: '#A16207',
                          padding: '2px 8px', borderRadius: 100, fontSize: 11, fontWeight: 700,
                        }}>
                          ★ {doc.rating}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
