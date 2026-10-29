/**
 * ZegoCallSession — maps the ZEGO Express Web SDK onto the page's
 * call-session contract (ZEGOCLOUD is the sole provider):
 *  - connect() requires a SERVER-minted 'zego' token response (the client
 *    never mints or alters tokens) and drives loginRoom → createZegoStream →
 *    startPublishingStream with server-derived room/stream identity.
 *  - Room reasons map onto honest UI states: RECONNECTING/RECONNECTED are
 *    TRUE automatic reconnections; DISCONNECTED/KICKOUT are unexpected
 *    disconnects with a REAL retry; initial capture denials are permission
 *    failures.
 *  - Remote media: roomStreamUpdate ADD → startPlayingStream → onRemoteStream;
 *    the session's OWN stream is filtered out; DELETE → onRemoteStream(null).
 *  - tokenWillExpire → the page callback supplies a freshly authorized token
 *    which is handed to renewToken — never a client-side grant extension.
 *  - disconnect() tears everything down best-effort and is idempotent.
 * The SDK module is mocked; no network, no real credentials anywhere.
 * Node test environment has no WebRTC globals — a minimal MediaStream
 * polyfill stands in for capture/remote streams.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZegoCallSession, type ZegoSessionCallbacks } from "@/lib/call/zego-session";
import type { CallTokenResponse } from "@/lib/api/types";

// ── Minimal WebRTC stand-ins (node environment has no MediaStream) ──────────
class FakeMediaTrack {
  enabled = true;
  constructor(public kind: "audio" | "video") {}
}
class FakeMediaStream {
  private tracks: FakeMediaTrack[] = [];
  addTrack(t: FakeMediaTrack) {
    this.tracks.push(t);
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
}
(globalThis as { MediaStream?: unknown }).MediaStream = FakeMediaStream;
afterAll(() => {
  delete (globalThis as { MediaStream?: unknown }).MediaStream;
});

// ── Recording fake engine ────────────────────────────────────────────────────
type Rec = { calls: Array<[string, ...unknown[]]>; handlers: Map<string, (...a: unknown[]) => void> };
const rec: Rec = { calls: [], handlers: new Map() };
let denyNextStream = false;

function log(method: string, ...args: unknown[]) {
  rec.calls.push([method, ...args]);
}

/**
 * Issue #70: mirrors the REAL SDK 3.x shape — createZegoStream resolves with
 * a ZegoLocalStream WRAPPER that is NOT a MediaStream and holds the real
 * capture in `.stream` (verified in the installed package). Tests must not
 * pretend the wrapper is a MediaStream: that lie is exactly what let the
 * broken srcObject assignment reach production.
 */
class FakeZegoLocalStream {
  constructor(public readonly inner: FakeMediaStream) {}
  get stream(): FakeMediaStream {
    return this.inner;
  }
  getVideoTracks() {
    return this.inner.getVideoTracks();
  }
  getAudioTracks() {
    return this.inner.getAudioTracks();
  }
}

class FakeEngine {
  on(event: string, cb: (...a: unknown[]) => void) {
    rec.handlers.set(event, cb);
  }
  loginRoom = vi.fn(async (...args: unknown[]) => {
    log("loginRoom", ...args);
    return {};
  });
  logoutRoom = vi.fn(async (...args: unknown[]) => {
    log("logoutRoom", ...args);
    return {};
  });
  createZegoStream = vi.fn(async (...args: unknown[]) => {
    log("createZegoStream", ...args);
    if (denyNextStream) {
      denyNextStream = false;
      throw new DOMException("denied", "NotAllowedError");
    }
    const s = new FakeMediaStream();
    s.addTrack(new FakeMediaTrack("audio"));
    s.addTrack(new FakeMediaTrack("video"));
    this.createdInner = s;
    this.createdWrapper = new FakeZegoLocalStream(s);
    return this.createdWrapper;
  });
  createdWrapper: FakeZegoLocalStream | null = null;
  createdInner: FakeMediaStream | null = null;
  startPublishingStream = vi.fn((...args: unknown[]) => {
    log("startPublishingStream", ...args);
    return true;
  });
  stopPublishingStream = vi.fn((...args: unknown[]) => {
    log("stopPublishingStream", ...args);
  });
  startPlayingStream = vi.fn(async (...args: unknown[]) => {
    log("startPlayingStream", ...args);
    return new FakeMediaStream();
  });
  stopPlayingStream = vi.fn((...args: unknown[]) => {
    log("stopPlayingStream", ...args);
  });
  destroyStream = vi.fn((...args: unknown[]) => {
    log("destroyStream", ...args);
  });
  muteMicrophone = vi.fn((...args: unknown[]) => {
    log("muteMicrophone", ...args);
    return true;
  });
  renewToken = vi.fn((...args: unknown[]) => {
    log("renewToken", ...args);
    return true;
  });
  destroyEngine = vi.fn(() => {
    log("destroyEngine");
  });
}

