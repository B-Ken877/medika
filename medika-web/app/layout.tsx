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
  themeColor: "#23452E",
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
