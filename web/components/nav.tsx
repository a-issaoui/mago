"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { ActivityIcon, BarChart3Icon, FolderIcon, HighlighterIcon, LibraryIcon, MoonIcon, PauseIcon, PlayIcon, SearchIcon, SettingsIcon, SunIcon } from "lucide-react";
import { openPalette } from "@/components/command-palette";
import { PlatformMark } from "@/components/icons";
import { useLive, useLiveKey } from "@/components/live";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { act } from "@/lib/act";
import { api, mcpLine, mediaUrl, thumbUrl, useApi, type Collection, type Source } from "@/lib/api";

const links = [
  { href: "/", label: "Library", icon: LibraryIcon },
  { href: "/search", label: "Search", icon: SearchIcon },
  { href: "/highlights", label: "Highlights", icon: HighlighterIcon },
  { href: "/activity", label: "Activity", icon: ActivityIcon },
  { href: "/stats", label: "Statistics", icon: BarChart3Icon, wideOnly: true },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

function useNavState() {
  const pathname = usePathname();
  const { snapshot } = useLive();
  const busy = (snapshot?.queued ?? 0) + (snapshot?.active.length ?? 0) + (snapshot?.listing.length ?? 0);
  const stopped = (snapshot?.paused.length ?? 0) === 2;
  const total = snapshot ? snapshot.platforms.youtube.total + snapshot.platforms.tiktok.total : 0;
  const done = snapshot ? snapshot.platforms.youtube.done + snapshot.platforms.tiktok.done : 0;
  const isCurrent = (href: string) =>
    href === "/" ? pathname === "/" || pathname.startsWith("/c/") || pathname.startsWith("/v/") || pathname.startsWith("/k/") : pathname.startsWith(href);
  const working = (snapshot?.active.length ?? 0) + (snapshot?.listing.length ?? 0) > 0;
  return { pathname, snapshot, busy, stopped, total, done, isCurrent, working };
}

/** The mark: four bars of a sound level, in the brand gradient. */
export function Mark({ className = "size-7", live = false }: { className?: string; live?: boolean }) {
  const id = useId();
  return (
    <svg viewBox="0 0 28 28" className={`${className} ${live ? "mark-live" : ""}`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="var(--glow-a)" />
          <stop offset="1" stopColor="var(--glow-b)" />
        </linearGradient>
      </defs>
      <g fill={`url(#${id})`}>
        <rect x="3" y="11" width="3.6" height="6" rx="1.8" />
        <rect x="9" y="6" width="3.6" height="16" rx="1.8" />
        <rect x="15" y="9" width="3.6" height="10" rx="1.8" />
        <rect x="21" y="4" width="3.6" height="20" rx="1.8" />
      </g>
    </svg>
  );
}

function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label="Switch between light and dark" />}>
        <SunIcon className="hidden dark:block" />
        <MoonIcon className="dark:hidden" />
      </TooltipTrigger>
      <TooltipContent>Light or dark</TooltipContent>
    </Tooltip>
  );
}

