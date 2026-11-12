"use client";

/**
 * In-app notification center (issue #36 upgrade; restructured per owner
 * feedback: "notifications first, settings on a specific page").
 *
 * This page is now a pure INBOX:
 *   - SERVER-PERSISTED history (GET /api/notifications) with unread/read
 *     state, mark-read/mark-all-read and pagination — always FIRST on the
 *     page;
 *   - all configuration (device push subscription + category preferences)
 *     moved to the dedicated /app/settings/notifications page, reachable
 *     from the header action button below.
 *
 * Live WS events still stream in as a supplement while the page is open; the
 * server record is the source of truth. No medical data is ever displayed
 * here — notification copy is generic by server design.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  BellRing,
  CalendarCheck,
  CheckCheck,
  Phone,
  Settings,
  Stethoscope,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { useSocket } from "@/lib/ws/socket-context";
import { ApiError } from "@/lib/api/client";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  type AppNotification,
} from "@/lib/api/endpoints";
import { EmptyState, ErrorAlert, SkeletonRows } from "@/components/ui/primitives";
import { relativeTime } from "@/lib/format";
import { useUnread } from "@/components/notifications/UnreadProvider";

const CATEGORY_ICON = {
  consultations: CalendarCheck,
  messages: Stethoscope,
  calls: Phone,
  wallet: Wallet,
} as const;

const CATEGORY_LABEL: Record<string, string> = {
  consultations: "Konsiltasyon",
  messages: "Mesaj",
  calls: "Apèl",
  wallet: "Revni",
};

export default function NotificationsPage() {
  const { token, user } = useAuth();
  const { socket } = useSocket();
  const { refresh: refreshBellCount } = useUnread();
  const router = useRouter();

  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [liveCount, setLiveCount] = useState(0);

  const beforeRef = useRef<number | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    const controller = new AbortController();
    getNotifications(token, { signal: controller.signal })
      .then((res) => {
        setItems(res.notifications);
        setUnread(res.unread);
        setHasMore(res.hasMore);
        beforeRef.current = res.notifications.length
          ? res.notifications[res.notifications.length - 1].id
          : null;
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err);
        setItems([]);
      });
    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    const cleanup = load();
    return () => cleanup?.();
  }, [load]);

  // Live events supplement the persisted history while the page is open.
  // Issue #72: message:new MUST also refresh — a new chat message creates a
  // durable notification, and an open notification center that ignored it
  // was the reported "new notification never shows up" behavior.
  useEffect(() => {
    if (!socket || !user) return;
    return socket.onEvent((event) => {
      if (
        event.type === "consultation:new" ||
        event.type === "consultation:updated" ||
        event.type === "message:new"
      ) {
        setLiveCount((n) => n + 1);
        load(); // refresh the persisted view (server is the source of truth)
      }
    });
  }, [socket, user, load]);

  const loadMore = async () => {
    if (!token || loadingMore || !hasMore || beforeRef.current == null) return;
    setLoadingMore(true);
    try {
      const res = await getNotifications(token, { before: beforeRef.current });
      setItems((prev) => [...(prev ?? []), ...res.notifications]);
      setHasMore(res.hasMore);
      beforeRef.current = res.notifications.length
        ? res.notifications[res.notifications.length - 1].id
        : null;
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  const openNotification = (n: AppNotification) => {
    if (!n.read && token) {
      markNotificationsRead(token, [n.id])
        .then(() => refreshBellCount()) // keep the header bell in sync (issue #72)
        .catch(() => undefined);
      setUnread((u) => Math.max(0, u - 1));
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? prev);
    }
    if (n.url) router.push(n.url);
  };

  const markAll = async () => {
    if (!token) return;
    try {
      await markAllNotificationsRead(token);
      setUnread(0);
      setItems((prev) => prev?.map((x) => ({ ...x, read: true })) ?? prev);
      refreshBellCount(); // header bell clears with the page (issue #72)
    } catch {
      /* keep the current view; retry stays available */
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">Notifikasyon</h1>
          <p className="page-desc">
            {unread > 0 ? `${unread} notifikasyon pa li.` : "Tout notifikasyon ou yo isit."}
          </p>
        </div>
        <div className="page-head-actions">
          {/* Settings live on their own dedicated page (owner request) — the
              notification center itself stays a pure inbox. */}
          <Link href="/app/settings/notifications" className="btn btn-secondary btn-sm">
            <Settings size={14} aria-hidden /> Paramèt
          </Link>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={items === null}>
            <BellRing size={14} aria-hidden /> Refrèchi
          </button>
          {unread > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={markAll}>
              <CheckCheck size={14} aria-hidden /> Make tout li
            </button>
          )}
        </div>
      </div>

      <ErrorAlert
        error={
          error == null
            ? null
            : new ApiError("server", 0, "Nou pa t kapab chaje notifikasyon yo. Tanpri, eseye ankò.")
        }
        onRetry={load}
      />

      {/* Persisted history — the FIRST thing on the page (owner request:
          settings used to sit above it). */}
      <section className="panel" aria-labelledby="history-title">
        <div className="panel-head">
          <h2 id="history-title" className="panel-title">
            Istorik
          </h2>
          {liveCount > 0 && (
            <span className="badge badge-green" role="status">
              {liveCount} evènman an dirèk
            </span>
          )}
        </div>

        {items === null && !error && (
          <div style={{ padding: 24 }}>
            <SkeletonRows count={4} />
          </div>
        )}

        {items !== null && items.length === 0 && !error && (
          <EmptyState
            icon={<Bell size={24} />}
            title="Pa gen notifikasyon pou kounye a"
            description="Nou ap fè w konnen le gen yon mizajou enpòtan."
          />
        )}

        {items?.map((n) => {
          const Icon = CATEGORY_ICON[n.category as keyof typeof CATEGORY_ICON] ?? Bell;
          return (
            <button
              key={n.id}
              className={`panel-row notif-row${n.read ? "" : " unread"}`}
              onClick={() => openNotification(n)}
              style={{ textAlign: "left", width: "100%", background: "inherit", cursor: n.url ? "pointer" : "default" }}
            >
              <span className="brand-mark" aria-hidden>
                <Icon size={16} />
              </span>
              <div className="row-body">
                <div className="row-title">
                  <span>{n.title}</span>
                  {!n.read && <span className="badge badge-green">Nouvo</span>}
                </div>
                <div className="row-sub">{n.body}</div>
                <div className="row-meta">
                  {CATEGORY_LABEL[n.category] ?? n.category} ·{" "}
                  {n.created_at ? relativeTime(n.created_at) : ""}
                </div>
              </div>
            </button>
          );
        })}

        {hasMore && (
          <div style={{ padding: 12, display: "flex", justifyContent: "center" }}>
            <button className="btn btn-secondary btn-sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "N ap chaje…" : "Chaje plis"}
            </button>
          </div>
        )}
      </section>

      <p className="tiny muted text-center">
        Notifikasyon yo sèvi avèk kopi jenerik — pa gen done medikal ki kenbe sou aparèy ou a. Gade{" "}
        <Link href="/app/profile">pwofil ou</Link> pou enfòmasyon prive.
      </p>
    </div>
  );
}
