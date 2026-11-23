import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Literata } from "next/font/google";
import { Nav } from "@/components/nav";
import { Providers } from "@/components/providers";
import "./globals.css";

// The grotesque is the interface; the serif is for anything that was spoken.
const ui = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-ui", axes: ["wdth", "opsz"], display: "swap" });
const speech = Literata({ subsets: ["latin"], variable: "--font-speech", style: ["normal", "italic"], display: "swap" });

export const metadata: Metadata = {
  title: "Mago",
  description: "Transcripts for YouTube and TikTok videos and channels.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#17131c" },
    { media: "(prefers-color-scheme: light)", color: "#f3f0f5" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${speech.variable}`} suppressHydrationWarning>
      <body>
        <Providers>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-murex focus:px-3 focus:py-2 focus:text-on-murex">
            Skip to content
          </a>
          <Nav />
          <main id="main" className="mx-auto max-w-[1240px] px-4 pb-28 pt-6 sm:px-6 sm:pb-16 sm:pt-10">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
