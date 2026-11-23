import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Sora, Source_Serif_4 } from "next/font/google";
import { MobileNav, Screen, Sidebar, Topbar } from "@/components/nav";
import { Providers } from "@/components/providers";
import "./globals.css";

// Four roles: Sora for titles and the wordmark, Geist for the interface, Geist Mono for numbers
// that must line up, and Source Serif for anything that was spoken.
const title = Sora({ subsets: ["latin"], variable: "--font-title", display: "swap" });
const ui = Geist({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const data = Geist_Mono({ subsets: ["latin"], variable: "--font-data", display: "swap" });
const speech = Source_Serif_4({ subsets: ["latin"], variable: "--font-speech", style: ["normal", "italic"], display: "swap" });

export const metadata: Metadata = {
  title: "Mago",
  description: "Transcripts for YouTube and TikTok videos and channels.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#080a12" },
    { media: "(prefers-color-scheme: light)", color: "#f3f5fa" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${title.variable} ${ui.variable} ${data.variable} ${speech.variable}`} suppressHydrationWarning>
      <body>
        <Providers>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-murex focus:px-3 focus:py-2 focus:text-on-murex">
            Skip to content
          </a>
          <Sidebar />
          <div className="lg:pl-64">
            <Topbar />
            <main id="main" className="mx-auto w-full max-w-[1320px] px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-16 lg:pt-8">
              <Screen>{children}</Screen>
            </main>
          </div>
          <MobileNav />
        </Providers>
      </body>
    </html>
  );
}
