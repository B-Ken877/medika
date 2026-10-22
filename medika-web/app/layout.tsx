import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaBootstrap } from "@/components/pwa/PwaBootstrap";
import { AuthProvider } from "@/lib/auth/context";

export const metadata: Metadata = {
  title: "Medika — Santé pour tous, partout",
  description:
    "Medika Haïti : téléconsultation avec des médecins haïtiens — chat, appel vidéo et suivi médical, depuis votre navigateur.",
  applicationName: "Medika",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Medika",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#16A34A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <AuthProvider>
          {children}
          <PwaBootstrap />
        </AuthProvider>
      </body>
    </html>
  );
}
