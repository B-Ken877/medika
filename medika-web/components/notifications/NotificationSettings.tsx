"use client";

/**
 * Notification settings (issue #36, restructured per owner feedback).
 *
 * Everything that is CONFIGURATION — the device push subscription and the
 * per-category delivery preferences — lives here, rendered on the dedicated
 * settings page (/app/settings/notifications). The notification center page
 * stays a pure INBOX: history first, with a single entry point to this
 * component. Copy and honest failure states are unchanged from the original
 * in-page panels (issue #50 health signals preserved).
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/context";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/api/endpoints";
import { enablePush, disablePush, probePushSupport, hasPushSubscription, type PushSupport } from "@/lib/push";

const CATEGORY_LABEL: Record<string, string> = {
  consultations: "Konsiltasyon",
  messages: "Mesaj",
  calls: "Apèl",
  wallet: "Revni",
};

const SUPPORT_COPY: Record<PushSupport, string> = {
  supported: "",
  "unsupported-browser": "Navigatè sa a pa sipòte notifikasyon push.",
  "insecure-context": "Notifikasyon push bezwen yon koneksyon sekirize (HTTPS).",
  "no-service-worker": "Sèvis travay la pa disponib sou aparèy sa a.",
  "no-push-manager": "Navigatè a pa gen jesyon push.",
  denied: "Ou bloke notifikasyon yo nan paramèt navigatè a. Louvri paramèt yo pou pèmèt yo.",
  "server-disabled": "Sèvis push la pa konfigure kounye a — notifikasyon nan aplikasyon an ap kontinye mache.",
  // Issue #50 health signal: server/network failures are distinct from
  // browser limitations — the user (and any report) can tell them apart.
  "server-unreachable":
    "Nou pa t kapab tache ak sèvis notifikasyon yo. Verifye koneksyon ou, epi eseye ankò.",
  "registration-failed":
    "Sèvè a pa t aksepte enskripsyon notifikasyon an. Dekonekte epi konekte ankò, Lè sa a eseye ankò.",
};

export function NotificationSettings() {
  const { token, user } = useAuth();

  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [prefsBusy, setPrefsBusy] = useState(false);

  const [pushSupport] = useState<PushSupport>(() => probePushSupport());
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNotice, setPushNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    getNotificationPreferences(token).then(setPrefs).catch(() => setPrefs(null));
    hasPushSubscription().then(setPushEnabled).catch(() => setPushEnabled(false));
  }, [token]);

  const togglePref = async (key: keyof NotificationPreferences) => {
    if (!token || !prefs || prefsBusy) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefsBusy(true);
    setPrefs(next); // optimistic
    try {
      setPrefs(await updateNotificationPreferences(token, { [key]: next[key] }));
    } catch {
      setPrefs(prefs); // revert on failure
    } finally {
      setPrefsBusy(false);
    }
  };

  const onEnablePush = async () => {
    if (!token || pushBusy) return;
    setPushBusy(true);
    setPushNotice(null);
    const state = await enablePush(token);
    setPushEnabled(state.enabled);
    if (!state.enabled && state.support !== "supported") {
      setPushNotice(SUPPORT_COPY[state.support]);
    }
    setPushBusy(false);
  };

  const onDisablePush = async () => {
    if (!token || pushBusy) return;
    setPushBusy(true);
    setPushNotice(null);
    await disablePush(token);
    setPushEnabled(false);
    setPushBusy(false);
  };

  return (
    <>
      {/* Push subscriptions (explicit user action only) */}
      <section className="panel" aria-labelledby="push-title">
        <div className="panel-head">
          <h2 id="push-title" className="panel-title">
            Notifikasyon push
          </h2>
        </div>
        <div className="panel-row">
          <div className="row-body">
            <div className="row-title">
              <span>Alert sou aparèy ou a</span>
            </div>
            <div className="row-meta">
              {pushSupport === "supported"
                ? pushEnabled
                  ? "Ou ap resevwa notifikasyon push sou aparèy sa a."
                  : "Aktive notifikasyon push pou w konnen le gen yon mizajou, menm lè aplikasyon an fèmen."
                : SUPPORT_COPY[pushSupport]}
            </div>
          </div>
          <div className="row-actions">
            {pushSupport === "supported" && pushEnabled !== null && (
              <button
                className={`btn btn-sm ${pushEnabled ? "btn-secondary" : "btn-primary"}`}
                onClick={pushEnabled ? onDisablePush : onEnablePush}
                disabled={pushBusy}
              >
                {pushEnabled ? "Dezaktive" : "Aktive"}
              </button>
            )}
          </div>
        </div>
        {pushNotice && (
          <div className="alert alert-warning" role="status" style={{ margin: 12 }}>
            {pushNotice}
          </div>
        )}
      </section>

      {/* Category preferences */}
      {prefs && (
        <section className="panel" aria-labelledby="prefs-title">
          <div className="panel-head">
            <h2 id="prefs-title" className="panel-title">
              Preferans
            </h2>
          </div>
          {(["consultations", "messages", "calls", "wallet"] as const).map((key) => (
            <div className="panel-row" key={key}>
              <div className="row-body">
                <div className="row-title">
                  <span>{CATEGORY_LABEL[key]}</span>
                </div>
                <div className="row-meta">
                  {key === "wallet" && user?.role !== "doctor"
                    ? "Pou doktè yo."
                    : "Konnen lè evènman sa yo rive."}
                </div>
              </div>
              <div className="row-actions">
                <button
                  role="switch"
                  className="switch"
                  aria-checked={prefs[key]}
                  aria-label={CATEGORY_LABEL[key]}
                  onClick={() => togglePref(key)}
                  disabled={prefsBusy || (key === "wallet" && user?.role !== "doctor")}
                />
              </div>
            </div>
          ))}
          <p className="tiny muted" style={{ padding: "0 16px 12px" }}>
            Preferans yo sèlman kontròle VWA push la — istwa notifikasyon nan aplikasyon an konsève toujou.
          </p>
        </section>
      )}
    </>
  );
}
