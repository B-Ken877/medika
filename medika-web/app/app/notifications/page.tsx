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
          title: user.role === "doctor" ? "Nouvo demann konsiltasyon" : "Demann lan voye",
          body:
            user.role === "doctor"
              ? `${e.patientName ?? "Yon pasyan"} — ${e.specialtyNeeded ?? ""} : ${e.description ?? ""}`
              : `Demann ou a (${e.specialtyNeeded ?? ""}) ap tann yon doktè.`,
          href: `/app/consultations/${encodeURIComponent(e.id)}`,
        });
      } else if (event.type === "consultation:updated") {
        const e = event as { id: string; status?: string; doctor_id?: string | null };
        const labels: Record<string, string> = {
          EN_COURS: "konsiltasyon an aksepte — konvèsasyon an louvri",
          TERMINE: "konsiltasyon an fini — gade òrdònans ou a",
          REFUSE: "demann lan refize",
        };
        const label = e.status ? (labels[e.status] ?? e.status) : "yon mete ajou";
        push({
          icon: "update",
          title: "Mete ajou konsiltasyon",
          body: `Gen ${label}.`,
          href: `/app/consultations/${encodeURIComponent(e.id)}`,
        });
      } else if (event.type === "call:incoming") {
        const e = event as { consultationId: string; fromName?: string; callType?: string };
        push({
          icon: "call",
          title: `Apèl ${e.callType === "video" ? "videyo" : "vwa"} ap antre`,
          body: `${e.fromName ?? "Lòt moun nan"} ap rele w. Rejwenn apèl la nan konvèsasyon an.`,
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
          <h1 className="page-title">Notifikasyon</h1>
          <p className="muted small">Evènman nan sesyon k ap pase kounye a</p>
        </div>
        {notices.length > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={clear}>
            <Trash2 size={14} aria-hidden /> Efase
          </button>
        )}
      </div>

      {notices.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Bell size={26} />}
            title="Pa gen notifikasyon pou kounye a"
            description="Mete ajou konsiltasyon ou yo ak apèl k ap antre yo ap parèt isit an tan reyèl."
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
        Notifikasyon yo tanporè epi yo sèlman pou onglet sa a — pa gen done medikal ki kenbe sou aparèy ou a. Gade{" "}
        <Link href="/app/consultations" className="nowrap">
          konsiltasyon ou yo
        </Link>{" "}
        pou istwa konplè a.
      </p>
    </div>
  );
}
