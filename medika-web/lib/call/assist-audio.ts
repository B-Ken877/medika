"use client";

/**
 * AssistAudioSession — MINIMAL audio-only ZEGO room session for the human
 * contact-center calls (patient side on /app/assist, agent side in the
 * workspace). Deliberately separate from lib/call/zego-session.ts: the
 * doctor-patient video-consultation session owns its full contract (phases
 * reducer, signaling, chat); this module is ONLY a mic-only room bridge so
 * an assistance call can never disturb that machinery (brief #10).
 *
 * SDK surface verified in zego-session.ts (zego-express-engine-webrtc 3.x):
 * constructor(appID, server), loginRoom(roomID, token, {userID, userName},
 * {userUpdate}), createZegoStream({camera:{video:false,audio:true}}),
 * startPublishingStream, startPlayingStream → MediaStream, roomStreamUpdate,
 * mutePublishStreamAudio, logoutRoom, destroyEngine. Dynamic import —
 * browser-only, never executes during SSR.
 */
export interface AssistAudioOptions {
  appId: number;
  token: string;
  roomName: string;
  userId: string;
}

interface ZegoStreamLike {
  get stream(): MediaStream | null;
}

interface ZegoEngineLike {
  on(event: string, cb: (...args: never[]) => void): void;
  loginRoom(roomID: string, token: string, user: { userID: string; userName: string }, opts: { userUpdate: boolean }): Promise<unknown>;
  createZegoStream(opts: Record<string, unknown>): Promise<ZegoStreamLike>;
  startPublishingStream(streamID: string, stream: ZegoStreamLike): void;
  startPlayingStream(streamID: string): Promise<MediaStream | null>;
  mutePublishStreamAudio(streamID: string, mute: boolean): void;
  logoutRoom(roomID?: string): void;
  destroyEngine(): void;
}

export class AssistAudioSession {
  private engine: ZegoEngineLike | null = null;
  private local: ZegoStreamLike | null = null;
  private remoteEl: HTMLAudioElement | null = null;
  private readonly opts: AssistAudioOptions;
  private micOn = true;

  constructor(opts: AssistAudioOptions) {
    this.opts = opts;
  }

  /** Attach the audio element that will play the other party's voice. */
  attachRemote(el: HTMLAudioElement | null) {
    this.remoteEl = el;
  }

  async connect(): Promise<void> {
    const mod = (await import("zego-express-engine-webrtc")) as unknown as {
      ZegoExpressEngine: new (appID: number, server: string) => ZegoEngineLike;
    };
    // The SDK ships "wss://webliveroom{appID}-api.zegocloud.com/ws" style URLs;
    // the server URL comes from the token endpoint (server-side config).
    const server = (this.opts as unknown as { server?: string }).server ?? `wss://webliveroom${this.opts.appId}-api.zegocloud.com/ws`;
    const engine = new mod.ZegoExpressEngine(this.opts.appId, server);
    this.engine = engine;
    await engine.loginRoom(this.opts.roomName, this.opts.token, { userID: this.opts.userId, userName: this.opts.userId }, { userUpdate: true });

    const local = await engine.createZegoStream({ camera: { video: false, audio: true }, mediaStream: undefined });
    this.local = local;
    const streamId = `${this.opts.roomName}_${this.opts.userId}`;
    engine.startPublishingStream(streamId, local);

    // Play the other party as soon as their stream arrives.
    engine.on("roomStreamUpdate", async (_roomID: string, updateType: string, _list: unknown, info: { streamList?: { streamID: string }[] }) => {
      if (updateType !== "ADDED" || !info?.streamList?.length || !this.engine) return;
      for (const s of info.streamList) {
        if (s.streamID === streamId) continue;
        const remote = await this.engine.startPlayingStream(s.streamID);
        if (remote && this.remoteEl) {
          this.remoteEl.srcObject = remote;
          await this.remoteEl.play().catch(() => { /* autoplay policy — the user clicked, so play() is allowed */ });
        }
      }
    });
  }

  /** Returns the new mic state (true = mic live). */
  toggleMic(): boolean {
    this.micOn = !this.micOn;
    this.engine?.mutePublishStreamAudio(
      `${this.opts.roomName}_${this.opts.userId}`,
      !this.micOn,
    );
    return this.micOn;
  }

  /** The ONLY teardown path (brief: disconnect is deliberate). */
  disconnect(): void {
    try {
      this.engine?.logoutRoom(this.opts.roomName);
      this.engine?.destroyEngine();
    } finally {
      this.engine = null;
      this.local = null;
    }
  }
}
