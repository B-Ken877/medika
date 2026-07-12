'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { MessageSquare, Clock, ChevronRight, Search, Inbox } from 'lucide-react';

function timeAgo(ts) {
  if (!ts) return '';
  const now = Date.now() / 1000;
  const diff = Math.floor(now - ts);
  if (diff < 60) return "\u00c0 l'instant";
  if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `Il y a ${Math.floor(diff / 86400)}j`;
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function CustomerCarePage() {
  const router = useRouter();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const query = filter === 'all' ? '' : `?status=${filter}`;
      const data = await apiFetch(`/admin/tickets${query}`);
      setTickets(data.tickets || data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const i = setInterval(load, 5000); return () => clearInterval(i); }, [load]);

  const openCount = tickets.filter(t => t.status === 'open').length;
  const closedCount = tickets.filter(t => t.status === 'closed').length;
  const filtered = search
    ? tickets.filter(t =>
        (t.subject || '').toLowerCase().includes(search.toLowerCase()) ||
        (t.user_name || '').toLowerCase().includes(search.toLowerCase())
      )
    : tickets;

  const tabs = [
    { key: 'all', label: `Tous (${tickets.length})` },
    { key: 'open', label: `Ouverts (${openCount})` },
    { key: 'closed', label: `Ferm\u00e9s (${closedCount})` },
  ];

  return (
    <div className="cc-page">
      <div className="cc-header">
        <h1><MessageSquare size={22} /> Service Client</h1>
        <div className="search-box">
          <span className="search-icon"><Search size={15} /></span>
          <input
            className="form-input"
            placeholder="Rechercher un ticket..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ paddingLeft: 34, width: 220, height: 38, fontSize: 13 }}
          />
        </div>
      </div>

      <div style={{ padding: '12px 20px 0' }}>
        <div className="cc-tabs">
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`cc-tab ${filter === tab.key ? 'active' : ''}`}
              onClick={() => { setFilter(tab.key); setLoading(true); }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading && filtered.length === 0 ? (
        <div className="cc-loading"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="cc-empty" style={{ padding: '80px 24px' }}>
          <Inbox size={48} />
          <div style={{ fontSize: 16, fontWeight: 600, color: '#6b7280' }}>Aucun ticket trouv\u00e9</div>
          <div style={{ fontSize: 13, color: '#9ca3af' }}>Les tickets de support appara\u00eetront ici</div>
        </div>
      ) : (
        <div className="cc-list">
          {filtered.map(ticket => (
            <div
              key={ticket.id}
              className="cc-ticket"
              onClick={() => router.push(`/customer-care/${ticket.id}`)}
            >
              <div className="cc-ticket-avatar">
                {(ticket.user_name || '?').charAt(0).toUpperCase()}
              </div>
              <div className="cc-ticket-body">
                <div className="cc-ticket-subject">
                  {ticket.subject || 'Sans sujet'}
                  <span className={`badge ${ticket.status === 'open' ? 'badge-green' : 'badge-gray'}`} style={{ marginLeft: 8, fontSize: 11 }}>
                    {ticket.status === 'open' ? 'Ouvert' : 'Ferm\u00e9'}
                  </span>
                </div>
                <div className="cc-ticket-meta">
                  <span>{ticket.user_name || 'Utilisateur'}</span>
                  <span style={{ color: '#d1d5db' }}>\u00b7</span>
                  <Clock size={12} style={{ opacity: 0.5 }} />
                  <span>{timeAgo(ticket.updated_at || ticket.created_at)}</span>
                </div>
                {ticket.last_message && (
                  <div className="cc-ticket-preview">{ticket.last_message}</div>
                )}
              </div>
              <div className="cc-ticket-right">
                {ticket.unread_count > 0 && <div className="cc-unread-dot" />}
                <ChevronRight size={16} style={{ color: '#d1d5db' }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}