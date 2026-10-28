/**
 * Session storage helpers.
 *
 * The auth token (which, under the current backend scheme, is the user id)
 * is kept in sessionStorage — NOT localStorage — so that:
 *   - a page refresh restores the session (requirement),
 *   - closing the tab clears it (no long-lived credential on shared
 *     machines, and no stale medical data resurfacing after logout),
 *   - the service worker can stay dumb: it never caches /api responses,
 *     so nothing sensitive is persisted in Cache Storage either.
 *
 * The user profile object is cached alongside only to avoid a flash of an
 * empty shell while GET /api/profile revalidates on load.
 */

const TOKEN_KEY = "medika_session_token";
const USER_KEY = "medika_session_user";

export interface StoredSession {
  token: string;
  user: unknown;
}

export function readSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const token = window.sessionStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const rawUser = window.sessionStorage.getItem(USER_KEY);
    let user: unknown = null;
    if (rawUser) {
      try {
        user = JSON.parse(rawUser);
      } catch {
        user = null;
      }
    }
    return { token, user };
  } catch {
    return null;
  }
}

export function writeSession(token: string, user: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
    window.sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    // Storage full or blocked — session simply won't survive a refresh.
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(USER_KEY);
    // Belt and braces: nothing must resurface after logout.
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
}
