/**
 * Secure media URL resolution.
 *
 * New attachments are private: a message's file_url is the opaque API path
 * /api/consultations/{cid}/attachments/{aid}, which is NOT directly
 * renderable. The browser must first obtain a short-lived signed URL through
 * the authenticated API; expired URLs are re-requested.
 *
 * Legacy media (absolute http(s) URLs, /uploads/…, data:, blob:) stays
 * directly renderable — historical compatibility.
 */
import { getAttachmentUrl } from "../api/endpoints";

const ATTACHMENT_PATH_RE = /^\/api\/consultations\/([^/]+)\/attachments\/([^/?#]+)/;

/** Extract (consultationId, attachmentId) from a private API media path. */
export function parseAttachmentPath(fileUrl: string): { consultationId: string; attachmentId: string } | null {
  const m = ATTACHMENT_PATH_RE.exec(fileUrl);
  if (!m) return null;
  return { consultationId: decodeURIComponent(m[1]), attachmentId: decodeURIComponent(m[2]) };
}

/** True when the URL is directly loadable (legacy/public media). */
export function isDirectMediaUrl(fileUrl: string): boolean {
  return /^(https?:|data:|blob:)/i.test(fileUrl) || fileUrl.startsWith("/uploads/");
}

interface CacheEntry {
  url: string;
  /** Expiry in epoch ms, with a safety margin already subtracted. */
  goodUntilMs: number;
}

/** Module-level cache: one signed grant per attachment per session. */
const grantCache = new Map<string, CacheEntry>();

function cacheKey(consultationId: string, attachmentId: string): string {
  return `${consultationId}:${attachmentId}`;
}

export function clearMediaGrantCache(): void {
  grantCache.clear();
}

/** Invalidate one entry (called when a media element reports a load error —
 *  the usual cause is an expired grant) so the next resolve fetches fresh. */
export function invalidateMediaGrant(consultationId: string, attachmentId: string): void {
  grantCache.delete(cacheKey(consultationId, attachmentId));
}

/**
 * Resolve a message file_url into a loadable URL. Private API paths go
 * through the authenticated signed-grant endpoint (cached until shortly
 * before expiry); everything else is returned untouched.
 */
export async function resolveMediaUrl(
  fileUrl: string,
  token: string,
  opts: { signal?: AbortSignal } = {},
): Promise<string> {
  if (isDirectMediaUrl(fileUrl)) return fileUrl;
  const parsed = parseAttachmentPath(fileUrl);
  if (!parsed) return fileUrl; // unknown shape — hand it back untouched

  const key = cacheKey(parsed.consultationId, parsed.attachmentId);
  const cached = grantCache.get(key);
  if (cached && cached.goodUntilMs > Date.now()) return cached.url;

  const grant = await getAttachmentUrl(token, parsed.consultationId, parsed.attachmentId, opts.signal);
  const goodUntilMs = Date.now() + Math.max(1, (grant.expiresIn - 30) * 1000); // 30s safety margin
  grantCache.set(key, { url: grant.url, goodUntilMs });
  return grant.url;
}
