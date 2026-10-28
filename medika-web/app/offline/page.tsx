import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata = { title: "Pa gen koneksyon — Medika" };

export default function OfflinePage() {
  return (
    <div className="auth-wrap">
      <div className="auth-card text-center">
        <div className="empty-icon" style={{ margin: "0 auto 16px", width: 72, height: 72 }}>
          <WifiOff size={30} />
        </div>
        <h1 style={{ fontSize: "1.3rem", marginBottom: 8 }}>Ou pa gen koneksyon</h1>
        <p className="muted" style={{ marginBottom: 20 }}>
          Medika bezwen yon koneksyon entènèt pou w ka gade enfòmasyon medikal ou yo. Enfòmasyon sante yo
          pa janm kenbe nan kachèt sou aparèy ou a.
        </p>
        <Link href="/app" className="btn btn-primary btn-block">
          Eseye ankò
        </Link>
      </div>
    </div>
  );
}
