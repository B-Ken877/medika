"use client";

/**
 * Ticket conversation — port of TicketChatScreen.kt.
 * GET /api/tickets/:id then POST /api/tickets/:id/messages (production
 * endpoints — see PR notes). Defensive parsing: the ticket payload embeds
 * the thread under different keys depending on backend version.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowDown, ArrowLeft, LifeBuoy, Send } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { getTicket, sendTicketMessage } from "@/lib/api/endpoints";
import type { Ticket, TicketMessage } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { formatTime } from "@/lib/format";
import { ErrorAlert, Spinner } from "@/components/ui/primitives";
import { useChatScroll } from "@/components/consultation/useChatScroll";

function extractMessages(ticket: Ticket | null): TicketMessage[] {
  if (!ticket) return [];
  const candidates = [ticket.messages, ticket.thread, (ticket as { ticket_messages?: unknown }).ticket_messages];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as TicketMessage[];
  }
  return [];
}

function messageText(m: TicketMessage): string {
  return String(m.text ?? m.message ?? "");
}

function messageAuthor(m: TicketMessage, userId?: string): "mine" | "support" | "system" {
  if (m.sender_id && userId && m.sender_id === userId) return "mine";
  if (m.sender_role === "admin" || m.sender_role === "support") return "support";
  return m.sender_id ? "mine" : "system";
}

export default function TicketChatPage() {
  const { id } = useParams<{ id: string }>();
  const ticketId = String(id ?? "");
  const { token, user } = useAuth();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    if (!token || !ticketId) return;
    const controller = new AbortController();
    getTicket(token, ticketId, controller.signal)
      .then((t) => {
        setTicket(t);
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err);
      });
    return () => controller.abort();
  }, [token, ticketId]);

  useEffect(() => {
    const cleanup = load();
    return () => cleanup?.();
  }, [load]);

  const messages = useMemo(() => extractMessages(ticket), [ticket]);

  // ── Chat scroll (issue #16): open on the latest message, stick to the
  // bottom only while the user is there, jump affordance while reading up.
  const { logRef, jumpVisible, jumpCount, jumpToLatest } = useChatScroll({
    conversationId: ticketId,
    ready: ticket !== null,
    messageCount: messages.length,
    contentVersion: `${ticketId}:${messages.length}:${messages.length ? String(messages[messages.length - 1].created_at ?? "") : ""}`,
  });

  const onSend = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !token || sending) return;
    setSending(true);
    try {
      await sendTicketMessage(token, ticketId, text);
      setDraft("");
      load();
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  };

  if (!ticket && !error) return <Spinner label="N ap chaje demann nan..." />;

  if (error && !ticket) {
    return (
      <div className="stack" style={{ maxWidth: 560, margin: "0 auto" }}>
        <Link href="/app/tickets" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>
          <ArrowLeft size={16} aria-hidden /> Retounen sou èd la
        </Link>
        <ErrorAlert error={error} onRetry={load} />
      </div>
    );
  }

  const title = String(ticket?.subject ?? ticket?.title ?? `Demann #${ticketId}`);

  return (
    <div className="chat-shell">
      <header className="app-header">
        <Link href="/app/tickets" className="icon-btn" aria-label="Retounen sou èd la">
          <ArrowLeft size={20} />
        </Link>
        <span className="brand-mark" aria-hidden>
          <LifeBuoy size={16} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "0.95rem" }} className="nowrap">
            {title}
          </div>
          <div className="tiny muted">
            {typeof ticket?.status === "string" ? ticket.status : "Èd Medika"}
          </div>
        </div>
      </header>

      <div style={{ padding: "0 12px" }}>
        <ErrorAlert error={error} onRetry={load} />
      </div>

      <div className="chat-log" ref={logRef} role="log" aria-label="Mesaj demann èd la">
       <div className="chat-log-inner">
        {messages.length === 0 && (
          <div className="empty-state">
            <h3>Premye mesaj la</h3>
            <p className="small">Deskribe pwoblèm ou a, ekip Medika a ap reponn w isit.</p>
          </div>
        )}
        {messages.map((m, i) => {
          const who = messageAuthor(m, user?.id);
          if (who === "system") {
            return (
              <div key={i} className="chat-day">
                <span className="tiny">{messageText(m)}</span>
              </div>
            );
          }
          return (
            <div key={i} className={`bubble-row ${who === "mine" ? "mine" : ""}`}>
              <div className="bubble">
                {m.sender_name && <div className="tiny" style={{ opacity: 0.8, marginBottom: 2 }}>{m.sender_name}</div>}
                <div>{messageText(m)}</div>
                {typeof m.created_at === "number" && <div className="bubble-meta">{formatTime(m.created_at)}</div>}
              </div>
            </div>
          );
        })}
       </div>
      </div>

      {jumpVisible && (
        <button type="button" className="jump-latest" onClick={jumpToLatest}>
          <ArrowDown size={15} aria-hidden />
          {jumpCount > 0 ? `${jumpCount} mesaj nouvo` : "Dènye mesaj yo"}
        </button>
      )}

      <form className="chat-composer" onSubmit={onSend}>
        <input
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ekri mesaj ou..."
          aria-label="Mesaj èd ou a"
          maxLength={4000}
          /* Issue #47 — same composer contract as the consultation chat:
             non-autofillable chat field, send action key. The Android
             keyboard/autofill accessory strip is OS/keyboard-owned and
             cannot be removed by web content. */
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="send"
        />
        <button type="submit" className="composer-btn send" disabled={!draft.trim() || sending} aria-label="Voye">
          <Send size={19} />
        </button>
      </form>
    </div>
  );
}
