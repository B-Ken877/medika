import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./visual-polish.css";
import { PwaBootstrap } from "@/components/pwa/PwaBootstrap";
import { AuthProvider } from "@/lib/auth/context";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Medika — Swen sante ann Ayiti",
  description:
    "Medika ede w jwenn doktè ann Ayiti pou konsiltasyon, swivi medikal ak echanj anliy.",
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
  themeColor: "#145b50",
  /**
   * Issue #47 — keep the chat header visible while the Android keyboard is
   * open. Without this directive, Chrome on Android (108+) defaults to
   * `interactive-widget=resizes-visual`: opening the keyboard does NOT shrink
   * the layout viewport, so the full-height chat column (100dvh) keeps the
   * composer anchored behind the keyboard and Chrome pans the visual viewport
   * up to reveal the focused input — pushing the conversation header (and the
   * partner's name) out of view. `resizes-content` shrinks the layout viewport
   * instead: the header stays at the top, the composer sits immediately above
   * the keyboard, and only the message history (flex-1, overflow-y: auto)
   * resizes/scrolls. Browsers that do not support the directive ignore it and
   * keep their current behavior.
   */
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ht" className={inter.variable}>
      <body>
        <AuthProvider>
          {children}
          <PwaBootstrap />
        </AuthProvider>
      </body>
    </html>
  );
}
