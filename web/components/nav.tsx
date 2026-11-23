"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GearIcon, LibraryIcon, QueueIcon, SearchIcon, SunMoonIcon } from "@/components/icons";
import { useLive } from "@/components/live";

const links = [
  { href: "/", label: "Library", icon: LibraryIcon },
  { href: "/search", label: "Search", icon: SearchIcon },
  { href: "/activity", label: "Activity", icon: QueueIcon },
  { href: "/settings", label: "Settings", icon: GearIcon },
];

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try {
    localStorage.setItem("mago-theme", root.dataset.theme);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
}

export function Nav() {
  const pathname = usePathname();
  const { snapshot } = useLive();
  const busy = (snapshot?.queued ?? 0) + (snapshot?.active.length ?? 0) + (snapshot?.listing.length ?? 0);
  const all = snapshot ? snapshot.platforms.youtube.total + snapshot.platforms.tiktok.total : 0;
  const finished = snapshot ? snapshot.platforms.youtube.done + snapshot.platforms.tiktok.done + snapshot.platforms.youtube.failed + snapshot.platforms.tiktok.failed : 0;
  const isCurrent = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/c/") || pathname.startsWith("/v/") : pathname.startsWith(href));

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-night/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="display text-[26px] text-ink" aria-label="Mago, library">
            Mago
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isCurrent(href) ? "page" : undefined}
                className="flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium text-mute hover:text-ink aria-[current=page]:bg-raised aria-[current=page]:text-ink"
              >
                {label}
                {href === "/activity" && busy > 0 && <BusyCount count={busy} stopped={(snapshot?.paused.length ?? 0) === 2} />}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={toggleTheme}
            className="ml-auto grid size-9 place-items-center rounded-full text-mute hover:bg-raised hover:text-ink"
            aria-label="Switch between light and dark"
          >
            <SunMoonIcon className="size-[18px]" />
          </button>
        </div>
        {busy > 0 && all > 0 && (
          <div className="absolute inset-x-0 -bottom-px h-0.5" role="progressbar" aria-label="Library transcribed" aria-valuemin={0} aria-valuemax={all} aria-valuenow={finished}>
            <div className="h-full origin-left bg-murex transition-transform duration-700" style={{ transform: `scaleX(${finished / all})` }} />
          </div>
        )}
      </header>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-night/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
      >
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isCurrent(href) ? "page" : undefined}
            className="relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-mute aria-[current=page]:text-murex"
          >
            <Icon className="size-5" />
            {label}
            {href === "/activity" && busy > 0 && (
              <span className="absolute left-1/2 top-1.5 ml-2">
                <BusyCount count={busy} />
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
    <span className={`tabular flex items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-semibold leading-4 ${stopped ? "bg-raised text-mute" : "bg-murex text-on-murex"}`} aria-label={stopped ? `${count} waiting, downloads stopped` : `${count} in progress`}>
      <span className={`size-1.5 rounded-full bg-current ${stopped ? "" : "live-dot"}`} />
      {count > 999 ? "999+" : count}
    </span>
  );
}
