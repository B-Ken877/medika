"use client";

/**
 * VoiceRecorder — WhatsApp-style voice composer.
 *
 * Authoritative state machine (lib/chat/voice.ts voiceReducer):
 *   idle → requesting_permission → recording ⇄ preview → uploading → sent
 * + explicit error/recovery transitions. One `mode` at a time — never
 * contradictory booleans.
 *
 * Recording strategy: ONE MediaRecorder for the whole clip. STOP pauses it
 * (single valid container, mic stream held for the resume flow); RESUME
 * continues the same recording; SEND finalizes via stop() and uploads the
 * complete file. Preview plays a progressive blob of the chunks captured so
 * far (playback degrades gracefully on containers that need a trailer).
 *
 * Durability: `onSend` resolves TRUE only after the server confirmed
 * persistence (upload + message acknowledgement). A failed send NEVER
 * discards the clip — the composer returns to preview for retry or delete.
 *
 * Cleanup: every stream track, AudioContext, timer, rAF loop and object URL
 * is released on stop/cancel/unmount; React Strict Mode replays are safe.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Check, Mic, Pause, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import {
  MAX_RECORDING_SECONDS,
  detectRecorderSupport,
  formatRecordingDuration,
  recordingFilename,
  voiceReducer,
  initialVoiceState,
  normalizeAmplitude,
  rmsAmplitude,
  supportsPauseResume,
  clipTooLarge,
  clipTooShort,
  type RecorderSupport,
  type VoiceMode,
} from "@/lib/chat/voice";

interface VoiceRecorderProps {
  disabled: boolean;
  maxBytes: number;
  /** Resolves TRUE only once the clip is DURABLY persisted (upload + message
   *  acknowledgement). On FALSE the preview stays available for retry/cancel. */
  onSend: (
    file: File,
    durationSeconds: number,
    onProgress?: (fraction: number) => void,
  ) => Promise<boolean>;
  onPermissionError: () => void;
  /** Page swaps the normal composer out while a voice surface is active. */
  onModeChange?: (mode: VoiceMode) => void;
  /** Called when the user DELETES a clip in preview (page drops its pending
   *  entry, e.g. after a failed send attempt). */
  onDiscard?: () => void;
}

const AMPLITUDE_SAMPLE_MS = 70; // ≈14fps — lively without thrashing React
const SENT_DISMISS_MS = 900; // brief "sent" confirmation before returning to idle
const FLAT_BARS = 12; // fallback waveform when analysis is unavailable

