import "./theme.css";
import "./styles.css";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

// Inter (SIL Open Font License, see app/fonts/LICENSE.txt), bundled in the repo so builds never need to reach Google Fonts.
const inter = localFont({ src: "./fonts/InterVariable.woff2", variable: "--font-sans", display: "swap", weight: "100 900" });

export const metadata: Metadata = { title: "Sakuna AI", description: "Your personal life operating system" };
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f6f8f7" }, { media: "(prefers-color-scheme: dark)", color: "#0d1110" }],
};

// Applies the saved theme before first paint, so there is no flash of the wrong theme.
const themeBoot = `try{var t=localStorage.getItem("sakuna-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={inter.variable} suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: themeBoot }}/></head>
    <body>{children}</body>
  </html>;
}
