/**
 * Waveform helpers for PLAYED-BACK voice messages (issue #18).
 *
 * Sent voice messages carry no amplitude data server-side, so the audio
 * bubble renders a DETERMINISTIC pseudo-waveform: a seeded PRNG keyed by a
 * stable message identifier. The same message always renders the exact same
 * bars (no flicker across re-renders / reconnects), different messages get
 * different shapes, and the envelope keeps it speech-like rather than random
 * noise: quieter edges, livelier middle.
 */

/** FNV-1a 32-bit — stable string hash for seeding. */
export function hashSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — tiny, well-distributed seeded PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic amplitude history (0..1, fixed length) for one message. */
export function synthesizedBars(key: string, count = 44): number[] {
  const rnd = mulberry32(hashSeed(key));
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    // Center-weighted envelope: quiet lead-in/out, energy in the middle —
    // reads as speech, not static.
    const edge = Math.sin((Math.PI * (i + 0.5)) / count);
    const level = 0.26 + 0.74 * rnd();
    out.push(Math.max(0.16, Math.min(1, level * (0.52 + 0.48 * edge) + 0.14 * edge)));
  }
  return out;
}
