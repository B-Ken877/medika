"use client";

/**
 * RemoteRecordingIndicator (issue #26) — recipient-only voice-recording
 * activity row, rendered near the latest messages exactly like the typing
 * indicator.
 *
 * The OTHER participant is actively recording a voice message: a small
 * incoming-style status row with a microphone icon that smoothly fades in
 * and out. It is a transient STATUS — never a message: no database row, no
 * optimistic entry, no attachment, no duration. It disappears on the stop
 * signal (or the stale timeout) and the persisted voice bubble then arrives
 * through the normal durable message flow.
 *
 * Accessibility: ONE polite status region — the pulsing icon is decorative
 * (aria-hidden) and heartbeats never re-announce anything. The animation
 * honors prefers-reduced-motion via CSS.
 */
export function RemoteRecordingIndicator() {
  return (
    <div
      className="recording-remote-row"
      role="status"
      aria-label="Lòt moun nan ap anrejistre yon mesaj vwa"
    >
      <span className="typing-label">Ap anrejistre…</span>
      <span className="recording-remote-pill" aria-hidden="true">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="recording-remote-mic"
        >
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      </span>
    </div>
  );
}
