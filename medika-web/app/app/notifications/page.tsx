"use client";

/**
 * In-app notification center — web counterpart of NotificationsScreen.kt.
 * The backend has no REST endpoint for notification history; the Android
 * screen is equally driven by live events. This page therefore surfaces
 * realtime events (consultation updates, new requests, incoming calls)
 * for the current session and routes the user to the right screen.
 * No fabricated history, no persistence of medical data.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CalendarCheck, Phone, Stethoscope, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { useSocket } from "@/lib/ws/socket-context";
import { EmptyState } from "@/components/ui/primitives";
import { relativeTime } from "@/lib/format";

interface Notice {
  id: string;
  icon: "consult" | "update" | "call";
  title: string;
  body: string;
  href: string;
  at: number; // epoch ms
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    if (!socket || !user) return;
    const push = (n: Omit<Notice, "id" | "at">) => {
      setNotices((prev) => [{ ...n, id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, at: Date.now() }, ...prev].slice(0, 50));
    };
    return socket.onEvent((event) => {
      if (event.type === "consultation:new") {
        const e = event as { id: string; patientName?: string; description?: string; specialtyNeeded?: string };
        if (user.role === "doctor" && !e.patientName) return;
        push({
          icon: "consult",
          title: user.role === "doctor" ? "Nouvelle demande de consultation" : "Demande envoyée",
          body:
            user.role === "doctor"
              ? `${e.patientName ?? "Un patient"} — ${e.specialtyNeeded ?? ""} : ${e.description ?? ""}`
              : `Votre demande (${e.specialtyNeeded ?? ""}) est en attente d'un médecin.`,
          href: `/app/consultations/${encodeURIComponent(e.id)}`,
        });
      } else if (event.type === "consultation:updated") {
        const e = event as { id: string; status?: string; doctor_id?: string | null };
        const labels: Record<string, string> = {
          EN_COURS: "consultation acceptée — la conversation est ouverte",
          TERMINE: "consultation clôturée — consultez votre ordonnance",
          REFUSE: "demande refusée",
        };
        const label = e.status ? (labels[e.status] ?? e.status) : "mise à jour";
        push({
          icon: "update",
          title: "Mise à jour de consultation",
          body: `Votre ${label}.`,
          href: `/app/consultations/${encodeURIComponent(e.id)}`,
        });
      } else if (event.type === "call:incoming") {
        const e = event as { consultationId: string; fromName?: string; callType?: string };
        push({
          icon: "call",
          title: `Appel ${e.callType === "video" ? "vidéo" : "vocal"} entrant`,
          body: `${e.fromName ?? "Votre interlocuteur"} vous appelle. Rejoignez l'appel depuis la conversation.`,
          href: `/app/consultations/${encodeURIComponent(e.consultationId)}`,
        });
      }
    });
  }, [socket, user]);

  const clear = useCallback(() => setNotices([]), []);

  const Icon = { consult: Stethoscope, update: CalendarCheck, call: Phone };

  return (
    <div className="stack">
      <div className="flex-between">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="muted small">Événements de votre session en cours</p>
        </div>
        {notices.length > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={clear}>
            <Trash2 size={14} aria-hidden /> Effacer
          </button>
        )}
      </div>

      {notices.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Bell size={26} />}
            title="Aucune notification pour le moment"
            description="Les mises à jour de vos consultations et les appels entrants apparaîtront ici en temps réel."
          />
        </div>
      ) : (
        <div className="list">
          {notices.map((n) => {
            const IconFor = Icon[n.icon];
            return (
              <button
                key={n.id}
                className="row"
                onClick={() => router.push(n.href)}
                aria-label={`${n.title} — ${n.body}`}
              >
                <span className="brand-mark" aria-hidden>
                  <IconFor size={16} />
                </span>
                <div className="row-body">
                  <div className="row-title">{n.title}</div>
                  <div className="row-sub">{n.body}</div>
                  <div className="row-meta">{relativeTime(Math.floor(n.at / 1000))}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <p className="tiny muted text-center">
        Les notifications sont éphémères et propres à cet onglet — aucune donnée médicale n&apos;est stockée sur
        votre appareil. Consultez{" "}
        <Link href="/app/consultations" className="nowrap">
          vos consultations
        </Link>{" "}
        pour l&apos;historique complet.
      </p>
    </div>
  );
}
