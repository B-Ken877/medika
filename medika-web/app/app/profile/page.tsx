"use client";

/**
 * Profile — port of ProfileScreen.kt.
 * Patients and doctors edit the shared fields (name, email, phone, age,
 * gender) via PUT /api/profile. Doctor credential fields (specialty,
 * license, hospital, biography) are read-only: only the admin panel can
 * manage them, mirroring the backend's authorization model.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Award, Check, MapPin, Save, Stethoscope, User } from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { updateProfile, uploadFile } from "@/lib/api/endpoints";
import type { User as UserType } from "@/lib/api/types";
import { ApiError } from "@/lib/api/client";
import { genderLabel } from "@/lib/format";
import { Avatar, ErrorAlert, Spinner } from "@/components/ui/primitives";

export default function ProfilePage() {
  const { user, token, setUser, logout } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("Homme");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    if (!user) return;
    setName(user.name ?? "");
    setEmail(user.email ?? "");
    setPhone(user.phone ?? "");
    setAge(user.age != null ? String(user.age) : "");
    setGender(user.gender ?? "Homme");
  }, [user]);

  if (!user || !token) return <Spinner label="Chargement du profil…" />;

  const isDoctor = user.role === "doctor";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return; // anti double-submit
    if (!name.trim()) {
      setError(new ApiError("validation", 0, "Le nom ne peut pas être vide."));
      return;
    }
    const ageNum = age.trim() === "" ? undefined : Number(age);
    if (ageNum !== undefined && (!Number.isFinite(ageNum) || ageNum < 0 || ageNum > 130)) {
      setError(new ApiError("validation", 0, "Âge invalide."));
      return;
    }
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateProfile(token, {
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        age: ageNum,
        gender,
      });
      setUser(updated as UserType);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onAvatarPicked = async (file: File | undefined) => {
    if (!file || !token || uploadingAvatar) return;
    setUploadingAvatar(true);
    setError(null);
    try {
      const up = await uploadFile(token, file);
      // The backend stores the avatar on the user record via profile update:
      // PUT /api/profile only accepts the shared fields, and the Android app
      // uploads then relies on the same flow. We re-fetch the profile to
      // reflect whatever the server stored.
      const controller = new AbortController();
      const { getProfile } = await import("@/lib/api/endpoints");
      const fresh = await getProfile(token, controller.signal);
      setUser(fresh);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Envoi de la photo impossible.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 640, margin: "0 auto" }}>
      <div>
        <h1 className="page-title">Mon profil</h1>
        <p className="muted small">
          {isDoctor ? "Espace médecin" : "Espace patient"} · @{user.username}
        </p>
      </div>

      <div className="card flex" style={{ gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <Avatar name={user.name} src={user.avatar_url} size="lg" alt={`Avatar de ${user.name}`} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <strong style={{ fontSize: "1.05rem" }}>{user.name}</strong>
          <div className="small muted">{isDoctor ? user.specialty ?? "Médecine générale" : "Patient Medika"}</div>
          {isDoctor && user.hospital && (
            <div className="tiny muted flex mt-1" style={{ gap: 4 }}>
              <MapPin size={12} aria-hidden /> {user.hospital}
            </div>
          )}
          {isDoctor && user.license_number && (
            <div className="tiny muted flex mt-1" style={{ gap: 4 }}>
              <Award size={12} aria-hidden /> Licence MSPP : {user.license_number}
            </div>
          )}
        </div>
        <label className="btn btn-secondary btn-sm" style={{ cursor: uploadingAvatar ? "wait" : "pointer" }}>
          {uploadingAvatar ? "Envoi…" : "Changer la photo"}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => onAvatarPicked(e.target.files?.[0])}
            disabled={uploadingAvatar}
          />
        </label>
      </div>

      {isDoctor && (
        <div className="card" aria-label="Informations professionnelles (lecture seule)">
          <h2 className="section-title flex" style={{ gap: 8 }}>
            <Stethoscope size={16} color="var(--green-700)" aria-hidden /> Informations professionnelles
          </h2>
          <div className="stack small" style={{ gap: 6 }}>
            <p>
              <strong>Spécialité :</strong> {user.specialty ?? "—"}
            </p>
            <p>
              <strong>Hôpital :</strong> {user.hospital ?? "—"}
            </p>
            <p>
              <strong>Licence MSPP :</strong> {user.license_number ?? "—"}
            </p>
            <p>
              <strong>Localisation :</strong> {user.location ?? "—"}
            </p>
            {user.biography && (
              <p>
                <strong>Biographie :</strong> {user.biography}
              </p>
            )}
          </div>
          <p className="tiny muted mt-1">
            Ces informations sont gérées par l&apos;administration Medika. Contactez le support pour toute
            modification.
          </p>
        </div>
      )}

      <ErrorAlert error={error} />

      <form onSubmit={onSubmit} className="card stack">
        <div className="field">
          <label htmlFor="p-name">Nom complet</label>
          <input
            id="p-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="p-email">Email</label>
          <input
            id="p-email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={150}
            placeholder="vous@exemple.com"
          />
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="p-phone">Téléphone</label>
            <input
              id="p-phone"
              className="input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={20}
              placeholder="509 XX XX XX XX"
            />
          </div>
          <div className="field">
            <label htmlFor="p-age">Âge</label>
            <input
              id="p-age"
              className="input"
              type="number"
              min={0}
              max={130}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="Ex : 28"
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="p-gender">Genre</label>
          <select id="p-gender" className="select" value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="Homme">Homme</option>
            <option value="Femme">Femme</option>
          </select>
        </div>

        <div className="flex" style={{ gap: 10 }}>
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <span className="spin" aria-hidden /> Enregistrement…
              </>
            ) : (
              <>
                <Save size={15} aria-hidden /> Enregistrer
              </>
            )}
          </button>
          {saved && (
            <span className="badge badge-green flex" style={{ alignSelf: "center", gap: 4 }} role="status">
              <Check size={12} aria-hidden /> Profil mis à jour
            </span>
          )}
        </div>
      </form>

      <div className="card">
        <div className="flex-between">
          <div>
            <strong className="flex" style={{ gap: 8 }}>
              <User size={16} color="var(--green-700)" aria-hidden /> Session
            </strong>
            <p className="tiny muted mt-1">
              Votre session est conservée dans cet onglet uniquement — fermé l&apos;onglet vous déconnecte.
            </p>
          </div>
          <button
            className="btn btn-outline-danger btn-sm"
            onClick={() => {
              logout();
              router.replace("/login");
            }}
          >
            Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
