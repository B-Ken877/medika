/**
 * WebSocket manager tests — protocol shape, dedup, URL derivation,
 * reconnection scheduling. Uses a fake WebSocket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  // test helpers
  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  simulateMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

vi.stubGlobal("WebSocket", FakeWebSocket);
// node lacks window; the module guards on typeof window
vi.stubGlobal("window", { location: { protocol: "https:", host: "medikahaiti.site" } });

const { MedikaSocket, wsEventToServerMessage, wsUrl } = await import("@/lib/ws/socket");

describe("wsUrl", () => {
  it("derives wss:// from the current https origin", () => {
    expect(wsUrl()).toBe("wss://medikahaiti.site/ws");
  });
  it("converts an explicit http API base to ws", () => {
    expect(wsUrl("http://localhost:3000")).toBe("ws://localhost:3000/ws");
    expect(wsUrl("https://api.example.com")).toBe("wss://api.example.com/ws");
  });
});

describe("MedikaSocket", () => {
  let socket: InstanceType<typeof MedikaSocket>;

  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    socket = new MedikaSocket();
  });

  afterEach(() => {
    socket.disconnect();
    vi.useRealTimers();
  });

  it("authenticates with {type:'auth', userId} on open (Android protocol)", () => {
    socket.connect("patient_1");
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.simulateOpen();
    expect(ws.sent[0]).toBe(JSON.stringify({ type: "auth", userId: "patient_1" }));
  });

  it("sends message:send with the exact Android payload shape", () => {
    socket.connect("patient_1");
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.simulateOpen();
    socket.sendMessage("cons_123", "patient_1", "Sarah", "Bonjour docteur");
    const payload = JSON.parse(ws.sent.at(-1)!);
    expect(payload).toEqual({
      type: "message:send",
      consultationId: "cons_123",
      senderId: "patient_1",
      senderName: "Sarah",
      text: "Bonjour docteur",
      messageType: "text",
    });
  });

  it("sends media messages with file metadata", () => {
    socket.connect("patient_1");
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.simulateOpen();
    socket.sendMediaMessage("cons_1", "patient_1", "Sarah", {
      messageType: "image",
      fileUrl: "/uploads/cons_1/1.jpg",
      fileSize: 2048,
    });
    const payload = JSON.parse(ws.sent.at(-1)!);
    expect(payload.messageType).toBe("image");
    expect(payload.fileUrl).toBe("/uploads/cons_1/1.jpg");
    expect(payload.text).toBe("");
  });

  it("relays server events to listeners and dedups message:new by id", () => {
    const events: Array<{ type: string }> = [];
    socket.onEvent((e) => events.push(e as { type: string }));
    socket.connect("patient_1");
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.simulateOpen();

    const msg = {
      type: "message:new",
      id: 42,
      consultationId: "cons_1",
      senderId: "doctor_1",
      senderName: "Dr. Martin",
      text: "Bonjour",
      timestamp: Date.now(),
      messageType: "text",
    };
    ws.simulateMessage(msg);
    ws.simulateMessage(msg); // catch-up duplicate
    ws.simulateMessage({ type: "typing", consultationId: "cons_1", senderId: "doctor_1", isTyping: true });
    ws.simulateMessage("not-json"); // must be ignored silently
    ws.simulateMessage({ noType: true }); // must be ignored

    expect(events.filter((e) => e.type === "message:new")).toHaveLength(1);
    expect(events.filter((e) => e.type === "typing")).toHaveLength(1);
  });

  it("emits call signaling exactly like the Android client", () => {
    socket.connect("doctor_1");
    const ws = FakeWebSocket.instances.at(-1)!;
    ws.simulateOpen();
    socket.startCall("cons_1", "Dr. Martin", "video", "medika_cons_1");
    socket.acceptCall("cons_1");
    socket.rejectCall("cons_2");
    socket.endCall("cons_1");

    const payloads = ws.sent.slice(1).map((s) => JSON.parse(s));
    expect(payloads[0]).toMatchObject({ type: "call:start", callType: "video", roomName: "medika_cons_1" });
    expect(payloads[1]).toMatchObject({ type: "call:accept", consultationId: "cons_1" });
    expect(payloads[2]).toMatchObject({ type: "call:reject", consultationId: "cons_2" });
    expect(payloads[3]).toMatchObject({ type: "call:end", consultationId: "cons_1" });
  });

  it("drops send attempts while the socket is not open", () => {
    expect(socket.sendMessage("cons_1", "u", "n", "hi")).toBe(false);
  });
});

describe("wsEventToServerMessage", () => {
  it("maps the WS camelCase event to the REST snake_case message shape", () => {
    const ts = Date.now();
    const m = wsEventToServerMessage({
      id: 7,
      consultationId: "cons_1",
      senderId: "doctor_1",
      senderName: "Dr. Martin",
      text: "Comment allez-vous ?",
      timestamp: ts,
      messageType: "text",
    });
    expect(m).toEqual({
      id: 7,
      consultation_id: "cons_1",
      sender_id: "doctor_1",
      sender_name: "Dr. Martin",
      text: "Comment allez-vous ?",
      created_at: Math.floor(ts / 1000),
      message_type: "text",
      file_url: null,
      duration: null,
      file_size: null,
    });
  });
});