let lastEngine: FakeEngine | null = null;

vi.mock("zego-express-engine-webrtc", () => ({
  ZegoExpressEngine: class MockEngine extends FakeEngine {
    constructor() {
      super();
      lastEngine = this as unknown as FakeEngine;
    }
  },
}));

// ── Fixtures ────────────────────────────────────────────────────────────────
function zegoTokenResponse() {
  return {
    provider: "zego" as const,
    token: "04testtoken",
    url: "wss://zego.example/ws",
    roomName: "medika_cons-1",
    participantIdentity: "user-1",
    streamId: "medika_cons-1_user-1",
    appId: 42,
    tokenTtlSeconds: 3600,
  };
}

function callbacks() {
  const c = {
    remote: [] as Array<MediaStream | null>,
    reconnecting: 0,
    reconnected: 0,
    unexpected: 0,
    failed: [] as Array<"permission" | "generic">,
    partnerJoined: 0,
    partnerLeft: 0,
    renewals: 0,
  };
  const cb: ZegoSessionCallbacks = {
    onRemoteStream: (s) => c.remote.push(s),
    onReconnecting: () => c.reconnecting++,
    onReconnected: () => c.reconnected++,
    onUnexpectedDisconnect: () => c.unexpected++,
    onConnectFailed: (k) => c.failed.push(k),
    onPartnerJoined: () => c.partnerJoined++,
    onPartnerLeft: () => c.partnerLeft++,
    onTokenWillExpire: async () => {
      c.renewals++;
      return "04freshtoken";
    },
  };
  return { cb, c };
}

const user = { id: "user-1", name: "Pat Test" };

beforeEach(() => {
  rec.calls = [];
  rec.handlers = new Map();
  lastEngine = null;
  denyNextStream = false;
});

const sessions: ZegoCallSession[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.disconnect();
});

