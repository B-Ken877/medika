"use client";

/**
 * Registration screen — Clinical Calm redesign.
 * Same split auth layout as the login page; fields grouped into sections.
 * Auth behavior unchanged (patients only, same register() contract).
 */
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, UserPlus } from "lucide-react";
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

export default function RegisterPage() {
  const { register, status } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<"Homme" | "Femme">("Homme");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (status === "authenticated") router.replace("/app");
  }, [status, router]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return; // anti double-submit
    setError(null);

    if (!name.trim() || !username.trim() || !password) {
      setError(new ApiError("validation", 0, "Le nom complet, le nom d'utilisateur et le mot de passe sont requis."));
      return;
    }
    if (password.length < 4) {
      setError(new ApiError("validation", 0, "Le mot de passe doit contenir au moins 4 caractères."));
      return;
    }
    const ageNum = age.trim() === "" ? null : Number(age);
    if (ageNum !== null && (!Number.isFinite(ageNum) || ageNum < 0 || ageNum > 130)) {
      setError(new ApiError("validation", 0, "Âge invalide."));
      return;
    }

    setSubmitting(true);
    try {
      await register({
        username: username.trim(),
        password,
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        age: ageNum,
        gender,
      });
      // Redirect happens via auth status effect.
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
          Créez votre compte pour consulter des médecins et suivre vos soins.
        </p>
      </aside>

      {/* Form panel */}
      <div className="auth-form-pane">
        <div className="auth-mobile-brand">
          <BrandMark />
          <span className="brand-word">Medika</span>
        </div>

        <main className="auth-form" style={{ maxWidth: 440 }}>
          <Link href="/login" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", marginBottom: 14 }}>
            <ArrowLeft size={16} aria-hidden /> Retour
          </Link>

          <h1 className="auth-title">Créer un compte</h1>
          <p className="auth-sub">Rejoignez Medika pour accéder à des soins.</p>

          <ErrorAlert error={error} />

          <form onSubmit={onSubmit} noValidate>
            <fieldset className="form-section" style={{ border: "none" }}>
              <legend className="form-section-title">Informations personnelles</legend>
              <div className="field">
                <label htmlFor="reg-name">Nom complet</label>
                <input
                  id="reg-name"
                  className="input"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Sarah Joseph"
                  required
                  maxLength={120}
                />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="reg-age">Âge (optionnel)</label>
                  <input
                    id="reg-age"
                    className="input"
                    type="number"
                    min={0}
                    max={130}
                    inputMode="numeric"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="Ex: 28"
                  />
                </div>
                <div className="field">
                  <label htmlFor="reg-gender">Genre</label>
                  <select
                    id="reg-gender"
                    className="select"
                    value={gender}
                    onChange={(e) => setGender(e.target.value as "Homme" | "Femme")}
                  >
                    <option value="Homme">Homme</option>
                    <option value="Femme">Femme</option>
                  </select>
                </div>
              </div>
            </fieldset>

            <fieldset className="form-section" style={{ border: "none" }}>
              <legend className="form-section-title">Coordonnées</legend>
              <div className="field">
                <label htmlFor="reg-email">Email (optionnel)</label>
                <input
                  id="reg-email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@exemple.com"
                  maxLength={150}
                />
              </div>
              <div className="field">
                <label htmlFor="reg-phone">Téléphone (optionnel)</label>
                <input
                  id="reg-phone"
                  className="input"
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="509 XX XX XX XX"
                  maxLength={20}
                />
              </div>
            </fieldset>

            <fieldset className="form-section" style={{ border: "none" }}>
              <legend className="form-section-title">Sécurité</legend>
              <div className="field">
                <label htmlFor="reg-username">Nom d&apos;utilisateur</label>
                <input
                  id="reg-username"
                  className="input"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Ex: sarah.j"
                  required
                  maxLength={60}
                />
              </div>
              <div className="field">
                <label htmlFor="reg-password">Mot de passe</label>
                <div className="input-with-action">
                  <input
                    id="reg-password"
                    className="input"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Au moins 4 caractères"
                    required
                    minLength={4}
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
                <p className="field-hint">4 caractères minimum (règle du serveur Medika).</p>
              </div>
            </fieldset>

            <button className="btn btn-primary auth-submit" type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spin" aria-hidden /> Création du compte…
                </>
              ) : (
                <>
                  <UserPlus size={16} aria-hidden /> Créer mon compte
                </>
              )}
            </button>
          </form>

          <p className="auth-alt">
            Déjà inscrit ? <Link href="/login">Se connecter</Link>
          </p>
        </main>
      </div>
    </div>
  );
}
