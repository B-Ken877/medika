'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { apiFetch, formatDate } from '../../../../lib/api';
import { ArrowLeft, Send, Paperclip, Lock, RotateCcw } from 'lucide-react';

export default function TicketChatPage() {
  const router = useRouter();
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [content, setContent] = useState('');
  const [closing, setClosing] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch(`/admin/tickets/${id}`);
      setTicket(data.ticket || data);
      setMessages(data.messages || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Polling every 3s
  useEffect(() => {
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [load]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const sendMessage = async () => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await apiFetch(`/admin/tickets/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: trimmed }),
      });
      setContent('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      load();
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleTextareaChange = (e) => {
    setContent(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const closeTicket = async () => {
    setClosing(true);
    try {
      await apiFetch(`/admin/tickets/${id}/close`, { method: 'PUT' });
      load();
    } catch (e) {
      console.error(e);
    } finally {
      setClosing(false);
    }
  };

  const reopenTicket = async () => {
    setClosing(true);
    try {
      await apiFetch(`/admin/tickets/${id}/reopen`, { method: 'PUT' });
      load();
    } catch (e) {
      console.error(e);
    } finally {
      setClosing(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="card" style={{ padding: 48, textAlign: 'center', color: '#6b7280' }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Ticket introuvable</div>
        <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => router.push('/customer-care')}>
          <ArrowLeft size={16} /> Retour
        </button>
      </div>
    );
  }

  const isClosed = ticket.status === 'closed';
  const userName = ticket.user_name || ticket.user?.name || 'Utilisateur';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', maxHeight: 'calc(100vh - 120px)' }}>
      {/* Header */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e5e7eb', borderRadius: 12,
        padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12, marginBottom: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => router.push('/customer-care')}>
            <ArrowLeft size={16} />
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>
                {ticket.subject || 'Sans sujet'}
              </span>
              <span className={`badge ${isClosed ? 'badge-red' : 'badge-green'}`} style={{ fontSize: 11 }}>
                {isClosed ? 'Ferm\u00e9' : 'Ouvert'}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{userName}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isClosed ? (
            <button className="btn btn-secondary btn-sm" onClick={reopenTicket} disabled={closing}>
              <RotateCcw size={14} /> {closing ? '...' : 'Rouvrir'}
            </button>
          ) : (
            <button className="btn btn-danger btn-sm" onClick={closeTicket} disabled={closing}>
              <Lock size={14} /> {closing ? '...' : 'Fermer'}
            </button>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="card" style={{
        flex: 1, overflowY: 'auto', padding: 20, display: 'flex',
        flexDirection: 'column', gap: 12, marginBottom: 16
      }}>
        {messages.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 14 }}>
            Aucun message pour le moment
          </div>
        ) : messages.map((msg, idx) => {
          const isAdmin = msg.sender_role === 'admin';
          return (
            <div key={msg.id || idx} style={{
              display: 'flex',
              justifyContent: isAdmin ? 'flex-end' : 'flex-start',
              gap: 8,
              maxWidth: '80%',
            }}>
              {!isAdmin && (
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                  background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#6b7280', fontWeight: 600, fontSize: 13, marginTop: 4
                }}>
                  {(msg.sender_name || userName).charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <div style={{
                  background: isAdmin ? '#059669' : '#f3f4f6',
                  color: isAdmin ? '#fff' : '#111827',
                  padding: '10px 14px',
                  borderRadius: isAdmin ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  fontSize: 14,
                  lineHeight: 1.5,
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}>
                  {msg.content}
                </div>
                {msg.file_url && (
                  <a href={msg.file_url} target="_blank" rel="noopener noreferrer" style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 12, color: '#059669', marginTop: 4, textDecoration: 'none',
                    padding: '4px 8px', background: '#f0fdf4', borderRadius: 6
                  }}>
                    <Paperclip size={12} />
                    {msg.file_type || 'Fichier'}
                    {msg.file_size && <span style={{ color: '#9ca3af' }}>({msg.file_size})</span>}
                  </a>
                )}
                <div style={{
                  fontSize: 11, color: '#9ca3af', marginTop: 4,
                  textAlign: isAdmin ? 'right' : 'left',
                  display: 'flex', alignItems: 'center', gap: 6, justifyContent: isAdmin ? 'flex-end' : 'flex-start'
                }}>
                  <span style={{ fontWeight: 500, color: '#6b7280' }}>{msg.sender_name || (isAdmin ? 'Admin' : userName)}</span>
                  <span>{formatDate(msg.created_at)}</span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="card" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <textarea
          ref={textareaRef}
          className="form-input"
          value={content}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          placeholder={isClosed ? 'Ce ticket est ferm\u00e9' : 'Ecrire un message... (Entr\u00e9e pour envoyer, Shift+Entr\u00e9e pour un saut de ligne)'}
          disabled={isClosed || sending}
          rows={1}
          style={{
            flex: 1, resize: 'none', maxHeight: 120,
            opacity: isClosed ? 0.5 : 1,
          }}
        />
        <button
          className="btn btn-primary"
          onClick={sendMessage}
          disabled={isClosed || sending || !content.trim()}
          style={{ height: 40, padding: '0 16px', flexShrink: 0 }}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