describe("ZegoCallSession", () => {
  it("refuses to start without a server-minted zego token response", async () => {
    const { cb } = callbacks();
    const s = new ZegoCallSession();
    sessions.push(s);
    // A legacy/foreign token shape (no zego fields) must be rejected at the
    // runtime boundary even though the type no longer expresses it.
    const foreign = { token: "t", url: "wss://lk", roomName: "r", participantIdentity: "u" } as unknown as CallTokenResponse;
    await expect(
      s.connect(foreign, user, "video", cb),
    ).rejects.toThrow(/zego provider token/);
    expect(lastEngine).toBeNull();
  });

  it("connects with server-derived identity and publishes its own stream only", async () => {
    const { cb } = callbacks();
    const s = new ZegoCallSession();
    sessions.push(s);
    await s.connect(zegoTokenResponse(), user, "video", cb);

    expect(rec.calls.find((c) => c[0] === "loginRoom")?.slice(1)).toEqual([
      "medika_cons-1",
      "04testtoken",
      { userID: "user-1", userName: "Pat Test" },
      { userUpdate: true },
    ]);
    // Issue #70: video mode requests the SDK's 720p capture preset
    // (quality 3 = 1280x720@20fps/1500kbps), not the 640x480@15fps default.
    expect(rec.calls.find((c) => c[0] === "createZegoStream")?.[1]).toEqual({
      camera: { audio: true, video: { quality: 3 } },
    });
    expect(rec.calls.find((c) => c[0] === "startPublishingStream")?.[1]).toBe("medika_cons-1_user-1");
    // The SDK receives the ZegoLocalStream WRAPPER it created (its contract).
    const wrapper = lastEngine!.createdWrapper!;
    expect(rec.calls.find((c) => c[0] === "startPublishingStream")?.[2]).toBe(wrapper);
    // Issue #70 regression: the page-facing stream is the INNER MediaStream —
    // never the wrapper. Assigning the wrapper to video.srcObject throws
    // TypeError in the browser, which is how the self-view vanished while
    // publishing still worked.
    expect(s.localMediaStream).toBe(lastEngine!.createdInner);
    expect(s.localMediaStream).not.toBe(wrapper);
  });

  it("requests no camera in voice mode", async () => {
    const { cb } = callbacks();
    const s = new ZegoCallSession();
    sessions.push(s);
    await s.connect(zegoTokenResponse(), user, "voice", cb);
    expect(rec.calls.find((c) => c[0] === "createZegoStream")?.[1]).toEqual({
      camera: { audio: true, video: false },
    });
  });

  it("maps room reasons onto honest UI events", async () => {
    const { cb, c } = callbacks();
    const s = new ZegoCallSession();
    sessions.push(s);
    await s.connect(zegoTokenResponse(), user, "video", cb);
    const fire = rec.handlers.get("roomStateChanged")!;

    fire("medika_cons-1", "RECONNECTING");
    fire("medika_cons-1", "RECONNECTED");
    fire("medika_cons-1", "DISCONNECTED");
    fire("medika_cons-1", "KICKOUT");
    // Another room's events must NOT leak into this session:
    fire("medika_other", "DISCONNECTED");

    expect(c.reconnecting).toBe(1);
    expect(c.reconnected).toBe(1);
    expect(c.unexpected).toBe(2);
  });

  it("plays and surfaces remote streams; filters its own; handles DELETE", async () => {
    const { cb, c } = callbacks();
    const s = new ZegoCallSession();
    sessions.push(s);
    await s.connect(zegoTokenResponse(), user, "video", cb);
    const fire = rec.handlers.get("roomStreamUpdate")!;
    const remote = { streamID: "medika_cons-1_doctor-1" };

    // Own stream in the ADD list — must be ignored:
    fire("medika_cons-1", "ADD", [{ streamID: "medika_cons-1_user-1" }]);
    expect(rec.calls.find((c2) => c2[0] === "startPlayingStream")).toBeUndefined();

    fire("medika_cons-1", "ADD", [remote]);
    await vi.waitFor(() => {
      expect(rec.calls.find((c2) => c2[0] === "startPlayingStream")?.[1]).toBe("medika_cons-1_doctor-1");
      expect(c.remote.at(-1)).not.toBeNull();
    });

    fire("medika_cons-1", "DELETE", [remote]);
    await vi.waitFor(() => {
      expect(rec.calls.find((c2) => c2[0] === "stopPlayingStream")?.[1]).toBe("medika_cons-1_doctor-1");
      expect(c.remote.at(-1)).toBeNull();
      expect(c.partnerLeft).toBe(1);
    });
  });

  it("renews with the freshly authorized token on tokenWillExpire", async () => {
    const { cb, c } = callbacks();
    const s = new ZegoCallSession();
    sessions.push(s);
    await s.connect(zegoTokenResponse(), user, "video", cb);
    rec.handlers.get("tokenWillExpire")!();
    await vi.waitFor(() => {
      expect(c.renewals).toBe(1);
      expect(rec.calls.find((c2) => c2[0] === "renewToken")?.slice(1)).toEqual(["04freshtoken", "medika_cons-1"]);
    });
  });

  it("surfaces camera/mic permission denials as permission failures", async () => {
    const { cb, c } = callbacks();
    const s = new ZegoCallSession();
    sessions.push(s);
    denyNextStream = true;
    await s.connect(zegoTokenResponse(), user, "video", cb);
    expect(c.failed).toEqual(["permission"]);
    expect(s.localMediaStream).toBeNull();
  });

  it("toggles mic/cam without any teardown", async () => {
    const { cb } = callbacks();
    const s = new ZegoCallSession();
    sessions.push(s);
    await s.connect(zegoTokenResponse(), user, "video", cb);

    await s.toggleMic(false);
    expect(rec.calls.find((c2) => c2[0] === "muteMicrophone")?.[1]).toBe(true);
    await s.toggleMic(true);
    expect(rec.calls.find((c2) => c2[0] === "muteMicrophone" && c2[1] === false)).toBeTruthy();

    await s.toggleCam(false);
    await s.toggleCam(true);
    // No teardown methods may have been called by toggles:
    expect(rec.calls.find((c2) => c2[0] === "logoutRoom")).toBeUndefined();
    expect(rec.calls.find((c2) => c2[0] === "destroyEngine")).toBeUndefined();
  });

  it("disconnects best-effort and is idempotent", async () => {
    const { cb } = callbacks();
    const s = new ZegoCallSession();
    sessions.push(s);
    await s.connect(zegoTokenResponse(), user, "video", cb);
    const wrapper = lastEngine!.createdWrapper!;
    await s.disconnect();
    expect(rec.calls.find((c2) => c2[0] === "stopPublishingStream")?.[1]).toBe("medika_cons-1_user-1");
    expect(rec.calls.find((c2) => c2[0] === "destroyStream")?.[1]).toBe(wrapper);
    expect(rec.calls.find((c2) => c2[0] === "logoutRoom")?.[1]).toBe("medika_cons-1");
    expect(rec.calls.find((c2) => c2[0] === "destroyEngine")).toBeTruthy();
    await s.disconnect(); // second call must be a safe no-op
    expect(rec.calls.filter((c2) => c2[0] === "destroyEngine")).toHaveLength(1);
  });
});
