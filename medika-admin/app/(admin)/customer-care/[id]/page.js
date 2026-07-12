'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { apiFetch, formatDate } from '../../../../lib/api';
import { ArrowLeft, Send, Paperclip, Lock, RotateCcw, MessageSquare, Headphones } from 'lucide-react';

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
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const i = setInterval(load, 3000); return () => clearInterval(i); }, [load]);
  useEffect(() => {
    if (messages.length > 0) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
    } catch (e) { console.error(e); }
    finally { setSending(false); }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleTextareaChange = (e) => {
    setContent(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const closeTicket = async () => {
    setClosing(true);
    try { await apiFetch(`/admin/tickets/${id}/close`, { method: 'PUT' }); load(); }
    catch (e) { console.error(e); }
    finally { setClosing(false); }
  };

  const reopenTicket = async () => {
    setClosing(true);
    try { await apiFetch(`/admin/tickets/${id}/reopen`, { method: 'PUT' }); load(); }
    catch (e) { console.error(e); }
    finally { setClosing(false); }
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    return new Date(ts * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="cc-chat-page">
        <div className="cc-loading"><div className="spinner" /></div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="cc-chat-page">
        <div className="cc-loading" style={{ flexDirection: 'column', gap: 16 }}>
          <MessageSquare size={40} style={{ opacity: 0.2 }} />
          <div style={{ color: '#6b7280', fontSize: 15, fontWeight: 600 }}>Ticket introuvable</div>
          <button className="btn btn-secondary" onClick={() => router.push('/customer-care')}>
            <ArrowLeft size={16} /> Retour aux tickets
          </button>
        </div>
      </div>
    );
  }

  const isClosed = ticket.status === 'closed';
  const userName = ticket.user_name || 'Utilisateur';
  const initials = userName.charAt(0).toUpperCase();

  return (
    <div className="cc-chat-page">
      {/* Header */}
      <div className="cc-chat-header">
        <div className="cc-chat-header-left">
          <button className="btn btn-secondary btn-sm" onClick={() => router.push('/customer-care')} style={{ borderRadius: 10 }}>
            <ArrowLeft size={16} />
          </button>
          <div className="cc-chat-header-info">
            <h2>
              {ticket.subject || 'Sans sujet'}
              <span className={`badge ${isClosed ? 'badge-gray' : 'badge-green'}`} style={{ marginLeft: 10, fontSize: 11, verticalAlign: 'middle' }}>
                {isClosed ? 'Ferm\u00e9' : 'Ouvert'}
              </span>
            </h2>
            <p><Headphones size={13} style={{ verticalAlign: -2, marginRight: 4, opacity: 0.5 }} />{userName}</p>
          </div>
        </div>
        <div className="cc-chat-header-actions">
          {isClosed ? (
            <button className="btn btn-primary btn-sm" onClick={reopenTicket} disabled={closing} style={{ borderRadius: 10 }}>
              <RotateCcw size={14} /> {closing ? '...' : 'R\u00e9ouvrir'}
            </button>
          ) : (
            <button className="btn btn-danger btn-sm" onClick={closeTicket} disabled={closing} style={{ borderRadius: 10 }}>
              <Lock size={14} /> {closing ? '...' : 'Fermer'}
            </button>
          )}
        </div>
      </div>

      {/* Closed banner */}
      {isClosed && (
        <div className="cc-chat-status-bar">
          <Lock size={14} />
          Ce ticket est ferm\u00e9. Vous ne pouvez plus envoyer de messages.
        </div>
      )}

      {/* Messages */}
      <div className="cc-chat-messages">
        {messages.length === 0 ? (
          <div className="cc-empty">
            <MessageSquare size={36} />
            <div>Aucun message pour le moment</div>
            <div style={{ fontSize: 12, color: '#b0b0b0' }}>Commencez la conversation</div>
          </div>
        ) : messages.map((msg, idx) => {
          const isAdmin = msg.sender_role === 'admin';
          return (
            <div key={msg.id || idx} className={`cc-msg ${isAdmin ? 'cc-msg-admin' : 'cc-msg-user'}`}>
              <div className={`cc-msg-avatar ${isAdmin ? 'admin-av' : 'user-av'}`}>
                {isAdmin ? 'M' : initials}
              </div>
              <div>
                <div className="cc-msg-bubble">
                  {msg.content}
                  {msg.file_url && (
                    <a
                      href={msg.file_url.startsWith('http') ? msg.file_url : `https://medikahaiti.site${msg.file_url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="cc-msg-attachment"
                    >
                      <Paperclip size={13} />
                      {msg.file_type || 'Fichier'}
                    </a>
                  )}
                </div>
                <div className="cc-msg-footer">
                  <span style={{ fontWeight: 500, color: '#6b7280' }}>{msg.sender_name || (isAdmin ? 'Support Medika' : userName)}</span>
                  <span>{formatTime(msg.created_at)}</span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="cc-chat-input-area">
        <div className="cc-chat-input-row">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder={isClosed ? 'Ce ticket est ferm\u00e9' : '\u00c9crire un message... (Entr\u00e9e pour envoyer)'}
            disabled={isClosed || sending}
            rows={1}
          />
          <button
            className="cc-send-btn"
            onClick={sendMessage}
            disabled={isClosed || sending || !content.trim()}
            title="Envoyer"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}