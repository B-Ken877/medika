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
  /** Issue #60: when a 409 is about an already-active consultation, the
   * backend includes the winning consultation's id so the UI can link the
   * user straight back to it. Absent for every other error. */
  readonly existingId?: string | null;

  constructor(code: ApiErrorCode, status: number, message: string, detail?: string, existingId?: string | null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.existingId = existingId;
  }
}

/** Haitian Creole, user-safe messages — never expose backend internals. */
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Demand lan pa valab. Verifye enfòmasyon ou antre yo.";
    case 401:
      return "Sesyon ou a fini oswa idantifyan yo pa kòrèk. Tanpri, konekte ankò.";
    case 403:
      return "Ou pa gen otorizasyon pou fè aksyon sa a.";
    case 404:
      return "Nou pa jwenn enfòmasyon sa a.";
    case 409:
      return "Gen yon konfli — enfòmasyon sa a egziste deja.";
    case 413:
      return "Fichye a twò gwo (maksimòm 4 Mo).";
    default:
      return "Sèvis la pa disponib pou kounye a. Tanpri, eseye ankò pita.";
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
      throw new ApiError("aborted", 0, "Demand lan anile.");
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
      throw new ApiError("timeout", 0, "Tan an ekoule. Verifye koneksyon entènèt ou epi eseye ankò.");
    }
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("aborted", 0, "Demand lan anile.");
    }
    throw new ApiError("network", 0, "Pa gen koneksyon entènèt. Verifye koneksyon ou epi eseye ankò.");
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
    const body = data as Record<string, unknown> | null;
    const backendError =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : undefined;
    // Issue #60: one-active-consultation conflicts carry a link back to the
    // existing consultation (existing_id) — surfaced on ApiError.existingId.
    const existingId =
      body && typeof body === "object" && typeof body.existing_id === "string"
        ? body.existing_id
        : undefined;
    throw new ApiError(
      codeForStatus(response.status),
      response.status,
      messageForStatus(response.status),
      backendError,
      existingId,
    );
  }

  // The backend returns `null` for missing consultations.
  return (data === null || data === undefined ? (null as T) : (data as T));
}

export { buildUrl };
