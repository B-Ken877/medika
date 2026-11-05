"use client";

import type { ReactNode } from "react";
import { SocketProvider } from "@/lib/ws/socket-context";
import { AppShell } from "@/components/layout/AppShell";
// Issue #99: patient-app "Premium Mint" visual system. Scoped entirely under
// .app-shell (loaded only for /app routes, after globals + visual-polish);
// declares no :root tokens — see the file header and brand-palette tests.
import "@/app/patient-theme.css";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SocketProvider>
      <AppShell>{children}</AppShell>
    </SocketProvider>
  );
}
