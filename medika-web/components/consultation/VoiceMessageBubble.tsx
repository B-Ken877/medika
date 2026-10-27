"use client";

/**
 * VoiceMessageBubble — polished audio player for voice messages (issue #18).
 *
 * Presentation only: the transport is a hidden <audio> element fed with the
 * SAME authorized signed URL SecureMedia resolved — upload, delivery,
 * authorization and grant-refresh behavior are untouched (onError bubbles
 * back into SecureMedia's refresh-once path).
 *
 * UI: play/pause with a comfortable hit target, a deterministic waveform
 * (played vs unplayed visually distinct), current/total time, click-to-seek
 * and a keyboard-operable slider (arrows ±5s, Home/End), consistent styles
 * for sent (on green) and received (on surface) bubbles, compact on phones.
 */
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Pause, Play } from "lucide-react";
import { formatRecordingDuration } from "@/lib/chat/voice";
import { synthesizedBars } from "@/lib/chat/waveform";

interface VoiceMessageBubbleProps {
  /** Resolved (signed/direct) audio URL — same one the old <audio> used. */
  src: string;
  /** Stable per-message key (id or file url) — seeds the waveform. */
  seedKey: string;
  /** Server-known duration in seconds, when present. */
  durationSeconds?: number | null;
  /** Load failure — delegates to SecureMedia's grant-refresh-once path. */
  onError?: () => void;
}

const KEYBOARD_SEEK_SECONDS = 5;

export function VoiceMessageBubble({ src, seedKey, durationSeconds, onError }: VoiceMessageBubbleProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [metadataSeconds, setMetadataSeconds] = useState<number | null>(null);

  const bars = useMemo(() => synthesizedBars(seedKey), [seedKey]);

  // Prefer the server-side duration; fall back to what the container reports
  // once its metadata loads (covers older messages with a null duration).
  const totalSeconds = durationSeconds && durationSeconds > 0 ? durationSeconds : metadataSeconds;
  const playedFraction =
    totalSeconds && totalSeconds > 0 ? Math.max(0, Math.min(1, currentSeconds / totalSeconds)) : 0;
  const playedBars = Math.round(playedFraction * bars.length);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => setPlaying(false));
    } else {
      el.pause();
    }
  }, []);

  const seekToFraction = useCallback(
    (fraction: number) => {
      const el = audioRef.current;
      if (!el || !totalSeconds || totalSeconds <= 0) return; // unknown duration — no seeking yet
      const clamped = Math.max(0, Math.min(1, fraction));
      const next = clamped * totalSeconds;
      el.currentTime = next;
      setCurrentSeconds(next);
    },
    [totalSeconds],
  );

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const wave = waveRef.current;
      if (!wave) return;
      const rect = wave.getBoundingClientRect();
      if (rect.width <= 0) return;
      seekToFraction((clientX - rect.left) / rect.width);
    },
    [seekToFraction],
  );

  const onWaveClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      seekFromPointer(e.clientX);
    },
    [seekFromPointer],
  );

  const onWaveKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const el = audioRef.current;
      if (!el) return;
      const seekBy = (delta: number) => {
        e.preventDefault();
        if (!totalSeconds || totalSeconds <= 0) return;
        const next = Math.max(0, Math.min(totalSeconds, (el.currentTime || 0) + delta));
        el.currentTime = next;
        setCurrentSeconds(next);
      };
      switch (e.key) {
        case "ArrowLeft":
          seekBy(-KEYBOARD_SEEK_SECONDS);
          break;
        case "ArrowRight":
          seekBy(KEYBOARD_SEEK_SECONDS);
          break;
        case "Home":
          e.preventDefault();
          el.currentTime = 0;
          setCurrentSeconds(0);
          break;
        case "End":
          e.preventDefault();
          if (totalSeconds && totalSeconds > 0) {
            el.currentTime = totalSeconds;
            setCurrentSeconds(totalSeconds);
          }
          break;
        default:
          break;
      }
    },
    [totalSeconds],
  );

  const timeLabel = (s: number | null | undefined) => (s && s > 0 ? formatRecordingDuration(s) : "0:00");

  return (
    <div className="voice-msg">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        hidden
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentSeconds(0);
        }}
        onTimeUpdate={() => {
          const el = audioRef.current;
          if (el) setCurrentSeconds(el.currentTime || 0);
        }}
        onLoadedMetadata={() => {
          const el = audioRef.current;
          const d = el && Number.isFinite(el.duration) ? el.duration : null;
          if (d && d > 0) setMetadataSeconds(d);
        }}
        onError={onError}
      />
      <button
        type="button"
        className="voice-msg-btn"
        onClick={toggle}
        aria-label={playing ? "Kanpe lekti mesaj vwa a" : "Jwe mesaj vwa a"}
      >
        {playing ? <Pause size={17} aria-hidden /> : <Play size={17} aria-hidden />}
      </button>
      <div
        ref={waveRef}
        className="voice-msg-wave"
        role="slider"
        tabIndex={0}
        aria-label="Pozisyon lekti mesaj vwa a"
        aria-valuemin={0}
        aria-valuemax={totalSeconds && totalSeconds > 0 ? Math.round(totalSeconds) : 0}
        aria-valuenow={totalSeconds && totalSeconds > 0 ? Math.round(currentSeconds) : 0}
        aria-valuetext={
          totalSeconds && totalSeconds > 0
            ? `${timeLabel(currentSeconds)} sou ${timeLabel(totalSeconds)}`
            : timeLabel(currentSeconds)
        }
        onClick={onWaveClick}
        onKeyDown={onWaveKeyDown}
      >
        {bars.map((b, i) => (
          <span key={i} className={i < playedBars ? "played" : undefined} style={{ height: `${Math.round(b * 100)}%` }} />
        ))}
      </div>
      <span className="voice-msg-time" aria-hidden="true">
        {timeLabel(currentSeconds)} / {timeLabel(totalSeconds)}
      </span>
    </div>
  );
}
