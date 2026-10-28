"use client";

/**
 * ZEGOCLOUD call session (issue #62) — the ZEGO implementation of the same
 * room-session contract the call page already drives with livekit-client.
 *
 * The existing call page owns EVERYTHING provider-agnostic: the pure phases
 * state machine (lib/call/phases.ts), the calm eligibility wait, the Medika
 * WebSocket signaling (call:start / call:ended), the in-call chat panel and
 * all UI. This module ONLY bridges the ZEGO Express Web SDK to that machine:
 *
 *  - connect(): loginRoom → createZegoStream (mic + optional camera) →
 *    startPublishingStream. Remote media arrives via roomStreamUpdate(ADD) →
 *    startPlayingStream, surfaced as onRemoteStream (the page attaches it —
 *    the "connected" phase fires exactly like LiveKit's TrackSubscribed).
 *  - Room reasons map onto the SAME reducer events: RECONNECTING /
 *    RECONNECTED are TRUE automatic reconnections (honest labels), a
 *    DISCONNECTED or KICKOUT we did not cause is an unexpected-disconnect
 *    with a REAL retry, and initial failures are connect-failed.
 *  - tokenWillExpire → onTokenWillExpire: the page re-POSTs /api/call/token
 *    (every renewal re-runs the server authorization funnel) and we hand the
 *    fresh token to engine.renewToken.
 *  - toggleMic/toggleCam touch ONLY local tracks — switching panels or
 *    toggling controls can never tear the session down.
 *  - disconnect() is the ONLY teardown path (hang-up / partner hang-up /
 *    page unmount), mirroring the LiveKit room.disconnect() usage.
 *
 * SDK facts verified against the official package (zego-express-engine-webrtc
 * 3.13.0 definitions + bundle): constructor (appID: number, server: string),
 * loginRoom(roomID, token, {userID, userName}, {userUpdate}), createZegoStream,
 * startPublishingStream(streamID, stream), startPlayingStream(streamID) →
 * Promise<MediaStream>, roomStateChanged(roomID, reason, errorCode, data)
 * with reasons LOGINING/LOGINED/LOGOUT/DISCONNECTED/RECONNECTING/RECONNECTED/
 * KICKOUT, renewToken(token, roomID?), logoutRoom, destroyEngine.
 *
 * The engine is imported DYNAMICALLY: it is browser-only and must never
 * execute during SSR. A minimal structural type documents the exact surface
 * we rely on (skipLibCheck is on; we do not import the package types).
 */

import type { CallTokenResponse } from "@/lib/api/types";

/** Minimal structural surface of the ZEGO engine we use. */
interface ZegoEngineLike {
  on(event: string, cb: (...args: unknown[]) => void): void;
  loginRoom(
    roomID: string,
    token: string,
    user: { userID: string; userName: string },
    config: { userUpdate: boolean },
  ): Promise<unknown>;
  logoutRoom(roomID?: string): Promise<unknown>;
  createZegoStream(options: {
    camera?: { video?: boolean | Record<string, unknown>; audio?: boolean | Record<string, unknown> };
  }): Promise<MediaStream>;
  startPublishingStream(streamID: string, localStream: MediaStream): boolean | void;
  stopPublishingStream(streamID: string): void;
  startPlayingStream(streamID: string): Promise<MediaStream>;
  stopPlayingStream(streamID: string): void;
  destroyStream(localStream: MediaStream): void;
  muteMicrophone(mute: boolean): boolean;
  renewToken(token: string, roomID?: string): boolean;
  destroyEngine(): void;
}

type ZegoEngineCtor = new (appID: number, server: string) => ZegoEngineLike;

