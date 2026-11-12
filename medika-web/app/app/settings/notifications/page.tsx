"use client";

/**
 * Dedicated notification-settings page (owner request: "the setting should
 * be on a specific page").
 *
 * Previously the push-subscription panel and the category preferences sat
 * ABOVE the notification history on /app/notifications, so every visit to
 * the notification center started with settings instead of notifications.
 * Now configuration lives HERE, on its own page, and the notification
 * center is a pure inbox (history first) that links over with one button.
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NotificationSettings } from "@/components/notifications/NotificationSettings";

export default function NotificationSettingsPage() {
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="page-title">Paramèt notifikasyon</h1>
          <p className="page-desc">
            Kontwòle ki jan Medika ap fè w konnen — push sou aparèy ou a ak kategori yo.
          </p>
        </div>
        <div className="page-head-actions">
          <Link href="/app/notifications" className="btn btn-secondary btn-sm">
            <ArrowLeft size={14} aria-hidden /> Retounen
          </Link>
        </div>
      </div>

      <NotificationSettings />

      <p className="tiny muted text-center">
        Istwa notifikasyon nan aplikasyon an konsève toujou — paramèt yo pa ka efase istorik la.
        Gade <Link href="/app/profile">pwofil ou</Link> pou enfòmasyon prive.
      </p>
    </div>
  );
}
