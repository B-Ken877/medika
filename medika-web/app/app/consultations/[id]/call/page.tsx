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
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
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

type CallPhase = "connecting" | "active" | "ended" | "failed";

function CallScreen() {
  const { id } = useParams<{ id: string }>();
  const consultationId = String(id ?? "");
  const params = useSearchParams();
  const mode = params.get("mode") === "voice" ? "voice" : "video";
  const { token, user } = useAuth();
  const { socket } = useSocket();
  const router = useRouter();

  const [phase, setPhase] = useState<CallPhase>("connecting");
  const [statusText, setStatusText] = useState("Connexion à l'appel…");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(mode === "video");
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const remoteVideoRef = useRef<HTMLDivElement>(null);
  const endedRef = useRef(false);
  const connectedOnceRef = useRef(false);

  // ── Teardown ──────────────────────────────────────────────────────────────
  const endCall = useCallback(
    async (reason?: string) => {
      if (endedRef.current) return;
      endedRef.current = true;
      socket?.endCall(consultationId);
      const room = roomRef.current;
      roomRef.current = null;
      try {
        if (room) {
          room.disconnect();
        }
      } catch {
        // ignore
      }
      setPhase("ended");
      setStatusText(reason ?? "Appel terminé.");
      setTimeout(() => router.replace(`/app/consultations/${encodeURIComponent(consultationId)}`), 900);
    },
    [socket, consultationId, router],
  );

  // ── Setup ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !consultationId || roomRef.current) return;
    let disposed = false;
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
        connectedOnceRef.current = true;
        setPhase("active");
        setStatusText("Appel en cours");
      })
      .on(RoomEvent.ParticipantConnected, () => {
        setStatusText("Votre interlocuteur est connecté");
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        setStatusText("Votre interlocuteur a quitté l'appel");
      })
      .on(RoomEvent.Disconnected, () => {
        // Only treat as a lost call if the connection had actually been
        // established — a failed initial connect is handled by the catch
        // below (which shows the error screen instead of bouncing back).
        if (!endedRef.current && connectedOnceRef.current) endCall("Connexion perdue.");
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

        // Notify the partner via the Medika WS channel (same as Android).
        socket?.startCall(consultationId, user?.name ?? "Appel", mode, res.roomName);

        // Mixed-content guard: when this app is served over HTTPS, an
        // insecure ws:// LiveKit URL would be blocked by the browser.
        // LiveKit serves TLS on the same port, so upgrade the scheme.
        let url = res.url;
        if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("ws://")) {
          url = url.replace(/^ws:/, "wss:");
        }

        await room.connect(url, res.token);
        if (disposed) return;
        connectedOnceRef.current = true;
        setStatusText("En attente de votre interlocuteur…");

        // Publish local mic (and camera for video mode).
        await room.localParticipant.setMicrophoneEnabled(true);
        if (mode === "video") {
          await room.localParticipant.setCameraEnabled(true);
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
        endedRef.current = true;
        setPhase("failed");
        setError(
          err instanceof ApiError
            ? err.message
            : "Impossible de joindre le serveur d'appel. Réessayez plus tard.",
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, consultationId, mode]);

  // React to partner hang-up over the Medika WS.
  useEffect(() => {
    if (!socket) return;
    return socket.onEvent((event) => {
      if (
        (event.type === "call:ended" || event.type === "call:rejected") &&
        (event as { consultationId?: string }).consultationId === consultationId
      ) {
        endCall("Votre interlocuteur a raccroché.");
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

  return (
    <div className="call-shell" role="dialog" aria-label={`Appel ${mode === "video" ? "vidéo" : "vocal"} en cours`}>
      <div className="call-videos">
        <div className="call-remote" ref={remoteVideoRef} aria-hidden={mode === "voice"} />
        {mode === "video" && <div className="call-local" ref={localVideoRef} aria-label="Votre caméra" />}
        <div className="call-status" role="status" aria-live="polite">
          {phase === "failed" ? (error ?? "Échec de l'appel") : statusText}
          {phase === "failed" && (
            <div style={{ marginTop: 6 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => router.replace(`/app/consultations/${encodeURIComponent(consultationId)}`)}
              >
                Retour à la conversation
              </button>
            </div>
          )}
        </div>
      </div>

      {phase === "connecting" && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", zIndex: 4 }}>
          <div style={{ textAlign: "center" }}>
            <Phone size={34} style={{ margin: "0 auto 10px" }} aria-hidden />
            <Spinner label={statusText} />
          </div>
        </div>
      )}

      <div className="call-bar">
        <button className={`call-btn ${micOn ? "" : "muted"}`} onClick={toggleMic} aria-label={micOn ? "Couper le micro" : "Activer le micro"} title={micOn ? "Couper le micro" : "Activer le micro"}>
          {micOn ? <Mic size={22} /> : <MicOff size={22} />}
        </button>
        {mode === "video" && (
          <button className={`call-btn ${camOn ? "" : "muted"}`} onClick={toggleCam} aria-label={camOn ? "Couper la caméra" : "Activer la caméra"} title={camOn ? "Couper la caméra" : "Activer la caméra"}>
            {camOn ? <VideoIcon size={22} /> : <VideoOff size={22} />}
          </button>
        )}
        <button className="call-btn end" onClick={() => endCall()} aria-label="Raccrocher" title="Raccrocher">
          <PhoneOff size={22} />
        </button>
      </div>
    </div>
  );
}

export default function CallPage() {
  return (
    <Suspense fallback={<Spinner label="Chargement de l'appel…" />}>
      <CallScreen />
    </Suspense>
  );
}
