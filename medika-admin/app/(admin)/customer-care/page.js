'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, formatDate } from '../../../lib/api';
import { MessageSquare, Clock, ChevronRight } from 'lucide-react';

function timeAgo(ts) {
  if (!ts) return '';
  const now = Date.now();
  const diff = Math.floor((now - ts * 1000) / 1000);
  if (diff < 60) return "A l'instant";
  if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `Il y a ${Math.floor(diff / 86400)}j`;
  return formatDate(ts);
}

export default function CustomerCarePage() {
  const router = useRouter();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    try {
      const query = filter === 'all' ? '' : `?status=${filter}`;
      const data = await apiFetch(`/admin/tickets${query}`);
      setTickets(data.tickets || data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  // Polling every 5s
  useEffect(() => {
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const openCount = tickets.filter(t => t.status === 'open').length;
  const closedCount = tickets.filter(t => t.status === 'closed').length;

  const tabs = [
    { key: 'all', label: `Tous (${tickets.length})` },
    { key: 'open', label: `Ouverts (${openCount})` },
    { key: 'closed', label: `Ferm\u00e9s (${closedCount})` },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 10 }}>
          <MessageSquare size={24} />
          Service Client
        </h1>
        {loading && <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />}
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setFilter(tab.key); setLoading(true); }}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              background: filter === tab.key ? '#059669' : '#f3f4f6',
              color: filter === tab.key ? '#fff' : '#374151',
              transition: 'all 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Ticket List */}
      {loading && tickets.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><div className="spinner" /></div>
      ) : tickets.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: '#6b7280' }}>
          <MessageSquare size={48} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
          <div style={{ fontSize: 16, fontWeight: 600 }}>Aucun ticket trouv\u00e9</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tickets.map(ticket => (
            <div
              key={ticket.id}
              onClick={() => router.push(`/customer-care/${ticket.id}`)}
              className="card"
              style={{
                cursor: 'pointer',
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                transition: 'box-shadow 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
            >
              {/* Avatar */}
              <div style={{
                width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
                background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#059669', fontWeight: 700, fontSize: 16
              }}>
                {(ticket.user_name || ticket.user?.name || '?').charAt(0).toUpperCase()}
              </div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 15, color: '#111827' }}>
                    {ticket.subject || 'Sans sujet'}
                  </span>
                  <span className={`badge ${ticket.status === 'open' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 11 }}>
                    {ticket.status === 'open' ? 'Ouvert' : 'Ferm\u00e9'}
                  </span>
                  {ticket.unread_count > 0 && (
                    <span className="badge badge-red" style={{ fontSize: 11, minWidth: 20, textAlign: 'center' }}>
                      {ticket.unread_count}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 2 }}>
                  {ticket.user_name || ticket.user?.name || 'Utilisateur inconnu'}
                </div>
                {ticket.last_message && (
                  <div style={{
                    fontSize: 13, color: '#9ca3af',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 500
                  }}>
                    {ticket.last_message}
                  </div>
                )}
              </div>

              {/* Right side: time + chevron */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, color: '#9ca3af' }}>
                <Clock size={14} />
                <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{timeAgo(ticket.updated_at || ticket.created_at)}</span>
                <ChevronRight size={16} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
