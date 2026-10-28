"use client";

/**
 * Voice/video consultation call — web counterpart of CallActivity.kt.
 *
 * The LiveKit access token is minted by the backend (POST /api/call/token)
 * which holds the LiveKit API key/secret server-side; the browser only ever
 * receives a short-lived room token, never the credentials.
 *
 * Signaling (ring / accepted / rejected / ended) rides the existing Medika
 * WebSocket, exactly like the Android app.
 *
 * Issue #45: the call page now hosts the consultation chat as an in-call
 * panel (InCallChat) so switching to chat NEVER unmounts this component —
 * the LiveKit room stays connected and local tracks keep running. Lifecycle
 * transitions go through the pure state machine in lib/call/phases.ts:
 *  - "Chat" / "Back to video" are pure view state, never call events;
 *  - "End call" remains the ONLY user action that disconnects the room and
 *    sends call:end signaling (kept visually distinct from Chat);
 *  - a real automatic reconnection (LiveKit) is surfaced as such; an
 *    unexpected disconnect lands on a failure screen with a REAL retry that
 *    re-fetches a fresh token — never a fake "reconnecting" message.
 */

import { Suspense, useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  MessageCircle,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Video as VideoIcon,
  VideoOff,
} from "lucide-react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type LocalTrackPublication,
} from "livekit-client";
import { useAuth } from "@/lib/auth/context";
import { useSocket } from "@/lib/ws/socket-context";
import { getCallToken } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import { Spinner } from "@/components/ui/primitives";
import InCallChat from "@/components/consultation/InCallChat";
import {
  INITIAL_CALL_STATE,
  chatControlVisible,
  reduceCallState,
} from "@/lib/call/phases";

type CallPhase = "connecting" | "active" | "ended" | "failed";

/** livekit-client classifies permission denials by constructor name — key on
 *  the NAME (stable across versions), never on the message text. */
function isPermissionError(err: unknown): boolean {
  return err instanceof Error && err.name === "MediaDevicePermissionDeniedError";
}

