import "./styles.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

// Self-hosted at build time by next/font (no runtime request to Google).
const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = { title: "Sakuna AI", description: "Your personal life operating system" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0d1110" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={inter.variable}><body>{children}</body></html>;
}