export interface ZegoSessionCallbacks {
  /** Remote media is live (or gone) — page attaches/detaches and flips phase. */
  onRemoteStream(stream: MediaStream | null): void;
  /** TRUE automatic reconnection started (ZEGO roomStateChanged RECONNECTING). */
  onReconnecting(): void;
  /** Automatic reconnection succeeded (RECONNECTED). */
  onReconnected(): void;
  /** Room dropped or we were kicked without the user hanging up. */
  onUnexpectedDisconnect(): void;
  /** Initial connect failed; `kind: "permission"` = mic/cam denial. */
  onConnectFailed(kind: "permission" | "generic"): void;
  /** Partner published a stream into the room (status text only). */
  onPartnerJoined(): void;
  onPartnerLeft(): void;
  /** Token is about to expire — page re-authorizes server-side and returns
   *  the fresh token (or undefined on failure; no silent extension). */
  onTokenWillExpire(): Promise<string | undefined | void>;
}

export interface ZegoSessionUser {
  id: string;
  name: string;
}

/** Mirrors the server's ZEGO token TTL (issue #62) — renew before expiry. */
const RENEW_MARGIN_MS = 60_000;

export class ZegoCallSession {
  private engine: ZegoEngineLike | null = null;
  private roomName = "";
  private myStreamId = "";
  private remoteStreamId: string | null = null;
  private localStream: MediaStream | null = null;
  private ended = false;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private connectedOnce = false;

  /** The local preview stream (page renders it into its local video host). */
  get localMediaStream(): MediaStream | null {
    return this.localStream;
  }

  async connect(
    tokenResp: CallTokenResponse,
    user: ZegoSessionUser,
    mode: "video" | "voice",
    cb: ZegoSessionCallbacks,
  ): Promise<void> {
    if (tokenResp.provider !== "zego" || !tokenResp.appId || !tokenResp.streamId) {
      throw new Error("ZegoCallSession requires a zego provider token response");
    }
    const mod = (await import("zego-express-engine-webrtc")) as unknown as {
      ZegoExpressEngine: ZegoEngineCtor;
    };
    const engine = new mod.ZegoExpressEngine(tokenResp.appId, tokenResp.url);
    this.engine = engine;
    this.roomName = tokenResp.roomName;
    this.myStreamId = tokenResp.streamId;

    engine.on("roomStateChanged", (...args: unknown[]) => {
      if (this.ended) return;
      const [roomID, reason] = args as [string, string];
      if (roomID && roomID !== this.roomName) return;
      if (reason === "RECONNECTING") {
        // ZEGO IS automatically retrying — the label is TRUE (same contract
        // as LiveKit RoomEvent.Reconnecting).
        cb.onReconnecting();
      } else if (reason === "RECONNECTED") {
        cb.onReconnected();
      } else if (reason === "KICKOUT" || reason === "DISCONNECTED") {
        cb.onUnexpectedDisconnect();
      }
      // LOGINING / LOGINED / LOGOUT need no UI of their own.
    });

    engine.on("roomStreamUpdate", (...args: unknown[]) => {
      if (this.ended) return;
      const [roomID, updateType, streamList] = args as [
        string,
        string,
        Array<{ streamID: string }>,
      ];
      if (roomID && roomID !== this.roomName) return;
      const others = (streamList ?? []).filter((s) => s.streamID && s.streamID !== this.myStreamId);
      if (updateType === "ADD") {
        const remote = others[0];
        if (!remote) return;
        void (async () => {
          try {
            const stream = await engine.startPlayingStream(remote.streamID);
            if (this.ended) return;
            this.remoteStreamId = remote.streamID;
            cb.onRemoteStream(stream);
          } catch {
            if (!this.ended) cb.onConnectFailed("generic");
          }
        })();
      } else if (updateType === "DELETE") {
        for (const s of others) {
          try {
            engine.stopPlayingStream(s.streamID);
          } catch {
            // ignore
          }
        }
        this.remoteStreamId = null;
        cb.onRemoteStream(null);
        cb.onPartnerLeft();
      }
    });

    engine.on("publisherStateUpdate", (...args: unknown[]) => {
      if (this.ended) return;
      const [state, errorCode] = args as [string, number];
      // Only a failure BEFORE the session ever came up is a connect failure;
      // afterwards the roomStateChanged events own the lifecycle.
      if (!this.connectedOnce && String(state).startsWith("PUBLISH") && errorCode) {
        cb.onConnectFailed("generic");
      }
    });

    engine.on("tokenWillExpire", () => {
      if (this.ended) return;
      void cb.onTokenWillExpire().then((freshToken) => {
        if (this.ended || !freshToken) return;
        try {
          this.engine?.renewToken(freshToken, this.roomName);
        } catch {
          // Renewal failure surfaces through the room state events.
        }
      });
    });

    try {
      await engine.loginRoom(
        this.roomName,
        tokenResp.token,
        { userID: tokenResp.participantIdentity, userName: user.name },
        { userUpdate: true },
      );
      if (this.ended) return;

      // Local capture — mic always, camera only in video mode. Permission
      // denials get their own user-facing state (same as the LiveKit path).
      let local: MediaStream;
      try {
        local = await engine.createZegoStream({
          camera: { audio: true, video: mode === "video" },
        });
      } catch (err) {
        if (isPermissionError(err)) {
          cb.onConnectFailed("permission");
        } else {
          cb.onConnectFailed("generic");
        }
        return;
      }
      if (this.ended) return;
      this.localStream = local;

      engine.startPublishingStream(this.myStreamId, local);

      // Schedule a renewal slightly before server-side expiry. The callback
      // re-runs the FULL authorization funnel server-side (never a silent
      // client-side extension).
      const ttlMs = Math.max((tokenResp.tokenTtlSeconds ?? 3600) * 1000, RENEW_MARGIN_MS * 2);
      this.renewTimer = setTimeout(() => {
        void cb.onTokenWillExpire();
      }, ttlMs - RENEW_MARGIN_MS);
    } catch (err) {
      if (this.ended) return;
      if (isPermissionError(err)) cb.onConnectFailed("permission");
      else cb.onConnectFailed("generic");
    }
  }

