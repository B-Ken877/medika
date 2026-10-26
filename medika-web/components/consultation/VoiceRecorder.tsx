"use client";

/**
 * VoiceRecorder — mic button + recording bar + preview + send/cancel.
 *
 *  - permission requested ONLY when the user taps the mic
 *  - codec feature-detected via MediaRecorder.isTypeSupported (lib/chat/voice)
 *  - every audio track is stopped on stop / cancel / unmount / failure
 *  - object URLs revoked on every transition
 *  - one recording at a time; concurrent uploads prevented by the caller
 *  - a failed send NEVER discards the clip: the preview stays with retry
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Mic, Square, Trash2, X } from "lucide-react";
import {
  MAX_RECORDING_SECONDS,
  MIN_RECORDING_SECONDS,
  detectRecorderSupport,
  formatRecordingDuration,
  recordingFilename,
  type RecorderSupport,
} from "@/lib/chat/voice";

interface VoiceRecorderProps {
  disabled: boolean;
  maxBytes: number;
  /** Resolves TRUE once the message path accepted the clip (upload + send);
   *  on FALSE the preview stays available for retry or cancel. */
  onSend: (file: File, durationSeconds: number) => Promise<boolean>;
  onPermissionError: () => void;
}

type Phase = "idle" | "recording" | "preview";

export function VoiceRecorder({ disabled, maxBytes, onSend, onPermissionError }: VoiceRecorderProps) {
  const [support] = useState<RecorderSupport>(() =>
    detectRecorderSupport(),
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  const cleanupResources = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
    } catch {
      /* already stopped */
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    chunksRef.current = [];
  }, []);

  const revokePreview = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  // Unmount: stop tracks, revoke URLs — no leaked mic, no leaked memory.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      cleanupResources();
      revokePreview();
    };
  }, [cleanupResources, revokePreview]);

  const startRecording = useCallback(async () => {
    if (!support.supported || phase !== "idle" || disabled) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, support.mime ? { mimeType: support.mime } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: support.mime || "audio/webm" });
        const durationSeconds = (Date.now() - startedAtRef.current) / 1000;
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (cancelledRef.current) return;
        if (blob.size === 0 || durationSeconds < MIN_RECORDING_SECONDS) {
          setError("Anrejistreman an twò kout.");
          setPhase("idle");
          return;
        }
        if (blob.size > maxBytes) {
          setError("Anrejistreman an twò long — eseye ankò pli kout.");
          setPhase("idle");
          return;
        }
        const file = new File([blob], recordingFilename(support.ext), { type: blob.type });
        setPreviewFile(file);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setPreviewUrl(url);
        setPhase("preview");
      };
      startedAtRef.current = Date.now();
      setElapsed(0);
      recorder.start(250);
      setPhase("recording");
      timerRef.current = setInterval(() => {
        const secs = (Date.now() - startedAtRef.current) / 1000;
        setElapsed(secs);
        if (secs >= MAX_RECORDING_SECONDS) {
          try {
            recorderRef.current?.stop();
          } catch {
            /* already stopping */
          }
        }
      }, 250);
    } catch (err) {
      cleanupResources();
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      if (denied) {
        onPermissionError();
      } else {
        setError("Nou pa t kapab kòmanse anrejistreman an.");
      }
      setPhase("idle");
    }
  }, [support, phase, disabled, maxBytes, cleanupResources, onPermissionError]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      recorderRef.current?.stop();
    } catch {
      /* recorder inactive */
    }
  }, []);

  const cancelAll = useCallback(() => {
    cleanupResources();
    revokePreview();
    setPreviewUrl(null);
    setPreviewFile(null);
    setElapsed(0);
    setPhase("idle");
  }, [cleanupResources, revokePreview]);

  const [sending, setSending] = useState(false);

  const sendPreview = useCallback(async () => {
    if (!previewFile || sending) return;
    setSending(true);
    try {
      const ok = await onSend(previewFile, Math.round(elapsed));
      if (ok) cancelAll(); // sent — clean the preview and the object URL
      // else: keep the clip for retry/cancel (never discard silently)
    } finally {
      setSending(false);
    }
  }, [previewFile, elapsed, onSend, cancelAll, sending]);

  if (!support.supported) {
    return (
      <button
        type="button"
        className="composer-btn"
        disabled
        aria-label="Mesaj vwa pa disponib sou aparèy sa a"
        title="Mesaj vwa pa disponib sou aparèy sa a"
      >
        <Mic size={20} />
      </button>
    );
  }

  if (phase === "recording") {
    return (
      <div className="voice-bar" role="status" aria-label="Anrejistreman an ap fèt">
        <span className="voice-rec-dot" aria-hidden />
        <span className="voice-timer">{formatRecordingDuration(elapsed)}</span>
        <span className="tiny voice-hint">Anrejistre mesaj vwa…</span>
        <span className="voice-actions">
          <button
            type="button"
            className="composer-btn danger"
            onClick={cancelAll}
            aria-label="Anile anrejistreman an"
            title="Anile"
          >
            <Trash2 size={18} />
          </button>
          <button
            type="button"
            className="composer-btn send"
            onClick={stopRecording}
            aria-label="Fini anrejistreman an"
            title="Fini"
          >
            <Square size={16} />
          </button>
        </span>
      </div>
    );
  }

  if (phase === "preview" && previewUrl) {
    return (
      <div className="voice-bar preview" role="status" aria-label="Apèsevyè mesaj vwa a">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio src={previewUrl} controls preload="metadata" className="voice-preview-audio" />
        <span className="voice-actions">
          <button
            type="button"
            className="composer-btn danger"
            onClick={cancelAll}
            aria-label="Anile mesaj vwa a"
            title="Anile"
          >
            <X size={18} />
          </button>
          <button
            type="button"
            className="composer-btn send"
            onClick={sendPreview}
            disabled={sending}
            aria-label="Voye mesaj vwa a"
            title="Voye"
          >
            <Check size={18} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="composer-btn"
        onClick={startRecording}
        disabled={disabled}
        aria-label="Anrejistre mesaj vwa"
        title="Anrejistre mesaj vwa"
      >
        <Mic size={20} />
      </button>
      {error && <span className="tiny voice-error">{error}</span>}
    </>
  );
}
