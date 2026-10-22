"use client";

/** Login screen — faithful web port of AuthScreen.kt. */
import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Lock, User } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { ApiError } from "@/lib/api/client";
import { ErrorAlert } from "@/components/ui/primitives";

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
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z" fill="currentColor" />
            </svg>
          </span>
          <h1>Medika</h1>
          <div className="auth-tagline">Soins. Partout. Pour tous.</div>
        </div>

        <h2 className="text-center" style={{ fontSize: "1.2rem" }}>
          Connexion
        </h2>
        <p className="auth-sub">Accédez à votre espace de santé</p>

        <ErrorAlert error={error} />

        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="username">Nom d&apos;utilisateur</label>
            <div className="input-with-action">
              <User size={17} className="sr-only" aria-hidden />
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
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <span className="spin" aria-hidden /> Connexion en cours…
              </>
            ) : (
              <>
                <Lock size={16} aria-hidden /> Se connecter
              </>
            )}
          </button>
        </form>

        <p className="auth-alt">
          Pas de compte ?{" "}
          <Link href="/register">Créer un compte</Link>
        </p>
        <p className="tiny muted text-center mt-1">Connexion sécurisée · Chiffrement TLS</p>
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