export function VoiceRecorder({
  disabled,
  maxBytes,
  onSend,
  onPermissionError,
  onModeChange,
  onDiscard,
}: VoiceRecorderProps) {
  const [support] = useState<RecorderSupport>(() => detectRecorderSupport());
  const [state, dispatch] = useReducer(voiceReducer, undefined, initialVoiceState);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPlayable, setPreviewPlayable] = useState(true);
  const [canResume, setCanResume] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  /** Finalized clip (cached across retries so the page maps them to one
   *  clientMsgId). Cleared on resume (stale) and teardown. */
  const fileRef = useRef<File | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastSampleRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentStartRef = useRef(0);
  const accumulatedMsRef = useRef(0);
  const objectUrlRef = useRef<string | null>(null);
  const cancelledRef = useRef(false); // set on unmount — guards async callbacks
  const stopHandlerRef = useRef<(() => void) | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const canPauseResume = useState(() =>
    supportsPauseResume(
      typeof MediaRecorder !== "undefined"
        ? (MediaRecorder as unknown as { prototype?: { pause?: unknown; resume?: unknown } })
        : undefined,
    ),
  )[0];

  // Report the authoritative mode to the page (composer swap).
  useEffect(() => {
    onModeChange?.(state.mode);
  }, [state.mode, onModeChange]);

  // ── Resource cleanup ─────────────────────────────────────────────────────

  const stopSampler = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastSampleRef.current = 0;
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const closeAudioAnalysis = useCallback(() => {
    stopSampler();
    try {
      analyserRef.current?.disconnect();
    } catch {
      /* already disconnected */
    }
    analyserRef.current = null;
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    // Do not await — close() resolves later and must never keep the page alive.
    void ctx?.close().catch(() => undefined);
  }, [stopSampler]);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    streamRef.current = null;
  }, []);

  const revokePreviewUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPreviewUrl(null);
  }, []);

  /** Full teardown of every held resource (stop/cancel/unmount). */
  const teardown = useCallback(() => {
    stopTimer();
    closeAudioAnalysis();
    const rec = recorderRef.current;
    recorderRef.current = null;
    setCanResume(false);
    if (rec && rec.state !== "inactive") {
      stopHandlerRef.current = null; // discard any pending finalization
      try {
        rec.stop();
      } catch {
        /* already stopping */
      }
    }
    releaseStream();
    chunksRef.current = [];
    fileRef.current = null;
    accumulatedMsRef.current = 0;
    segmentStartRef.current = 0;
    revokePreviewUrl();
  }, [stopTimer, closeAudioAnalysis, releaseStream, revokePreviewUrl]);

  // Unmount / Strict Mode replay: release the mic, contexts and URLs.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      teardown();
    };
  }, [teardown]);

  // ── Waveform sampling (Web Audio amplitude → reducer) ────────────────────

  const sampleLoop = useCallback(() => {
    rafRef.current = requestAnimationFrame(sampleLoop);
    const now = performance.now();
    if (now - lastSampleRef.current < AMPLITUDE_SAMPLE_MS) return;
    lastSampleRef.current = now;
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    dispatch({ type: "SAMPLE", amplitude: normalizeAmplitude(rmsAmplitude(buf)) });
  }, []);

  const startSampler = useCallback(() => {
    stopSampler();
    rafRef.current = requestAnimationFrame(sampleLoop);
  }, [sampleLoop, stopSampler]);

  /** Build a fresh preview URL from the chunks captured so far. */
  const buildPreviewFromChunks = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPreviewUrl(null);
    if (chunksRef.current.length === 0) return;
    const blob = new Blob(chunksRef.current, { type: support.mime || "audio/webm" });
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;
    setPreviewPlayable(true);
    setPreviewUrl(url);
  }, [support.mime]);

  // ── Segment timer (shared by start + resume) ─────────────────────────────

  /** Pause the recorder into preview, accumulating the elapsed span. */
  const pauseIntoPreview = useCallback(() => {
    try {
      recorderRef.current?.pause();
    } catch {
      /* already paused — the preview below is still valid */
    }
    stopTimer();
    stopSampler();
    accumulatedMsRef.current += Date.now() - segmentStartRef.current;
    setCanResume(true);
    buildPreviewFromChunks();
    dispatch({ type: "STOP" });
  }, [stopSampler, stopTimer, buildPreviewFromChunks]);

  const startSegmentTimer = useCallback(() => {
    stopTimer();
    timerRef.current = setInterval(() => {
      const total = accumulatedMsRef.current + (Date.now() - segmentStartRef.current);
      dispatch({ type: "TICK", recordedMs: total });
      if (total >= MAX_RECORDING_SECONDS * 1000) {
        // Cap reached: pause into preview automatically.
        pauseIntoPreview();
      }
    }, 250);
  }, [stopTimer, pauseIntoPreview]);

  // ── Recording lifecycle ──────────────────────────────────────────────────

  const beginRecording = useCallback(async () => {
    if (!support.supported || disabled || state.mode !== "idle") return;
    dispatch({ type: "PERMISSION_REQUEST" });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const denied =
        err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      if (denied) {
        dispatch({ type: "PERMISSION_DENIED" });
        onPermissionError();
      } else {
        dispatch({
          type: "PERMISSION_DENIED",
          error: "Nou pa t kapab kòmanse anrejistreman an. Verifye mikwofòn ou.",
        });
      }
      return;
    }
    if (cancelledRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    // Web Audio analysis for the live waveform (best-effort — optional).
    let analyser: AnalyserNode | null = null;
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const src = ctx.createMediaStreamSource(stream);
        const node = ctx.createAnalyser();
        node.fftSize = 512;
        src.connect(node); // analysis only — never connected to destination
        audioCtxRef.current = ctx;
        analyserRef.current = node;
        analyser = node;
      }
    } catch {
      analyser = null; // fallback: no live amplitude, timer still shows
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, support.mime ? { mimeType: support.mime } : undefined);
    } catch {
      closeAudioAnalysis();
      releaseStream();
      dispatch({ type: "PERMISSION_DENIED", error: "Nou pa t kapab kòmanse anrejistreman an." });
      return;
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    accumulatedMsRef.current = 0;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const handler = stopHandlerRef.current;
      stopHandlerRef.current = null;
      if (handler) handler();
    };
    recorder.onerror = () => {
      // Unexpected recorder failure: keep whatever was captured.
      if (!cancelledRef.current && recorderRef.current?.state === "recording") {
        pauseIntoPreview();
      }
    };
    // The OS can revoke the mic (device change, call takeover): treat it as
    // an automatic stop so the captured speech survives in preview.
    stream.getTracks().forEach((track) => {
      track.onended = () => {
        if (cancelledRef.current) return;
        if (recorderRef.current?.state === "recording") {
          pauseIntoPreview();
        }
      };
    });

    recorder.start(250);
    segmentStartRef.current = Date.now();
    dispatch({ type: "PERMISSION_GRANTED" });
    if (analyser) startSampler();
    startSegmentTimer();
  }, [
    support,
    disabled,
    state.mode,
    onPermissionError,
    startSampler,
    startSegmentTimer,
    closeAudioAnalysis,
    releaseStream,
    pauseIntoPreview,
  ]);

  /** STOP: pause the recorder (single container) and show the preview. */
  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec || rec.state !== "recording") return;
    const total = accumulatedMsRef.current + (Date.now() - segmentStartRef.current);
    if (clipTooShort(total)) {
      // Accidental tap: discard entirely, surface why on the idle composer.
      dispatch({ type: "RESET" });
      teardown();
      dispatch({ type: "SHOW_ERROR", error: "Anrejistreman an twò kout." });
      return;
    }
    pauseIntoPreview();
  }, [pauseIntoPreview, teardown]);

  /** RESUME: continue the SAME recording (append speech). */
  const resumeRecording = useCallback(() => {
    if (state.mode !== "preview") return;
    if (!canPauseResume || !recorderRef.current || recorderRef.current.state !== "paused") {
      return; // resume unavailable (browser or finalized clip) — delete/send
    }
    // The old preview blob is stale the moment we continue recording.
    revokePreviewUrl();
    // So is any finalized File cached by an earlier send attempt — the
    // resumed speech must be included in the next finalization.
    fileRef.current = null;
    segmentStartRef.current = Date.now();
    try {
      recorderRef.current.resume();
    } catch {
      dispatch({ type: "RESET" });
      teardown();
      dispatch({ type: "SHOW_ERROR", error: "Nou pa t kapab kontinye anrejistreman an." });
      return;
    }
    setCanResume(false);
    dispatch({ type: "RESUME" });
    if (analyserRef.current) startSampler();
    startSegmentTimer();
  }, [
    state.mode,
    canPauseResume,
    revokePreviewUrl,
    startSampler,
    startSegmentTimer,
    teardown,
  ]);

  /** Cancel from ANY mode: discard the clip and release everything. */
  const cancelAll = useCallback(() => {
    dispatch({ type: "CANCEL" });
    teardown();
    onDiscard?.();
  }, [teardown, onDiscard]);

  /** Finalize the container (stop flushes the trailer) and build the File.
   *  The finalized File is CACHED: retries present the identical instance so
   *  the page maps them to the SAME clientMsgId (no re-upload, no duplicate). */
  const finalizeFile = useCallback(() => {
    return new Promise<File | null>((resolve) => {
      if (fileRef.current) {
        resolve(fileRef.current);
        return;
      }
      const rec = recorderRef.current;
      const build = () => {
        if (chunksRef.current.length === 0 || cancelledRef.current) {
          resolve(null);
          return;
        }
        const blob = new Blob(chunksRef.current, { type: support.mime || "audio/webm" });
        const file = new File([blob], recordingFilename(support.ext), { type: blob.type });
        fileRef.current = file;
        resolve(file);
      };
      setCanResume(false);
      if (!rec || rec.state === "inactive") {
        build();
        return;
      }
      stopHandlerRef.current = build;
      try {
        rec.stop();
      } catch {
        build();
      }
    });
  }, [support.ext, support.mime]);

  /** SEND: only a durable persistence confirmation clears the clip. */
  const sendClip = useCallback(async () => {
    if (state.mode !== "preview") return;
    dispatch({ type: "SEND_START" });
    try {
      const file = await finalizeFile();
      if (!file) {
        dispatch({ type: "SEND_FAIL", error: "Anrejistreman an pa disponib. Eseye anrejistre ankò." });
        return;
      }
      if (clipTooLarge(file.size, maxBytes)) {
        dispatch({ type: "SEND_FAIL", error: "Anrejistreman an twò long — eseye ankò pli kout." });
        return;
      }
      const durationSeconds = Math.max(1, Math.round(state.recordedMs / 1000));
      const ok = await onSend(file, durationSeconds, (fraction) => {
        dispatch({ type: "SEND_PROGRESS", fraction });
      });
      if (cancelledRef.current) return;
      if (ok) {
        dispatch({ type: "SEND_OK" });
        setTimeout(() => {
          if (cancelledRef.current) return;
          dispatch({ type: "SENT_ACK" });
          teardown();
        }, SENT_DISMISS_MS);
      } else {
        // Failed delivery NEVER destroys the recording: rebuild the preview
        // (finalize consumed the recorder) and let the user retry or delete.
        buildPreviewFromChunks();
        dispatch({ type: "SEND_FAIL" });
      }
    } catch {
      if (!cancelledRef.current) dispatch({ type: "SEND_FAIL" });
    }
  }, [state.mode, state.recordedMs, maxBytes, finalizeFile, onSend, buildPreviewFromChunks, teardown]);

  // ── Preview playback controls ────────────────────────────────────────────

  const onPlayPause = useCallback(() => {
    const el = audioElRef.current;
    if (!el || !previewUrl) return;
    if (el.paused) {
      el.play().catch(() => dispatch({ type: "PLAYBACK", playing: false }));
    } else {
      el.pause();
    }
  }, [previewUrl]);

  const onReplay = useCallback(() => {
    const el = audioElRef.current;
    if (!el) return;
    el.currentTime = 0;
    el.play().catch(() => dispatch({ type: "PLAYBACK", playing: false }));
  }, []);

  const durationSeconds = Math.max(0, state.recordedMs / 1000);
  const playingNow = state.mode === "preview" && state.playing && audioElRef.current;
  const displaySeconds = playingNow ? (audioElRef.current?.currentTime ?? durationSeconds) : durationSeconds;

  // ── Render ───────────────────────────────────────────────────────────────

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

  if (state.mode === "idle") {
    return (
      <>
        <button
          type="button"
          className="composer-btn"
          onClick={() => {
            void beginRecording();
          }}
          disabled={disabled}
          aria-label="Anrejistre mesaj vwa"
          title="Anrejistre mesaj vwa"
        >
          <Mic size={20} />
        </button>
        {state.error && <span className="tiny voice-error">{state.error}</span>}
      </>
    );
  }

  if (state.mode === "requesting_permission") {
    return (
      <div className="voice-surface permission" role="status" aria-label="N ap mande pèmèt mikwofòn">
        <span className="voice-spinner" aria-hidden />
        <span className="tiny voice-hint">N ap mande pèmèt mikwofòn…</span>
        <span className="voice-actions">
          <button
            type="button"
            className="composer-btn danger"
            onClick={cancelAll}
            aria-label="Anile demann pèmèt la"
            title="Anile"
          >
            <Trash2 size={18} />
          </button>
        </span>
      </div>
    );
  }

  if (state.mode === "recording") {
    return (
      <div className="voice-surface recording" role="status" aria-label="Anrejistreman an ap fèt">
        <span className="voice-rec-dot" aria-hidden />
        <span className="voice-timer">{formatRecordingDuration(state.recordedMs / 1000)}</span>
        <span className="voice-wave live" aria-hidden>
          {state.bars.length > 0
            ? state.bars.map((b, i) => <span key={i} style={{ height: `${Math.round(b * 100)}%` }} />)
            : Array.from({ length: FLAT_BARS }, (_, i) => (
                <span key={i} className="flat" style={{ height: "22%" }} />
              ))}
        </span>
        <span className="tiny voice-hint">Anrejistre…</span>
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

  // preview | uploading | sent — one cohesive surface
  const uploading = state.mode === "uploading";
  const sent = state.mode === "sent";
  const playedBars = Math.round(state.playbackFraction * state.bars.length);
  return (
    <div
      className={`voice-surface preview${uploading ? " uploading" : ""}${sent ? " sent" : ""}`}
      role="status"
      aria-label={uploading ? "N ap voye mesaj vwa a" : "Apèsevyè mesaj vwa a"}
    >
      {previewUrl && (
        <audio
          ref={audioElRef}
          src={previewUrl}
          preload="metadata"
          hidden
          onPlay={() => dispatch({ type: "PLAYBACK", playing: true })}
          onPause={() => dispatch({ type: "PLAYBACK", playing: false })}
          onEnded={() => dispatch({ type: "PLAYBACK", playing: false, fraction: 0 })}
          onTimeUpdate={() => {
            const el = audioElRef.current;
            if (!el || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return;
            dispatch({
              type: "PLAYBACK",
              playing: !el.paused,
              fraction: Math.max(0, Math.min(1, el.currentTime / durationSeconds)),
            });
          }}
          onError={() => setPreviewPlayable(false)}
        />
      )}
      {!sent && (
        <button
          type="button"
          className="composer-btn"
          onClick={onPlayPause}
          disabled={!previewUrl || !previewPlayable}
          aria-label={state.playing ? "Kanpe lekti a" : "Jwe mesaj vwa a"}
          title={state.playing ? "Kanpe" : "Jwe"}
        >
          {state.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
      )}
      {sent ? (
        <span className="tiny voice-hint" aria-live="polite">
          <Check size={16} aria-hidden style={{ verticalAlign: "-3px" }} /> Voye!
        </span>
      ) : (
        <span className={`voice-wave${state.playing ? " playing" : ""}`} aria-hidden>
          {state.bars.length > 0
            ? state.bars.map((b, i) => (
                <span
                  key={i}
                  className={i < playedBars ? "played" : undefined}
                  style={{ height: `${Math.round(b * 100)}%` }}
                />
              ))
            : Array.from({ length: FLAT_BARS }, (_, i) => (
                <span key={i} className="flat" style={{ height: "22%" }} />
              ))}
        </span>
      )}
      <span className="voice-timer" aria-live="off">
        {formatRecordingDuration(displaySeconds)}
      </span>
      {state.error && !uploading && <span className="tiny voice-error-inline">{state.error}</span>}
      {uploading && (
        <span className="voice-upload" aria-live="polite">
          <span className="tiny">N ap voye… {Math.round(state.uploadProgress * 100)}%</span>
          <span className="upload-bar" aria-hidden>
            <span style={{ width: `${Math.round(state.uploadProgress * 100)}%` }} />
          </span>
        </span>
      )}
      <span className="voice-actions">
        {!uploading && !sent && (
          <>
            <button
              type="button"
              className="composer-btn danger"
              onClick={cancelAll}
              aria-label="Efase mesaj vwa a"
              title="Efase"
            >
              <Trash2 size={18} />
            </button>
            <button
              type="button"
              className="composer-btn"
              onClick={onReplay}
              disabled={!previewUrl || !previewPlayable}
              aria-label="Kòmanse ankò nan kòmansman an"
              title="Kòmanse ankò"
            >
              <RotateCcw size={18} />
            </button>
            {canPauseResume && (
              <button
                type="button"
                className="composer-btn"
                onClick={resumeRecording}
                disabled={!canResume}
                aria-label="Kontinye anrejistreman an"
                title="Kontinye anrejistreman"
              >
                <Mic size={18} />
              </button>
            )}
            <button
              type="button"
              className="composer-btn send"
              onClick={() => {
                void sendClip();
              }}
              aria-label="Voye mesaj vwa a"
              title="Voye"
            >
              <Check size={18} />
            </button>
          </>
        )}
      </span>
    </div>
  );
}
