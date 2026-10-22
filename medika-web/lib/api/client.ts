/**
 * Typed fetch client for the Medika backend REST API.
 *
 * - Base URL is configurable via NEXT_PUBLIC_API_BASE_URL (empty = same
 *   origin, which is the production setup: nginx proxies /api to the
 *   backend container).
 * - Every request supports a timeout via AbortController.
 * - Errors are normalized to ApiError so UI code never leaks backend
 *   internals (no raw stack traces, no server file paths) to end users.
 */

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");

export type ApiErrorCode =
  | "network"
  | "timeout"
  | "aborted"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "server"
  | "parse"
  | "unknown";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Machine-readable backend error string, safe to log client-side. */
  readonly detail?: string;

  constructor(code: ApiErrorCode, status: number, message: string, detail?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** French, user-safe messages — never expose backend internals. */
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Requête invalide. Vérifiez les informations saisies.";
    case 401:
      return "Session expirée ou identifiants incorrects. Reconnectez-vous.";
    case 403:
      return "Vous n'avez pas les droits pour effectuer cette action.";
    case 404:
      return "Ressource introuvable.";
    case 409:
      return "Cette ressource existe déjà.";
    case 413:
      return "Fichier trop volumineux (max 4 Mo).";
    default:
      return "Le serveur est momentanément indisponible. Réessayez plus tard.";
  }
}

function codeForStatus(status: number): ApiErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400) return "validation";
  if (status === 409) return "conflict";
  return "server";
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  /** Request body — plain objects are JSON-encoded; FormData passes through. */
  body?: unknown;
  /** Bearer token. When omitted the request is anonymous. */
  token?: string | null;
  /** Per-request timeout in ms (default 20s). */
  timeoutMs?: number;
  /** AbortSignal from the caller (page navigation, component unmount…). */
  signal?: AbortSignal | null;
  /** URL query string parameters. */
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_BASE_URL}${cleanPath}`;
  if (!params) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    token,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: callerSignal,
    params,
    headers: extraHeaders,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);

  // Forward caller aborts to our controller.
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timer);
      throw new ApiError("aborted", 0, "Requête annulée.");
    }
    callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  const headers: Record<string, string> = {
    ...(body !== undefined && !(body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  };

  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), {
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? (body as FormData)
            : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError("timeout", 0, "Délai dépassé. Vérifiez votre connexion et réessayez.");
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("aborted", 0, "Requête annulée.");
    }
    throw new ApiError("network", 0, "Connexion au serveur impossible. Vérifiez votre accès internet.");
  }
  clearTimeout(timer);
  callerSignal?.removeEventListener("abort", onCallerAbort);

  // 204 / empty body
  if (response.status === 204) return undefined as T;

  const rawText = await response.text();
  let data: unknown = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = rawText;
    }
  }

  if (!response.ok) {
    const backendError =
      data && typeof data === "object" && "error" in (data as Record<string, unknown>)
        ? String((data as Record<string, unknown>).error)
        : undefined;
    throw new ApiError(
      codeForStatus(response.status),
      response.status,
      messageForStatus(response.status),
      backendError,
    );
  }

  // The backend returns `null` for missing consultations.
  return (data === null || data === undefined ? (null as T) : (data as T));
}

export { buildUrl };
