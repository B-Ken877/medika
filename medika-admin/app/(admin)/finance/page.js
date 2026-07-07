'use client';
import React, { useState, useEffect } from 'react';
import { apiFetch, formatCurrency, formatDate } from '../../../lib/api';
import { DollarSign, TrendingUp, Users, Calendar, Wallet, AlertCircle } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend
} from 'recharts';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: '#0F172A',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10, padding: '10px 14px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
      }}>
        <p style={{ color: '#94A3B8', fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </p>
        {payload.map(p => (
          <p key={p.name} style={{ color: p.color, fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
            {p.name}: {formatCurrency(p.value)}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

function StatItem({ label, value, sub, icon: Icon, iconBg, iconColor, valueColor }) {
  return (
    <div className="stat-card" style={{ '--stat-color': iconColor }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div className="stat-icon" style={{ background: iconBg }}>
          <Icon size={18} color={iconColor} />
        </div>
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: valueColor || 'var(--text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

export default function FinancePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/admin/finance').then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <div style={{ marginBottom: 28 }}>
          <div className="skeleton" style={{ width: 120, height: 12, marginBottom: 6 }} />
          <div className="skeleton" style={{ width: 180, height: 28 }} />
        </div>
        <div className="finance-stats">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="stat-card">
              <div className="skeleton" style={{ width: 42, height: 42, borderRadius: 10, marginBottom: 14 }} />
              <div className="skeleton" style={{ width: 80, height: 10, marginBottom: 10 }} />
              <div className="skeleton" style={{ width: 120, height: 26 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) return (
    <div className="empty-state">
      <div className="empty-state-icon"><AlertCircle size={22} /></div>
      <p>Impossible de charger les données financières</p>
    </div>
  );

  // Build chart data: combine revenue + doctor earnings + medika earnings
  const chartData = data.history.map(h => ({
    name: `${h.month.substring(0, 3)} ${String(h.year).slice(2)}`,
    revenue: h.revenue,
  }));

  const currentYear = String(new Date().getFullYear()).slice(2);

  return (
    <div style={{ animation: 'slideUp 200ms ease' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          Rapports financiers
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>
          Finance
        </h1>
      </div>

      {/* Stats */}
      <div className="finance-stats">
        <StatItem
          label="Revenu du mois"
          value={formatCurrency(data.currentMonth.revenue)}
          sub={`${data.currentMonth.consultations} consultation(s) · ${data.currentMonth.label}`}
          icon={Calendar}
          iconBg="#DCFCE7"
          iconColor="#059669"
          valueColor="#059669"
        />
        <StatItem
          label="Gains médecins (mois)"
          value={formatCurrency(data.currentMonth.doctorEarnings || 0)}
          sub="Versements aux praticiens"
          icon={Wallet}
          iconBg="#DCFCE7"
          iconColor="#059669"
        />
        <StatItem
          label="Gains Medika (mois)"
          value={formatCurrency(data.currentMonth.medikaEarnings || 0)}
          sub="Frais de plateforme"
          icon={DollarSign}
          iconBg="#FEF3C7"
          iconColor="#B45309"
          valueColor="#B45309"
        />
        <StatItem
          label="Revenu total cumulé"
          value={formatCurrency(data.total.revenue)}
          sub={`${data.total.consultations} consultation(s) terminée(s)`}
          icon={TrendingUp}
          iconBg="#DBEAFE"
          iconColor="#2563EB"
        />
      </div>

      {/* Revenue chart */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">Historique des revenus — 12 mois</span>
          <span className="badge badge-green">HTG</span>
        </div>
        <div style={{ padding: '20px 20px 8px' }}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(226,232,240,0.5)" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10.5, fill: '#94A3B8', fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#94A3B8' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
                width={38}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(5,150,105,0.04)', radius: 4 }} />
              <Bar dataKey="revenue" fill="url(#greenGradFinance)" radius={[6, 6, 0, 0]} name="Revenu" />
              <defs>
                <linearGradient id="greenGradFinance" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#059669" />
                  <stop offset="100%" stopColor="#047857" stopOpacity={0.8} />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Doctor earnings */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <span className="card-title">Gains par médecin</span>
          <span className="badge badge-blue">Ce mois + total</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Médecin</th>
                <th>Spécialité</th>
                <th style={{ textAlign: 'right' }}>Consult. (mois)</th>
                <th style={{ textAlign: 'right' }}>Gains médecin (mois)</th>
                <th style={{ textAlign: 'right' }}>Consult. (total)</th>
                <th style={{ textAlign: 'right' }}>Gains totaux</th>
              </tr>
            </thead>
            <tbody>
              {data.doctorEarnings.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <div className="empty-state-icon"><Users size={22} /></div>
                      <p>Aucun médecin enregistré</p>
                    </div>
                  </td>
                </tr>
              ) : data.doctorEarnings.map(doc => (
                <tr key={doc.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #DCFCE7, #A7F3D0)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#059669', fontSize: 11, fontWeight: 800, flexShrink: 0,
                      }}>
                        {doc.name?.charAt(0)}
                      </div>
                      <span style={{ fontWeight: 700, fontSize: 13.5 }}>{doc.name}</span>
                    </div>
                  </td>
                  <td><span className="badge badge-blue">{doc.specialty}</span></td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{doc.monthlyConsultations}</td>
                  <td style={{ textAlign: 'right', fontWeight: 800, color: '#059669' }}>
                    {formatCurrency(doc.monthlyEarnings)}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{doc.totalConsultations}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>
                    {formatCurrency(doc.totalEarnings)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent transactions */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Transactions récentes</span>
          <span className="badge badge-gray">Ce mois</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Patient</th>
                <th>Médecin</th>
                <th>Spécialité</th>
                <th style={{ textAlign: 'right' }}>Montant total</th>
                <th style={{ textAlign: 'right' }}>Part médecin</th>
                <th style={{ textAlign: 'right' }}>Part Medika</th>
              </tr>
            </thead>
            <tbody>
              {data.recentTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state">
                      <div className="empty-state-icon"><DollarSign size={22} /></div>
                      <p>Aucune transaction ce mois</p>
                    </div>
                  </td>
                </tr>
              ) : data.recentTransactions.map(t => (
                <tr key={t.id}>
                  <td style={{ fontSize: 12.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {formatDate(t.date)}
                  </td>
                  <td style={{ fontWeight: 600 }}>{t.patientName}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{t.doctorName}</td>
                  <td><span className="badge badge-blue">{t.specialty}</span></td>
                  <td style={{ textAlign: 'right', fontWeight: 800 }}>
                    {formatCurrency(t.amount)}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#059669' }}>
                    {formatCurrency(t.doctorEarning)}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#B45309' }}>
                    {formatCurrency(t.medikaEarning)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
