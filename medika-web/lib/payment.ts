/**
 * MonCash payment flow — web port of the Android PaymentActivity protocol.
 *
 * 1. POST {PAYMENT_SERVER}/api/payment/create  {orderId, amount}
 *      → { success: boolean, redirectUrl: string }
 * 2. The patient completes the MonCash checkout at redirectUrl (opened in a
 *    new tab — it is an external gateway, exactly like the Android WebView).
 * 3. POST {PAYMENT_SERVER}/api/payment/verify  {orderId}
 *      → payment status including transactionId.
 *
 * The payment server itself is not part of this repository; the contract
 * above is taken verbatim from PaymentActivity.kt. All failures surface as
 * PaymentError with user-safe French messages (no backend internals).
 */

export const PAYMENT_BASE_URL = (process.env.NEXT_PUBLIC_PAYMENT_BASE_URL ?? "/payment").replace(/\/+$/, "");

export class PaymentError extends Error {
  readonly stage: "create" | "verify" | "network";
  constructor(stage: PaymentError["stage"], message: string) {
    super(message);
    this.name = "PaymentError";
    this.stage = stage;
  }
}

export interface PaymentOrder {
  orderId: string;
  amount: number;
}

export interface CreatePaymentResult {
  orderId: string;
  amount: number;
  redirectUrl: string;
}

export function buildOrderId(doctorId: string): string {
  return `MC_${Date.now()}_${doctorId}`;
}

async function paymentFetch(path: string, body: unknown, timeoutMs = 20_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${PAYMENT_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new PaymentError("network", "Le serveur de paiement ne répond pas. Réessayez.");
    }
    throw new PaymentError("network", "Connexion au serveur de paiement impossible.");
  }
  clearTimeout(timer);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  // 5xx means the payment backend is unreachable or broken — in production
  // nginx answers 502/504 when the MonCash server is down; locally the
  // Next.js rewrite answers 500. Both are infrastructure failures, not
  // client errors, so they map to the "network" stage.
  if (res.status >= 500) {
    throw new PaymentError("network", "Le serveur de paiement est injoignable. Réessayez plus tard.");
  }
  if (!res.ok) throw new PaymentError("create", "Le paiement n'a pas pu être initialisé. Réessayez.");
  return data;
}

/** Step 1 — create a payment order and receive the MonCash redirect URL. */
export async function createPayment(order: PaymentOrder): Promise<CreatePaymentResult> {
  const data = (await paymentFetch("/api/payment/create", {
    orderId: order.orderId,
    amount: order.amount,
  })) as { success?: boolean; redirectUrl?: string } | null;

  if (!data || data.success !== true || !data.redirectUrl) {
    throw new PaymentError("create", "Le paiement n'a pas pu être initialisé. Réessayez.");
  }
  return { orderId: order.orderId, amount: order.amount, redirectUrl: data.redirectUrl };
}

export interface VerifyPaymentResult {
  success: boolean;
  transactionId: string | null;
}

/** Step 3 — verify the payment after the patient returns from MonCash. */
export async function verifyPayment(orderId: string): Promise<VerifyPaymentResult> {
  const data = (await paymentFetch("/api/payment/verify", { orderId })) as
    | { success?: boolean; payment?: { transactionId?: string }; transactionId?: string }
    | null;

  const transactionId =
    data?.payment?.transactionId ?? data?.transactionId ?? null;
  const success = data?.success === true || Boolean(transactionId && data?.success !== false);
  return { success, transactionId };
}

/** Open the MonCash gateway in a new tab (like the Android WebView step). */
export function openPaymentGateway(redirectUrl: string): boolean {
  if (typeof window === "undefined") return false;
  const win = window.open(redirectUrl, "_blank", "noopener,noreferrer");
  return Boolean(win);
}
