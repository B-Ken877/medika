"use client";

/**
 * PaymentRequestWatcher — patient-only realtime host for the agent-raised
 * payment popup (migration 017, owner brief). Mounted in the app shell for
 * every patient session:
 *  - polls GET /api/assist/payment-requests/current every 8s (source of
 *    truth — survives reloads and closed tabs);
 *  - refreshes instantly on any WS `payment:*` event (request raised /
 *    cancelled / confirmed by the agent's flow);
 *  - renders the MonCash-style popup while a request is pending, and the
 *    confirmation state after paying (no redirect — the member stays on the
 *    call; the consultation shows up on their dashboard).
 *
 * Deliberate UX rule: dismissing the popup hides it for THAT request only —
 * the agent can see "still pending" and cancel + re-send, which pops a NEW
 * request id and therefore reopens the popup. Accidental dismissals never
 * strand the agent.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import { useSocket } from "@/lib/ws/socket-context";
import { ApiError } from "@/lib/api/client";
import { getMyPaymentRequest, confirmMyPaymentRequest, type MemberPaymentRequest } from "@/lib/api/endpoints";
import { MemberPaymentModal } from "./MemberPaymentModal";

export function PaymentRequestWatcher() {
  const { token, user } = useAuth();
  const { socket } = useSocket();
  const [request, setRequest] = useState<MemberPaymentRequest | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPatient = user?.role === "patient";
  const latestId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token || !isPatient) return;
    try {
      const res = await getMyPaymentRequest(token);
      if (res && typeof res === "object" && "status" in res && res.status === "none") {
        setRequest(null);
      } else {
        setRequest(res as MemberPaymentRequest);
      }
    } catch {
      // The popup is best-effort; the poll retries and the agent still sees
      // the authoritative state on their side.
    }
  }, [token, isPatient]);

  useEffect(() => {
    if (!isPatient) return;
    void refresh();
    const t = setInterval(() => { void refresh(); }, 8000);
    return () => clearInterval(t);
  }, [refresh, isPatient]);

  useEffect(() => {
    if (!socket || !isPatient) return;
    return socket.onEvent((event: { type?: string }) => {
      const type = (event as { type?: string }).type;
      if (type?.startsWith("payment:")) void refresh();
    });
  }, [socket, refresh, isPatient]);

  // Reset the dismissal when a DIFFERENT request arrives (agent re-sent).
  useEffect(() => {
    if (request?.id && request.id !== latestId.current) {
      latestId.current = request.id;
      setDismissedId(null);
      setError(null);
    }
  }, [request?.id]);

  if (!isPatient || !token) return null;

  const confirm = async (phoneNumber: string, pin: string) => {
    if (!request) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await confirmMyPaymentRequest(token, request.id, { phoneNumber, pin });
      if (res.success) {
        setRequest({ ...request, status: "paid", consultationId: res.consultationId ?? request.consultationId });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Peman an pa reyisi — eseye ankò.");
    } finally {
      setSubmitting(false);
      void refresh();
    }
  };

  if (request?.status === "paid") {
    return <MemberPaymentModal request={request} done onDismiss={() => setRequest(null)} />;
  }
  if (request?.status === "pending" && request.id !== dismissedId) {
    return (
      <MemberPaymentModal
        request={request}
        submitting={submitting}
        error={error}
        onConfirm={confirm}
        onDismiss={() => setDismissedId(request.id)}
      />
    );
  }
  return null;
}
