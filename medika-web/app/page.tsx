"use client";

/** Landing entry: routes authenticated users into the app, others to login. */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { Spinner } from "@/components/ui/primitives";

export default function HomePage() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace("/app");
    else if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  return (
    <div style={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>
      <Spinner label="Medika — Swen sante pou tout moun, tout kote" />
    </div>
  );
}
