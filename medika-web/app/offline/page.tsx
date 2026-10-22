import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata = { title: "Hors ligne — Medika" };

export default function OfflinePage() {
  return (
    <div className="auth-wrap">
      <div className="auth-card text-center">
        <div className="empty-icon" style={{ margin: "0 auto 16px", width: 72, height: 72 }}>
          <WifiOff size={30} />
        </div>
        <h1 style={{ fontSize: "1.3rem", marginBottom: 8 }}>Vous êtes hors ligne</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          Medika nécessite une connexion internet pour afficher vos données médicales. Les informations de
          santé ne sont jamais mises en cache sur votre appareil.
        </p>
        <Link href="/app" className="btn btn-primary btn-block">
          Réessayer
        </Link>
      </div>
    </div>
  );
}