/** The menu on wide screens: pages, your channels, and the queue, on every screen. */
export function Sidebar() {
  const { snapshot, busy, stopped, total, done, isCurrent, pathname, working } = useNavState();
  const key = useLiveKey(800);
  const sources = useApi<Source[]>("/sources", key);
  const channels = (sources.data ?? []).filter((source) => source.kind !== "video");
  const collections = useApi<Collection[]>("/collections", key);

  // Which channel is "here": the one being viewed, or the one the open video belongs to.
  const onChannel = pathname.match(/^\/c\/(\d+)/)?.[1];
  const onVideo = pathname.match(/^\/v\/(\d+)/)?.[1];
  const videoSource = useApi<{ source_id: number }>(onVideo ? `/videos/${onVideo}/source` : null);
  const activeChannel = onChannel ? Number(onChannel) : onVideo ? (videoSource.data?.source_id ?? null) : null;
  const list = useRef<HTMLUListElement>(null);
  const listed = channels.length;
  useEffect(() => {
    // With a long list the current channel may be out of sight: bring it into view (inside the list
    // only). Again whenever the list changes height, e.g. when the queue card appears under it.
    const box = list.current;
    if (!box) return;
    const reveal = () => {
      const item = box.querySelector<HTMLElement>('[aria-current="page"]');
      if (!item) return;
      const top = item.offsetTop; // the list is the offset parent (position: relative)
      if (top < box.scrollTop || top + item.offsetHeight > box.scrollTop + box.clientHeight) {
        box.scrollTo({ top: top - box.clientHeight / 2 + item.offsetHeight / 2 });
      }
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(box);
    return () => observer.disconnect();
  }, [activeChannel, listed]);

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-surface/70 backdrop-blur-2xl lg:flex">
      <Link href="/" className="flex h-16 shrink-0 items-center gap-2.5 px-5" aria-label="Mago, library">
        <Mark live={working} />
        <span className="display text-[22px]">Mago</span>
      </Link>

      <nav aria-label="Main" className="px-3">
        <ul className="space-y-0.5">
          {links.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                aria-current={isCurrent(href) ? "page" : undefined}
                className="group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-mute transition-colors hover:bg-raised/70 hover:text-ink aria-[current=page]:bg-murex-soft aria-[current=page]:text-ink"
              >
                <span className="glow-bg absolute inset-y-2 left-0 hidden w-[3px] rounded-full group-aria-[current=page]:block" />
                <Icon className="size-[18px] group-aria-[current=page]:text-murex" />
                {label}
                {href === "/activity" && busy > 0 && <BusyCount count={busy} stopped={stopped} className="ml-auto" />}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 flex min-h-0 flex-1 flex-col">
        <p className="px-6 text-xs font-medium text-mute">Channels</p>
        <ul ref={list} className="relative mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-3 pb-3 [scrollbar-color:var(--line-strong)_transparent] [scrollbar-width:thin]">
          {channels.map((source) => {
            const picture = mediaUrl(source.avatar_path) ?? thumbUrl(source.covers?.[0]?.thumb_path ?? null);
            return (
              <li key={source.id}>
                <Link
                  href={`/c/${source.id}`}
                  aria-current={activeChannel === source.id ? "page" : undefined}
                  className="group relative flex h-10 items-center gap-2.5 rounded-xl px-3 text-sm text-mute transition-colors hover:bg-raised/70 hover:text-ink aria-[current=page]:bg-murex-soft aria-[current=page]:font-medium aria-[current=page]:text-ink"
                >
                  <span className="glow-bg absolute inset-y-2 left-0 hidden w-[3px] rounded-full group-aria-[current=page]:block" />
                  {picture ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local, already resized
                    <img src={picture} alt="" width={24} height={24} className="size-6 shrink-0 rounded-full bg-raised object-cover" />
                  ) : (
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-raised text-[11px] font-semibold">{(source.title || "?").charAt(0)}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{source.title || source.handle}</span>
                  <PlatformMark platform={source.platform} className="size-3.5 shrink-0" />
                </Link>
              </li>
            );
          })}
          {sources.data && channels.length === 0 && <li className="px-3 py-2 text-sm text-mute">Channels you add appear here.</li>}
          {(collections.data ?? []).length > 0 && <li className="px-3 pb-1 pt-4 text-xs font-medium text-mute">Collections</li>}
          {(collections.data ?? []).map((collection) => (
            <li key={`k${collection.id}`}>
              <Link
                href={`/k/${collection.id}`}
                aria-current={pathname === `/k/${collection.id}` ? "page" : undefined}
                className="group relative flex h-10 items-center gap-2.5 rounded-xl px-3 text-sm text-mute transition-colors hover:bg-raised/70 hover:text-ink aria-[current=page]:bg-murex-soft aria-[current=page]:font-medium aria-[current=page]:text-ink"
              >
                <span className="glow-bg absolute inset-y-2 left-0 hidden w-[3px] rounded-full group-aria-[current=page]:block" />
                <FolderIcon className="size-[18px] shrink-0" />
                <span className="min-w-0 flex-1 truncate">{collection.name}</span>
                <span className="tabular text-xs">{collection.videos}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <Link href="/settings#claude" className="mx-3 flex items-start gap-2 rounded-xl px-3 py-2 text-xs text-mute hover:bg-raised/70 hover:text-ink" title="How Claude reaches this library">
        <span className={`mt-1 size-2 shrink-0 rounded-full ${snapshot?.mcp.sessions ? "bg-sea" : "bg-line-strong"} ${snapshot?.mcp.busy ? "live-dot" : ""}`} />
        <span>{mcpLine(snapshot?.mcp)}</span>
      </Link>

      {total > 0 && (
        <div className="m-3 rounded-2xl border border-line bg-night/60 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <Link href="/activity" className="min-w-0 text-sm font-medium hover:underline">
              <span className="tabular">{done}</span>
              <span className="text-mute">{" of "}</span>
              <span className="tabular">{total}</span>
              <span className="text-mute"> transcribed</span>
            </Link>
            {busy > 0 && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={stopped ? "Resume downloads" : "Stop all downloads"}
                      onClick={() => act(() => api("/queue/pause", { method: "POST", body: JSON.stringify({ platform: "all", paused: !stopped }) }), stopped ? "Downloads resumed" : "Downloads stopped")}
                    />
                  }
                >
                  {stopped ? <PlayIcon /> : <PauseIcon />}
                </TooltipTrigger>
                <TooltipContent>{stopped ? "Resume downloads" : "Stop all downloads"}</TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Library transcribed" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div className="glow-bg h-full origin-left rounded-full transition-transform duration-700" style={{ transform: `scaleX(${done / total})` }} />
          </div>
          <p className="mt-2 text-xs text-mute">
            {busy === 0 ? "Everything is transcribed." : stopped ? `${busy} waiting. Downloads are stopped.` : snapshot?.pauses.length ? `${busy} waiting. A platform asked for a pause.` : `${busy} to go.`}
          </p>
        </div>
      )}
    </aside>
  );
}

/** Across the top: the search-and-commands field and the theme switch (plus the mark on small screens). */
export function Topbar() {
  const { working } = useNavState();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-night/75 backdrop-blur-2xl">
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:grid lg:h-16 lg:grid-cols-[1fr_minmax(0,26rem)_1fr] lg:px-10">
        <Link href="/" className="flex items-center gap-2 lg:hidden" aria-label="Mago, library">
          <Mark className="size-6" live={working} />
          <span className="display text-xl">Mago</span>
        </Link>
        <span className="hidden lg:block" aria-hidden />
        <button
          type="button"
          onClick={openPalette}
          className="ml-auto flex h-10 min-w-0 items-center gap-2.5 rounded-full border border-line-strong bg-surface/70 pl-3.5 pr-2 text-sm text-mute transition-[border-color,box-shadow] hover:border-murex hover:text-ink lg:ml-0 lg:h-9 lg:w-full"
          aria-label="Search and commands"
        >
          <SearchIcon className="size-4 shrink-0" />
          <span className="hidden flex-1 truncate text-left sm:block">Search or jump to</span>
          <Kbd className="hidden sm:inline-flex">Ctrl K</Kbd>
        </button>
        <div className="lg:justify-self-end">
          <ThemeButton />
        </div>
      </div>
    </header>
  );
}

/** On phones and tablets: four tabs along the bottom. */
export function MobileNav() {
  const { busy, stopped, isCurrent } = useNavState();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-night/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl lg:hidden">
      {links.filter((link) => !("wideOnly" in link)).map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isCurrent(href) ? "page" : undefined}
          className="group relative flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium text-mute aria-[current=page]:text-ink"
        >
          <span className="glow-bg absolute inset-x-5 top-0 hidden h-[3px] rounded-full group-aria-[current=page]:block" />
          <Icon className="size-5 group-aria-[current=page]:text-murex" />
          {label}
          {href === "/activity" && busy > 0 && (
            <span className="absolute left-1/2 top-1.5 ml-2">
              <BusyCount count={busy} stopped={stopped} />
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

function BusyCount({ count, stopped = false, className = "" }: { count: number; stopped?: boolean; className?: string }) {
  return (
    <span
      className={`tabular flex items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-semibold leading-4 ${stopped ? "bg-raised text-mute ring-1 ring-line-strong" : "bg-murex text-on-murex"} ${className}`}
      aria-label={stopped ? `${count} waiting, downloads stopped` : `${count} in progress`}
    >
      <span className={`size-1.5 rounded-full bg-current ${stopped ? "" : "live-dot"}`} />
      {count > 999 ? "999+" : count}
    </span>
  );
}

/** Wraps a screen so that moving to another one eases in. */
export function Screen({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="screen-in">
      {children}
    </div>
  );
}
