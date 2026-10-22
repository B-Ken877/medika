"use client";

/**
 * Support tickets list — port of TicketListScreen.kt.
 * GET /api/tickets (production endpoint — see PR notes) + create modal.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LifeBuoy, MessageCircle, Plus } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { createTicket, getTickets } from "@/lib/api/endpoints";
import type { Ticket } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { EmptyState, ErrorAlert, SkeletonRows } from "@/components/ui/primitives";

function ticketTitle(t: Ticket): string {
  return String(t.subject ?? t.title ?? `Demande #${t.id}`);
}

function ticketDate(t: Ticket): string {
  const raw = t.updated_at ?? t.created_at;
  const ts = typeof raw === "number" ? raw : Date.parse(String(raw ?? "")) / 1000;
  if (!Number.isFinite(ts) || ts <= 0) return "";
  return new Date(ts * 1000).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function ticketPreview(t: Ticket): string {
  const last = t.last_message;
  if (typeof last === "string") return last;
  return "Ouvrez la conversation pour voir les messages.";
}

export default function TicketsPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);

  const load = useCallback(() => {
    if (!token) return;
    const controller = new AbortController();
    getTickets(token, controller.signal)
      .then((list) => {
        setTickets(Array.isArray(list) ? list : []);
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err);
        setTickets([]);
      });
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    const cleanup = load();
    return () => cleanup?.();
  }, [load]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || submitting) return;
    if (!subject.trim()) {
      setFormError(new ApiError("validation", 0, "Indiquez l'objet de votre demande."));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const ticket = await createTicket(token, { subject: subject.trim(), message: message.trim() || undefined });
      setCreating(false);
      setSubject("");
      setMessage("");
      const id = (ticket as { id?: string | number }).id;
      if (id != null) router.push(`/app/tickets/${encodeURIComponent(String(id))}`);
      else load();
    } catch (err) {
      setFormError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stack">
      <div className="flex-between">
        <div>
          <h1 className="page-title">Assistance</h1>
          <p className="muted small">Le service client Medika répond à vos demandes</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          <Plus size={15} aria-hidden /> Nouvelle demande
        </button>
      </div>

      {tickets === null && !error && <SkeletonRows count={3} />}
      <ErrorAlert error={error} onRetry={load} />

      {tickets !== null && tickets.length === 0 && !error && (
        <div className="card">
          <EmptyState
            icon={<LifeBuoy size={26} />}
            title="Aucune demande d'assistance"
            description="Un problème de paiement, de connexion ou de consultation ? Créez une demande, l'équipe Medika vous répondra."
            action={
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                Créer une demande
              </button>
            }
          />
        </div>
      )}

      <div className="list">
        {(tickets ?? []).map((t) => (
          <Link key={String(t.id)} href={`/app/tickets/${encodeURIComponent(String(t.id))}`} className="row">
            <span className="brand-mark" aria-hidden>
              <MessageCircle size={16} />
            </span>
            <div className="row-body">
              <div className="row-title">
                <span>{ticketTitle(t)}</span>
                {typeof t.status === "string" && (
                  <span className={`badge ${t.status === "open" ? "badge-blue" : "badge-green"}`}>{t.status}</span>
                )}
              </div>
              <div className="row-sub">{ticketPreview(t)}</div>
              {ticketDate(t) && <div className="row-meta">{ticketDate(t)}</div>}
            </div>
          </Link>
        ))}
      </div>

      {creating && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">Nouvelle demande d&apos;assistance</h2>
            <ErrorAlert error={formError} />
            <form onSubmit={onCreate}>
              <div className="field">
                <label htmlFor="ticket-subject">Objet</label>
                <input
                  id="ticket-subject"
                  className="input"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Ex : Problème de paiement MonCash"
                  maxLength={200}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="ticket-message">Décrivez votre problème</label>
                <textarea
                  id="ticket-message"
                  className="textarea"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Détaillez votre situation pour nous aider à résoudre rapidement…"
                  maxLength={4000}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)} disabled={submitting}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? "Envoi…" : "Envoyer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
