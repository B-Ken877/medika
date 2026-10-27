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
      setError(new ApiError("validation", 0, "Tanpri, mete non konplè ou, non itilizatè ou a ak modpas ou."));
      return;
    }
    if (password.length < 4) {
      setError(new ApiError("validation", 0, "Modpas la dwe gen omwen 4 karaktè."));
      return;
    }
    const ageNum = age.trim() === "" ? null : Number(age);
    if (ageNum !== null && (!Number.isFinite(ageNum) || ageNum < 0 || ageNum > 130)) {
      setError(new ApiError("validation", 0, "Laj la pa valab."));
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
      setError(
        err instanceof ApiError && err.code === "conflict"
          ? new ApiError("conflict", 409, "Gen yon kont ki deja itilize adrès imèl sa a.")
          : err,
      );
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-shell auth-register-shell">
      {/* Brand panel — desktop only */}
      <aside className="auth-brand-pane" aria-hidden>
        <div className="auth-brand-logo">
          <BrandMark />
          <span className="brand-word">Medika</span>
        </div>
        <h2 className="auth-brand-title">Sante w, tout prè ou.</h2>
        <p className="auth-brand-sub">
          Kreye kont ou pou w ka jwenn swen sante pi fasil.
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
            <ArrowLeft size={16} aria-hidden /> Retounen
          </Link>

          <h1 className="auth-title">Kreye kont Medika ou</h1>
          <p className="auth-sub">Kreye kont ou pou w ka jwenn swen sante pi fasil.</p>

          <ErrorAlert error={error} />

          <form onSubmit={onSubmit} noValidate>
            <fieldset className="form-section" style={{ border: "none" }}>
              <legend className="form-section-title">Enfòmasyon pèsonèl</legend>
              <div className="field">
                <label htmlFor="reg-name">Non konplè</label>
                <input
                  id="reg-name"
                  className="input"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Egzanp: Sarah Joseph"
                  required
                  maxLength={120}
                />
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="reg-age">Laj (opsyonèl)</label>
                  <input
                    id="reg-age"
                    className="input"
                    type="number"
                    min={0}
                    max={130}
                    inputMode="numeric"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="Egzanp: 28"
                  />
                </div>
                <div className="field">
                  <label htmlFor="reg-gender">Sèks</label>
                  <select
                    id="reg-gender"
                    className="select"
                    value={gender}
                    onChange={(e) => setGender(e.target.value as "Homme" | "Femme")}
                  >
                    <option value="Homme">Gason</option>
                    <option value="Femme">Fi</option>
                  </select>
                </div>
              </div>
            </fieldset>

            <fieldset className="form-section" style={{ border: "none" }}>
              <legend className="form-section-title">Kontakte w</legend>
              <div className="field">
                <label htmlFor="reg-email">Imèl (opsyonèl)</label>
                <input
                  id="reg-email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ou@egzanp.com"
                  maxLength={150}
                />
              </div>
              <div className="field">
                <label htmlFor="reg-phone">Nimewo telefòn (opsyonèl)</label>
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
              <legend className="form-section-title">Sekirite</legend>
              <div className="field">
                <label htmlFor="reg-username">Non itilizatè</label>
                <input
                  id="reg-username"
                  className="input"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Egzanp: sarah.j"
                  required
                  maxLength={60}
                />
              </div>
              <div className="field">
                <label htmlFor="reg-password">Modpas</label>
                <div className="input-with-action">
                  <input
                    id="reg-password"
                    className="input"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Omwen 4 karaktè"
                    required
                    minLength={4}
                    maxLength={200}
                  />
                  <button
                    type="button"
                    className="toggle-btn"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Kache modpas la" : "Montre modpas la"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p className="field-hint">Omwen 4 karaktè (règ sèvis Medika la).</p>
              </div>
            </fieldset>

            <button className="btn btn-primary auth-submit" type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spin" aria-hidden /> N ap kreye kont ou...
                </>
              ) : (
                <>
                  <UserPlus size={16} aria-hidden /> Kreye kont
                </>
              )}
            </button>
          </form>

          <p className="auth-alt">
            Ou deja gen yon kont? <Link href="/login">Konekte</Link>
          </p>
        </main>
      </div>
    </div>
  );
}
