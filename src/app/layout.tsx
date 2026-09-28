import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SAPA Clinic Management System", template: "%s · SAPA Clinic" },
  description: "Secure clinic management for registration, clinical care, pharmacy, billing, and audit.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/branding/logo.svg" },
  applicationName: "SAPA Clinic",
};

export const viewport: Viewport = {
  themeColor: "#0B2C4A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&family=Literata:opsz,wght@7..72,620;7..72,700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
