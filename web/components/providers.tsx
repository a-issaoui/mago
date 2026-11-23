"use client";

import { ThemeProvider } from "next-themes";
import { CommandPalette } from "@/components/command-palette";
import { LiveProvider } from "@/components/live";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="mago-theme" disableTransitionOnChange>
      <TooltipProvider delay={300}>
        <LiveProvider>
          {children}
          <CommandPalette />
        </LiveProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </TooltipProvider>
    </ThemeProvider>
  );
}
