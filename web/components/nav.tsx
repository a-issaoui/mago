"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { ActivityIcon, LibraryIcon, MoonIcon, SearchIcon, SettingsIcon, SunIcon } from "lucide-react";
import { openPalette } from "@/components/command-palette";
import { useLive } from "@/components/live";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const links = [
  { href: "/", label: "Library", icon: LibraryIcon },
  { href: "/search", label: "Search", icon: SearchIcon },
  { href: "/activity", label: "Activity", icon: ActivityIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Nav() {
  const pathname = usePathname();
  const { snapshot } = useLive();
  const { resolvedTheme, setTheme } = useTheme();
  const busy = (snapshot?.queued ?? 0) + (snapshot?.active.length ?? 0) + (snapshot?.listing.length ?? 0);
  const stopped = (snapshot?.paused.length ?? 0) === 2;
  const all = snapshot ? snapshot.platforms.youtube.total + snapshot.platforms.tiktok.total : 0;
  const finished = snapshot ? snapshot.platforms.youtube.done + snapshot.platforms.tiktok.done + snapshot.platforms.youtube.failed + snapshot.platforms.tiktok.failed : 0;
  const isCurrent = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/c/") || pathname.startsWith("/v/") : pathname.startsWith(href));

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-night/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-3 px-4 sm:gap-5 sm:px-6">
          <Link href="/" className="display text-[26px] text-ink" aria-label="Mago, library">
            Mago
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-0.5 sm:flex">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isCurrent(href) ? "page" : undefined}
                className="flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium text-mute transition-colors hover:text-ink aria-[current=page]:bg-raised aria-[current=page]:text-ink"
              >
                {label}
                {href === "/activity" && busy > 0 && <BusyCount count={busy} stopped={stopped} />}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={openPalette}
            className="ml-auto flex h-9 min-w-0 items-center gap-2 rounded-full border border-line bg-surface/60 pl-3 pr-2 text-sm text-mute transition-colors hover:border-murex/50 hover:text-ink sm:w-64"
            aria-label="Search and commands"
          >
            <SearchIcon className="size-4 shrink-0" />
            <span className="hidden flex-1 truncate text-left sm:block">Search what was said</span>
            <Kbd className="hidden sm:inline-flex">Ctrl K</Kbd>
          </button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-lg" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label="Switch between light and dark" />
              }
            >
              <SunIcon className="hidden size-[18px] dark:block" />
              <MoonIcon className="size-[18px] dark:hidden" />
            </TooltipTrigger>
            <TooltipContent>Light or dark</TooltipContent>
          </Tooltip>
        </div>
        {busy > 0 && all > 0 && !stopped && (
          <div className="absolute inset-x-0 -bottom-px h-0.5" role="progressbar" aria-label="Library transcribed" aria-valuemin={0} aria-valuemax={all} aria-valuenow={finished}>
            <div className="h-full origin-left bg-murex transition-transform duration-700" style={{ transform: `scaleX(${finished / all})` }} />
          </div>
        )}
      </header>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-night/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden"
      >
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isCurrent(href) ? "page" : undefined}
            className="relative flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium text-mute aria-[current=page]:text-murex"
          >
            <Icon className="size-5" />
            {label}
            {href === "/activity" && busy > 0 && (
              <span className="absolute left-1/2 top-1.5 ml-2">
                <BusyCount count={busy} stopped={stopped} />
              </span>
            )}
          </Link>
        ))}
      </nav>
    </>
  );
}

function BusyCount({ count, stopped = false }: { count: number; stopped?: boolean }) {
  return (
    <span
      className={`tabular flex items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-semibold leading-4 ${stopped ? "bg-raised text-mute ring-1 ring-line" : "bg-murex text-on-murex"}`}
      aria-label={stopped ? `${count} waiting, downloads stopped` : `${count} in progress`}
    >
      <span className={`size-1.5 rounded-full bg-current ${stopped ? "" : "live-dot"}`} />
      {count > 999 ? "999+" : count}
    </span>
  );
}
