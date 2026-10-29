"use client";

/**
 * Server-authoritative unread notification count for the header bell
 * (issue #72, Workstream A).
 *
 * Root cause it fixes: the bell was a bare link — NO component anywhere
 * fetched or subscribed to unread state, so a new message never changed the
 * bell (GET /api/notifications was only called by the notifications page).
 *
 * Design rules (per the issue):
 *  - the durable server table is the ONLY source of truth: every UI update
 *    path goes through GET /api/notifications/unread (owner-scoped count);
 *  - WS events (message:new, consultation:new/updated) and socket
 *    reconnections only PROMPT a debounced refetch — they never set the
 *    count themselves;
 *  - a slow poll (60s) plus a refetch when the tab becomes visible cover
 *    missed events across refreshes, reconnects and other sessions/devices;
 *  - Workstream B heal: while authenticated, an EXISTING browser push
 *    subscription is silently re-registered (idempotent server upsert) so
 *    pushsubscriptionchange renewals and earlier failed registrations reach
 *    the server again. This NEVER requests permission and never prompts.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth/context";
import { useSocket } from "@/lib/ws/socket-context";
import { getUnreadNotificationCount } from "@/lib/api/endpoints";
import { syncExistingPushSubscription } from "@/lib/push";

const REFETCH_DEBOUNCE_MS = 400;
const POLL_INTERVAL_MS = 60_000;

interface UnreadContextValue {
  /** Durable server unread count (0 while anonymous). */
  unread: number;
  /** Force a refetch from the server (e.g. after mark-read actions). */
  refresh: () => void;
}

const UnreadContext = createContext<UnreadContextValue | null>(null);

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { token, status: authStatus } = useAuth();
  const { socket, status: wsStatus } = useSocket();
  const [unread, setUnread] = useState(0);
  const inFlight = useRef(false);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    if (!token || inFlight.current) {
      dirty.current = true;
      return;
    }
    inFlight.current = true;
    try {
      const { unread: n } = await getUnreadNotificationCount(token);
      setUnread(n);
    } catch {
      // Never break the shell over a count refresh; the poll/reconnect
      // paths will retry. Stale count is preferable to a flashing zero.
    } finally {
      inFlight.current = false;
      if (dirty.current) {
        dirty.current = false;
        refetch();
      }
    }
  }, [token]);

  const refresh = useCallback(() => {
    // Debounced so bursts of WS events (long chat send/receive) collapse
    // into a single server call.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void refetch();
    }, REFETCH_DEBOUNCE_MS);
  }, [refetch]);

  // Initial load (and re-load on re-auth, e.g. login in another tab).
  useEffect(() => {
    if (authStatus !== "authenticated" || !token) {
      setUnread(0);
      return;
    }
    void refetch();
  }, [authStatus, token, refetch]);

  // WS events PROMPT a refetch — the server count stays the source of truth.
  useEffect(() => {
    if (!socket || !token) return;
    return socket.onEvent((event) => {
      if (
        event.type === "message:new" ||
        event.type === "consultation:new" ||
        event.type === "consultation:updated"
      ) {
        refresh();
      }
    });
  }, [socket, token, refresh]);

  // Reconnect: any catch-up events fire their own prompts, but a fresh
  // refetch makes the badge correct even when nothing was missed.
  useEffect(() => {
    if (wsStatus === "open" && token) void refetch();
  }, [wsStatus, token, refetch]);

  // Background tab -> foreground (covers laptop sleep, long-lived tabs).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && token) void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [token, refetch]);

  // Slow poll safety net for missed WS events (server truth, tiny query).
  useEffect(() => {
    if (!token) return;
    const t = setInterval(() => void refetch(), POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [token, refetch]);

  // Workstream B heal: silently re-register an existing browser push
  // subscription (never prompts; no-op when unsupported or unsubscribed).
  useEffect(() => {
    if (authStatus !== "authenticated" || !token) return;
    void syncExistingPushSubscription(token);
  }, [authStatus, token]);

  const value = useMemo(() => ({ unread, refresh }), [unread, refresh]);
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export function useUnread(): UnreadContextValue {
  const ctx = useContext(UnreadContext);
  // Shell-safe default (matches SocketProvider's build-time safety): the
  // provider is mounted inside the authenticated shell; outside it the
  // count is simply 0 and refresh is a no-op.
  return ctx ?? { unread: 0, refresh: () => undefined };
}
