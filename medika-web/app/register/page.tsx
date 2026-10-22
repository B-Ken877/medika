"use client";

/** Registration screen — web port of RegistrationScreen.kt (patients only). */
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { ApiError } from "@/lib/api/client";
import { ErrorAlert } from "@/components/ui/primitives";

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
    <div className="auth-wrap">
      <div className="auth-card">
        <Link href="/login" className="btn btn-ghost btn-sm mb-2" style={{ alignSelf: "flex-start" }}>
          <ArrowLeft size={16} aria-hidden /> Retour
        </Link>

        <div className="auth-brand">
          <span className="brand-mark" aria-hidden>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z" fill="currentColor" />
            </svg>
          </span>
          <h1>Medika</h1>
        </div>

        <h2 className="text-center" style={{ fontSize: "1.2rem" }}>
          Créer un compte
        </h2>
        <p className="auth-sub">Rejoignez Medika pour accéder à des soins</p>

        <ErrorAlert error={error} />

        <form onSubmit={onSubmit} noValidate>
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

          <div className="grid-2">
            <div className="field">
              <label htmlFor="reg-phone">Téléphone (optionnel)</label>
              <div className="input-with-action">
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
            </div>
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
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            <p className="field-hint">4 caractères minimum (règle du serveur Medika).</p>
          </div>

          <button className="btn btn-primary btn-block btn-lg" type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <span className="spin" aria-hidden /> Création du compte…
              </>
            ) : (
              "Créer mon compte"
            )}
          </button>
        </form>

        <p className="auth-alt">
          Déjà inscrit ? <Link href="/login">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
