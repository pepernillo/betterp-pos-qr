import type { Metadata } from "next";
import { Manrope } from "next/font/google";

import AppShell from "@/components/AppShell";
import FrontendErrorReporter from "@/components/FrontendErrorReporter";
import WebVitalsReporter from "@/components/WebVitalsReporter";
import { AuthProvider } from "@/components/auth/AuthProvider";
import ThemeInitScript from "@/components/theme/ThemeInitScript";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: {
    default: "BettERP",
    template: "%s | BettERP",
  },
  description:
    "BettERP centraliza operacion, clientes, cobranza, costos, conciliacion y portal cliente en una sola capa.",
  applicationName: "BettERP",
  icons: {
    icon: "/betterp-icon.svg",
    shortcut: "/betterp-icon.svg",
    apple: "/betterp-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${manrope.variable} antialiased`}>
        <ThemeInitScript />
        <ThemeProvider>
          <AuthProvider>
            <FrontendErrorReporter />
            <WebVitalsReporter />
            <AppShell>{children}</AppShell>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
