"use client";

import type { ReactNode } from "react";
import { SocketProvider } from "@/lib/ws/socket-context";
import { AppShell } from "@/components/layout/AppShell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SocketProvider>
      <AppShell>{children}</AppShell>
    </SocketProvider>
  );
}