  /** Mark the session live once remote media exists (phase "active"). */
  noteConnected(): void {
    this.connectedOnce = true;
  }

  async toggleMic(on: boolean): Promise<void> {
    // muteMicrophone(false) = mic ON. Engine-level mute keeps the published
    // stream alive (same semantics as LiveKit setMicrophoneEnabled).
    this.engine?.muteMicrophone(!on);
    for (const t of this.localStream?.getAudioTracks() ?? []) t.enabled = on;
  }

  async toggleCam(on: boolean): Promise<void> {
    // ZEGO-recommended approach (SDK note): publish the stream with the
    // video track present, then toggle track.enabled — no re-negotiation.
    for (const t of this.localStream?.getVideoTracks() ?? []) t.enabled = on;
  }

  /** The ONLY teardown path. Idempotent; every step is best-effort. */
  async disconnect(): Promise<void> {
    this.ended = true;
    if (this.renewTimer) {
      clearTimeout(this.renewTimer);
      this.renewTimer = null;
    }
    const engine = this.engine;
    this.engine = null;
    if (!engine) return;
    try {
      if (this.myStreamId) engine.stopPublishingStream(this.myStreamId);
    } catch {
      // ignore
    }
    try {
      if (this.remoteStreamId) engine.stopPlayingStream(this.remoteStreamId);
    } catch {
      // ignore
    }
    try {
      if (this.localStream) engine.destroyStream(this.localStream);
    } catch {
      // ignore
    }
    this.localStream = null;
    try {
      if (this.roomName) await engine.logoutRoom(this.roomName);
    } catch {
      // ignore
    }
    try {
      engine.destroyEngine();
    } catch {
      // ignore
    }
  }
}

/** Browser permission denials are DOMException NotAllowedError/SecurityError. */
function isPermissionError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "NotAllowedError" || err.name === "SecurityError")
  ) || (
    err instanceof Error && err.name === "NotAllowedError"
  );
}
