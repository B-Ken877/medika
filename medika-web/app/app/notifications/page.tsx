"use client";

/**
 * In-app notification center (issue #36 upgrade).
 *
 * Previously this page held only live WS events in browser memory. Now it is
 * backed by the SERVER-PERSISTED history (GET /api/notifications) with
 * unread/read state, mark-read/mark-all-read, pagination — plus:
 *   - Web Push enable/disable (explicit user action; honest unsupported /
 *     blocked / denied / server-disabled states);
 *   - per-category preferences (consultations, messages, calls, wallet).
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
  Stethoscope,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { useSocket } from "@/lib/ws/socket-context";
import { ApiError } from "@/lib/api/client";
import {
  getNotificationPreferences,
  getNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  updateNotificationPreferences,
  type AppNotification,
  type NotificationPreferences,
} from "@/lib/api/endpoints";
import { EmptyState, ErrorAlert, SkeletonRows } from "@/components/ui/primitives";
import { relativeTime } from "@/lib/format";
import { enablePush, disablePush, probePushSupport, hasPushSubscription, type PushSupport } from "@/lib/push";
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

const SUPPORT_COPY: Record<PushSupport, string> = {
  supported: "",
  "unsupported-browser": "Navigatè sa a pa sipòte notifikasyon push.",
  "insecure-context": "Notifikasyon push bezwen yon koneksyon sekirize (HTTPS).",
  "no-service-worker": "Sèvis travay la pa disponib sou aparèy sa a.",
  "no-push-manager": "Navigatè a pa gen jesyon push.",
  denied: "Ou bloke notifikasyon yo nan paramèt navigatè a. Louvri paramèt yo pou pèmèt yo.",
  "server-disabled": "Sèvis push la pa konfigure kounye a — notifikasyon nan aplikasyon an ap kontinye mache.",
  // Issue #50 health signal: server/network failures are distinct from
  // browser limitations — the user (and any report) can tell them apart.
  "server-unreachable":
    "Nou pa t kapab tache ak sèvis notifikasyon yo. Verifye koneksyon ou, epi eseye ankò.",
  "registration-failed":
    "Sèvè a pa t aksepte enskripsyon notifikasyon an. Dekonekte epi konekte ankò, Lè sa a eseye ankò.",
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

  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [prefsBusy, setPrefsBusy] = useState(false);

  const [pushSupport] = useState<PushSupport>(() => probePushSupport());
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNotice, setPushNotice] = useState<string | null>(null);
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

  useEffect(() => {
    if (!token) return;
    getNotificationPreferences(token).then(setPrefs).catch(() => setPrefs(null));
    hasPushSubscription().then(setPushEnabled).catch(() => setPushEnabled(false));
  }, [token]);

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

  const togglePref = async (key: keyof NotificationPreferences) => {
    if (!token || !prefs || prefsBusy) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefsBusy(true);
    setPrefs(next); // optimistic
    try {
      setPrefs(await updateNotificationPreferences(token, { [key]: next[key] }));
    } catch {
      setPrefs(prefs); // revert on failure
    } finally {
      setPrefsBusy(false);
    }
  };

  const onEnablePush = async () => {
    if (!token || pushBusy) return;
    setPushBusy(true);
    setPushNotice(null);
    const state = await enablePush(token);
    setPushEnabled(state.enabled);
    if (!state.enabled && state.support !== "supported") {
      setPushNotice(SUPPORT_COPY[state.support]);
    }
    setPushBusy(false);
  };

  const onDisablePush = async () => {
    if (!token || pushBusy) return;
    setPushBusy(true);
    setPushNotice(null);
    await disablePush(token);
    setPushEnabled(false);
    setPushBusy(false);
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

      {/* Push subscriptions (explicit user action only) */}
      <section className="panel" aria-labelledby="push-title">
        <div className="panel-head">
          <h2 id="push-title" className="panel-title">
            Notifikasyon push
          </h2>
        </div>
        <div className="panel-row">
          <div className="row-body">
            <div className="row-title">
              <span>Alert sou aparèy ou a</span>
            </div>
            <div className="row-meta">
              {pushSupport === "supported"
                ? pushEnabled
                  ? "Ou ap resevwa notifikasyon push sou aparèy sa a."
                  : "Aktive notifikasyon push pou w konnen le gen yon mizajou, menm lè aplikasyon an fèmen."
                : SUPPORT_COPY[pushSupport]}
            </div>
          </div>
          <div className="row-actions">
            {pushSupport === "supported" && pushEnabled !== null && (
              <button
                className={`btn btn-sm ${pushEnabled ? "btn-secondary" : "btn-primary"}`}
                onClick={pushEnabled ? onDisablePush : onEnablePush}
                disabled={pushBusy}
              >
                {pushEnabled ? "Dezaktive" : "Aktive"}
              </button>
            )}
          </div>
        </div>
        {pushNotice && (
          <div className="alert alert-warning" role="status" style={{ margin: 12 }}>
            {pushNotice}
          </div>
        )}
      </section>

      {/* Category preferences */}
      {prefs && (
        <section className="panel" aria-labelledby="prefs-title">
          <div className="panel-head">
            <h2 id="prefs-title" className="panel-title">
              Preferans
            </h2>
          </div>
          {(["consultations", "messages", "calls", "wallet"] as const).map((key) => (
            <div className="panel-row" key={key}>
              <div className="row-body">
                <div className="row-title">
                  <span>{CATEGORY_LABEL[key]}</span>
                </div>
                <div className="row-meta">
                  {key === "wallet" && user?.role !== "doctor"
                    ? "Pou doktè yo."
                    : "Konnen lè evènman sa yo rive."}
                </div>
              </div>
              <div className="row-actions">
                <button
                  role="switch"
                  className="switch"
                  aria-checked={prefs[key]}
                  aria-label={CATEGORY_LABEL[key]}
                  onClick={() => togglePref(key)}
                  disabled={prefsBusy || (key === "wallet" && user?.role !== "doctor")}
                />
              </div>
            </div>
          ))}
          <p className="tiny muted" style={{ padding: "0 16px 12px" }}>
            Preferans yo sèlman kontròle VWA push la — istwa notifikasyon nan aplikasyon an konsève toujou.
          </p>
        </section>
      )}

      {/* Persisted history */}
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