function CallScreen() {
  const { id } = useParams<{ id: string }>();
  const consultationId = String(id ?? "");
  const params = useSearchParams();
  const mode = params.get("mode") === "voice" ? "voice" : "video";
  const { token, user } = useAuth();
  const { socket } = useSocket();
  const router = useRouter();

  const [state, dispatch] = useReducer(reduceCallState, INITIAL_CALL_STATE);
  const [statusText, setStatusText] = useState("N ap konekte ak apèl la...");
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(mode === "video");
  const [chatOpen, setChatOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const remoteVideoRef = useRef<HTMLDivElement>(null);
  const endedRef = useRef(false);
  /** call:start is signaled ONCE per page session — retries never re-ring. */
  const startCallSentRef = useRef(false);

  // ── Teardown (the ONLY room-disconnecting path) ──────────────────────────
  const endCall = useCallback(
    (reason?: string) => {
      if (endedRef.current) return;
      endedRef.current = true;
      dispatch({ type: "hang-up" });
      socket?.endCall(consultationId);
      const room = roomRef.current;
      roomRef.current = null;
      try {
        room?.disconnect();
      } catch {
        // ignore
      }
      setStatusText(reason ?? "Apèl la fini.");
      setTimeout(() => router.replace(`/app/consultations/${encodeURIComponent(consultationId)}`), 900);
    },
    [socket, consultationId, router],
  );

  // ── Room wiring + connect (re-runs on explicit retry via `attempt`) ──────
  useEffect(() => {
    if (!token || !consultationId) return;
    let disposed = false;
    endedRef.current = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const attachRemote = (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video && remoteVideoRef.current) {
        const el = track.attach() as HTMLVideoElement;
        el.style.width = "100%";
        el.style.height = "100%";
        el.style.objectFit = "contain";
        const host = remoteVideoRef.current;
        host.innerHTML = "";
        host.appendChild(el);
      }
    };

    room
      .on(RoomEvent.TrackSubscribed, (track) => {
        attachRemote(track);
        dispatch({ type: "connected" });
        setStatusText("Apèl la ap pase");
      })
      .on(RoomEvent.ParticipantConnected, () => {
        setStatusText("Lòt moun nan konekte");
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        setStatusText("Lòt moun nan kite apèl la");
      })
      .on(RoomEvent.Reconnecting, () => {
        // LiveKit IS automatically retrying — this label is TRUE.
        dispatch({ type: "reconnecting" });
        setStatusText("Rezo a entèwopti. N ap rekonekte otomatikman...");
      })
      .on(RoomEvent.Reconnected, () => {
        dispatch({ type: "reconnected" });
        setStatusText("Koneksyon an retabli.");
      })
      .on(RoomEvent.Disconnected, () => {
        if (endedRef.current || disposed) return;
        // Unexpected drop — surface a REAL retry; never claim reconnection.
        dispatch({ type: "unexpected-disconnect" });
        setStatusText("Koneksyon an koupe.");
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        try {
          track.detach().forEach((el) => el.remove());
        } catch {
          // ignore
        }
        if (remoteVideoRef.current) remoteVideoRef.current.innerHTML = "";
      });

    (async () => {
      try {
        const res = await getCallToken(token, consultationId, mode === "video");
        if (disposed) return;

        // Notify the partner ONCE per session (retries never re-ring).
        if (!startCallSentRef.current) {
          startCallSentRef.current = true;
          socket?.startCall(consultationId, user?.name ?? "Apèl", mode, res.roomName);
        }

        // Mixed-content guard: when this app is served over HTTPS, an
        // insecure ws:// LiveKit URL would be blocked by the browser.
        // LiveKit serves TLS on the same port, so upgrade the scheme.
        let url = res.url;
        if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("ws://")) {
          url = url.replace(/^ws:/, "wss:");
        }

        await room.connect(url, res.token);
        if (disposed) return;
        setStatusText("N ap tann lòt moun nan konekte...");

        // Publish local mic (and camera for video mode). Permission denials
        // get their own user-facing state instead of a generic failure.
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          if (mode === "video") {
            await room.localParticipant.setCameraEnabled(true);
          }
        } catch (mediaErr) {
          if (disposed) return;
          if (isPermissionError(mediaErr)) {
            dispatch({ type: "connect-failed", kind: "permission" });
            setStatusText(
              "Nou pa gen pèmisyon mikwo/kamera. Oktroye pèmisyon yo nan navigatè a, apre sa eseye ankò.",
            );
            return;
          }
          throw mediaErr;
        }

        if (localVideoRef.current) {
          const localPub = room.localParticipant.getTrackPublication(Track.Source.Camera) as
            | LocalTrackPublication
            | undefined;
          const el = localPub?.track?.attach() as HTMLVideoElement | undefined;
          if (el) {
            el.style.width = "100%";
            el.style.height = "100%";
            el.style.objectFit = "cover";
            const host = localVideoRef.current;
            host.innerHTML = "";
            host.appendChild(el);
          }
        }
        if (mode === "voice" && remoteVideoRef.current) {
          remoteVideoRef.current.style.display = "none";
        }
      } catch (err) {
        if (disposed) return;
        dispatch({ type: "connect-failed", kind: "generic" });
        setError(
          err instanceof ApiError
            ? err.message
            : "Nou pa rive jwenn sèvis apèl la. Tanpri, eseye ankò pita.",
        );
      }
    })();

    return () => {
      disposed = true;
      if (!endedRef.current) {
        endedRef.current = true;
        try {
          room.disconnect();
        } catch {
          // ignore
        }
      }
      roomRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, consultationId, mode, attempt]);

  // React to partner hang-up over the Medika WS.
  useEffect(() => {
    if (!socket) return;
    return socket.onEvent((event) => {
      if (
        (event.type === "call:ended" || event.type === "call:rejected") &&
        (event as { consultationId?: string }).consultationId === consultationId
      ) {
        dispatch({ type: "partner-hung-up" });
        endCall("Lòt moun nan rakroche.");
      }
    });
  }, [socket, consultationId, endCall]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setMicrophoneEnabled(!micOn);
    setMicOn(!micOn);
  };

  const toggleCam = async () => {
    const room = roomRef.current;
    if (!room) return;
    await room.localParticipant.setCameraEnabled(!camOn);
    setCamOn(!camOn);
  };

  /** REAL retry: reset the failure screen and rebuild the room with a fresh
   *  token (the old token may be expired — never reuse it blindly). */
  const retry = useCallback(() => {
    if (!state.canRetry || state.phase !== "failed") return;
    setError(null);
    setStatusText("N ap konekte ak apèl la...");
    dispatch({ type: "retry-requested" });
    setAttempt((a) => a + 1);
  }, [state.canRetry, state.phase]);

  // View-only toggle — touches NO room state; the panel opens over the call.
  const openChat = useCallback(() => setChatOpen(true), []);
  const closeChat = useCallback(() => setChatOpen(false), []);
  const endFromChat = useCallback(() => {
    setChatOpen(false);
    endCall();
  }, [endCall]);

  const showChatControl = chatControlVisible(state.phase) && !chatOpen;

  return (
    <div
      className={`call-shell${chatOpen ? " chat-open" : ""}`}
      role="dialog"
      aria-label={`Apèl ${mode === "video" ? "videyo" : "vwa"} ap pase`}
    >
      <div className="call-videos">
        <div className="call-remote" ref={remoteVideoRef} aria-hidden={mode === "voice"} />
        {mode === "video" && <div className="call-local" ref={localVideoRef} aria-label="Kamera w" />}
        <div className="call-status" role="status" aria-live="polite">
          {state.phase === "failed"
            ? (error ?? statusText)
            : state.phase === "ended"
              ? statusText
              : statusText}
          {(state.phase === "failed" || state.phase === "ended") && (
            <div style={{ marginTop: 6 }}>
              {state.phase === "failed" && state.canRetry && (
                <>
                  <button className="btn btn-primary btn-sm" onClick={retry}>
                    Eseye ankò
                  </button>{" "}
                </>
              )}
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => router.replace(`/app/consultations/${encodeURIComponent(consultationId)}`)}
              >
                Retounen sou konvèsasyon an
              </button>
            </div>
          )}
        </div>
      </div>

      {state.phase === "connecting" && !chatOpen && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 4 }}>
          <div style={{ textAlign: "center" }}>
            <Phone size={34} style={{ margin: "0 auto 10px" }} aria-hidden />
            <Spinner label={statusText} />
          </div>
        </div>
      )}

      <div className="call-bar">
        <button className={`call-btn ${micOn ? "" : "muted"}`} onClick={toggleMic} aria-label={micOn ? "Etenn mikwo a" : "Aktive mikwo a"} title={micOn ? "Etenn mikwo a" : "Aktive mikwo a"}>
          {micOn ? <Mic size={22} /> : <MicOff size={22} />}
        </button>
        {mode === "video" && (
          <button className={`call-btn ${camOn ? "" : "muted"}`} onClick={toggleCam} aria-label={camOn ? "Etenn kamera" : "Aktive kamera"} title={camOn ? "Etenn kamera" : "Aktive kamera"}>
            {camOn ? <VideoIcon size={22} /> : <VideoOff size={22} />}
          </button>
        )}
        {/* Chat switch — pure view state; never disconnects the room. */}
        {showChatControl && (
          <button
            className="call-btn chat"
            onClick={openChat}
            aria-label="Ouvri chat pandan apèl la"
            title="Ouvri chat pandan apèl la"
          >
            <MessageCircle size={22} />
          </button>
        )}
        <button className="call-btn end" onClick={() => endCall()} aria-label="Fini apèl la" title="Fini apèl la">
          <PhoneOff size={22} />
        </button>
      </div>

      {/* In-call chat overlay — mounted ONLY while open; closing it unmounts
          the panel but never the call page, so the room stays connected. */}
      {chatOpen && (
        <InCallChat
          consultationId={consultationId}
          token={token}
          user={user ? { id: user.id, name: user.name, role: user.role } : null}
          socket={socket}
          onClose={closeChat}
          onEndCall={endFromChat}
        />
      )}
    </div>
  );
}

export default function CallPage() {
  return (
    <Suspense fallback={<Spinner label="N ap chaje apèl la..." />}>
      <CallScreen />
    </Suspense>
  );
}

export type { CallPhase };
