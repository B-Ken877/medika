"use client";

/**
 * Login screen — Clinical Calm redesign.
 * Split layout on desktop (brand panel + form panel), single column on mobile.
 * Auth behavior unchanged: username + password via useAuth().login().
 */
import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { ApiError } from "@/lib/api/client";
import { ErrorAlert } from "@/components/ui/primitives";

function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span className="brand-mark" aria-hidden style={{ width: size, height: size }}>
      <svg width={Math.round(size * 0.56)} height={Math.round(size * 0.56)} viewBox="0 0 24 24" fill="none" aria-hidden>
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
    if (submitting) return; // anti double-submit
    setError(null);
    if (!username.trim() || !password) {
      setError(new ApiError("validation", 0, "Renseignez votre nom d'utilisateur et votre mot de passe."));
      return;
    }
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      // Redirect happens via the auth status effect.
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell">
      {/* Brand panel — desktop only */}
      <aside className="auth-brand-pane" aria-hidden>
        <div className="auth-brand-logo">
          <BrandMark />
          <span className="brand-word">Medika</span>
        </div>
        <h2 className="auth-brand-title">Votre santé, plus proche de vous.</h2>
        <p className="auth-brand-sub">
          Accédez à vos consultations et suivez votre parcours de soins en toute simplicité.
        </p>
      </aside>

      {/* Form panel */}
      <div className="auth-form-pane">
        <div className="auth-mobile-brand">
          <BrandMark />
          <span className="brand-word">Medika</span>
        </div>

        <main className="auth-form">
          <h1 className="auth-title">Bon retour</h1>
          <p className="auth-sub">Connectez-vous à votre espace Medika.</p>

          <ErrorAlert error={error} />

          <form onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="username">Nom d&apos;utilisateur</label>
              <input
                id="username"
                className="input"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Nom d'utilisateur ou email"
                required
                maxLength={100}
              />
            </div>

            <div className="field">
              <label htmlFor="password">Mot de passe</label>
              <div className="input-with-action">
                <input
                  id="password"
                  className="input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mot de passe"
                  required
                  maxLength={200}
                />
                <button
                  type="button"
                  className="toggle-btn"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Cacher le mot de passe" : "Montrer le mot de passe"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button className="btn btn-primary auth-submit" type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spin" aria-hidden /> Connexion…
                </>
              ) : (
                <>
                  <Lock size={16} aria-hidden /> Se connecter
                </>
              )}
            </button>
          </form>

          <p className="auth-alt">
            Pas encore de compte ? <Link href="/register">Créer un compte</Link>
          </p>
          <p className="auth-note">Connexion sécurisée · Chiffrement TLS</p>
        </main>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>Chargement…</div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
