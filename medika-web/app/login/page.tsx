"use client";

/**
 * Medika login — institutional clinical design.
 * Keeps the existing authentication contract and redirect behavior intact.
 */
import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CalendarCheck,
  Eye,
  EyeOff,
  LockKeyhole,
  Smartphone,
  Stethoscope,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { ApiError } from "@/lib/api/client";
import { ErrorAlert } from "@/components/ui/primitives";

function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span className="brand-mark auth-brand-mark" aria-hidden="true" style={{ width: size, height: size }}>
      <svg width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z" fill="currentColor" />
      </svg>
    </span>
  );
}

function LoginForm() {
  const { login, status } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/app";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, router, next]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!username.trim() || !password) {
      setError(new ApiError("validation", 0, "Tanpri, antre non itilizatè ou a ak modpas ou."));
      return;
    }

    setSubmitting(true);
    try {
      await login(username.trim(), password);
      // Redirect happens via the existing auth status effect.
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "unauthorized"
          ? new ApiError("unauthorized", 401, "Non itilizatè a oswa modpas la pa kòrèk.")
          : err instanceof ApiError && err.code === "network"
            ? new ApiError("network", 0, "Nou pa t kapab konekte w. Tanpri, eseye ankò.")
            : err,
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell auth-login-shell">
      <aside className="auth-brand-pane">
        <div className="auth-brand-logo">
          <BrandMark size={44} />
          <span className="auth-brand-word-stack">
            <span className="brand-word">Medika</span>
            <span className="auth-brand-tagline">Klinik. Telemedsin. Pi pre.</span>
          </span>
        </div>

        <div className="auth-brand-message">
          <span className="auth-overline">SWEN SANTE, PI PRE W</span>
          <h2 className="auth-brand-title">Swen sante.<br />Pi pre w.</h2>
          <p className="auth-brand-sub">
            Konekte ak swen medikal pi fasil, kote w ye a.
          </p>
        </div>

        <div className="auth-brand-highlights" role="list" aria-label="Sa Medika ofri">
          <div className="auth-feature" role="listitem">
            <span className="auth-feature-icon"><Stethoscope size={20} aria-hidden="true" /></span>
            <span className="auth-feature-copy">
              <strong>Konsiltasyon sou entènèt</strong>
              <span>Pale ak yon pwofesyonèl sante san w pa deplase.</span>
            </span>
          </div>
          <div className="auth-feature" role="listitem">
            <span className="auth-feature-icon"><CalendarCheck size={20} aria-hidden="true" /></span>
            <span className="auth-feature-copy">
              <strong>Swiv etap swen ou</strong>
              <span>Jere konsiltasyon ou yo dirèkteman nan kont ou.</span>
            </span>
          </div>
          <div className="auth-feature" role="listitem">
            <span className="auth-feature-icon"><Smartphone size={20} aria-hidden="true" /></span>
            <span className="auth-feature-copy">
              <strong>Sou aparèy ou itilize chak jou</strong>
              <span>Konekte depi telefòn ou oswa òdinatè ou.</span>
            </span>
          </div>
        </div>

        <p className="auth-brand-footer">
          <span className="auth-brand-footer-rule" />
          Medika — swen sante pi pre w.
        </p>
      </aside>

      <header className="auth-mobile-brand">
        <BrandMark size={38} />
        <span className="auth-brand-word-stack">
          <span className="brand-word">Medika</span>
          <span className="auth-brand-tagline">Klinik. Telemedsin. Pi pre.</span>
        </span>
      </header>

      <section className="auth-form-pane" aria-labelledby="login-title">
        <main className="auth-form">
          <div className="auth-form-topline">
            <span className="auth-context-pill">KONT PASYAN</span>
            <Link href="/register" className="auth-register-link">
              Pa gen kont? Enskri <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>

          <div className="auth-form-heading">
            <h1 className="auth-title" id="login-title">Kontan wè w ankò</h1>
            <p className="auth-sub">Antre nan kont Medika ou pou w kontinye.</p>
          </div>

          <ErrorAlert error={error} />

          <form onSubmit={onSubmit} noValidate>
            <div className="field auth-field">
              <label htmlFor="username">Non itilizatè oswa imèl</label>
              <div className="auth-input-wrap">
                <UserRound className="auth-input-icon" size={18} aria-hidden="true" />
                <input
                  id="username"
                  className="input auth-input"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Antre non itilizatè ou oswa imèl"
                  required
                  maxLength={100}
                />
              </div>
            </div>

            <div className="field auth-field">
              <label htmlFor="password">Modpas</label>
              <div className="auth-input-wrap auth-password-wrap">
                <LockKeyhole className="auth-input-icon" size={18} aria-hidden="true" />
                <input
                  id="password"
                  className="input auth-input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Antre modpas ou"
                  required
                  maxLength={200}
                />
                <button
                  type="button"
                  className="toggle-btn auth-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Kache modpas la" : "Montre modpas la"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button className="btn btn-primary auth-submit" type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spin" aria-hidden="true" /> N ap konekte w...
                </>
              ) : (
                <>
                  Konekte <ArrowRight size={17} aria-hidden="true" />
                </>
              )}
            </button>
          </form>

          <p className="auth-footnote">
            <LockKeyhole size={14} aria-hidden="true" />
            <span>Pa pataje modpas ou ak lòt moun.</span>
          </p>
        </main>

        <footer className="auth-form-footer">
          <span>Medika</span>
          <span>Swen sante pi pre w.</span>
        </footer>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="auth-login-loading" role="status">N ap chaje Medika...</div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
