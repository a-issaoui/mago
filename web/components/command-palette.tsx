"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ActivityIcon, BarChart3Icon, LibraryIcon, LinkIcon, PauseIcon, PlayIcon, SearchIcon, SettingsIcon, SunMoonIcon } from "lucide-react";
import { PlatformMark } from "@/components/icons";
import { useLive } from "@/components/live";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { act } from "@/lib/act";
import { api, clock, useApi, type Hit, type Source } from "@/lib/api";

const looksLikeLink = (text: string) => /(youtube\.com|youtu\.be|tiktok\.com)\//i.test(text);

const PaletteContext = createContext<{ open: () => void }>({ open: () => {} });
export const usePalette = () => useContext(PaletteContext);

let opener: (() => void) | null = null;
/** Open the palette from anywhere (the header's search button). */
export const openPalette = () => opener?.();

/** Ctrl/⌘ K (or "/") from any screen: search what was said, jump to a channel, or run an action. */
export function CommandPalette() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { snapshot } = useLive();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    opener = () => setOpen(true);
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      opener = null;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 200);
    return () => clearTimeout(timer);
  }, [text]);

  const isLink = looksLikeLink(text);
  const sources = useApi<Source[]>(open ? "/sources" : null);
  const hits = useApi<{ items: Hit[] }>(open && !isLink && query.length >= 2 ? `/search?q=${encodeURIComponent(query)}&limit=8` : null);
  const channels = (sources.data ?? []).filter((source) => source.kind !== "video");
  const stopped = (snapshot?.paused.length ?? 0) === 2;

  // Results come from the server already filtered, so the list does its own matching for the fixed items.
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (label: string) => words.every((word) => label.toLowerCase().includes(word));
  const shownChannels = isLink ? [] : channels.filter((source) => matches(`${source.title ?? ""} ${source.handle ?? ""} ${source.platform} channel`));
  const pages = [
    { path: "/", label: "Library", keywords: "library home", icon: LibraryIcon },
    { path: "/search", label: "Search", keywords: "search transcripts find", icon: SearchIcon },
    { path: "/activity", label: "Activity", keywords: "activity queue progress downloads", icon: ActivityIcon },
    { path: "/stats", label: "Statistics", keywords: "statistics stats numbers hours words", icon: BarChart3Icon },
    { path: "/settings", label: "Settings", keywords: "settings preferences whisper", icon: SettingsIcon },
  ].filter((page) => !isLink && matches(`${page.label} ${page.keywords} go`));
  const showStop = !isLink && matches(stopped ? "resume downloads start queue" : "stop all downloads pause queue");
  const showTheme = !isLink && matches("theme light dark appearance switch");

  const go = useCallback(
    (path: string) => {
      setOpen(false);
      setText("");
      router.push(path);
    },
    [router],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setText("");
      }}
      title="Search and commands"
      description="Search what was said, open a channel, or run a command."
      className="sm:max-w-2xl"
    >
      <Command shouldFilter={false}>
      <CommandInput value={text} onValueChange={setText} placeholder="Search what was said, or paste a link" />
      <CommandList className="max-h-[min(60dvh,460px)]">
        <CommandEmpty>{query.length >= 2 && hits.loading ? "Searching" : "Nothing matches."}</CommandEmpty>

        {isLink && (
          <CommandGroup heading="Link">
            <CommandItem value="add-link" onSelect={() => go(`/?add=${encodeURIComponent(text.trim())}`)}>
              <LinkIcon />
              Look at this link
              <span className="truncate text-muted-foreground">{text.trim()}</span>
            </CommandItem>
          </CommandGroup>
        )}

        {hits.data && hits.data.items.length > 0 && (
          <CommandGroup heading="What was said">
            {hits.data.items.map((hit) => (
              <CommandItem
                key={`${hit.video_id}-${hit.start}`}
               
                value={`said-${hit.video_id}-${hit.start}`}
                onSelect={() => go(`/v/${hit.video_id}?t=${Math.floor(hit.start)}`)}
                className="items-start"
              >
                <PlatformMark platform={hit.platform} className="mt-0.5 size-4" />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 font-serif text-[15px] leading-snug">{hit.snippet.replace(/<\/?mark>/g, "")}</span>
                  <span className="block truncate text-xs text-muted-foreground">{hit.title}</span>
                </span>
                <CommandShortcut className="time">{clock(hit.start)}</CommandShortcut>
              </CommandItem>
            ))}
            <CommandItem value="all-results" onSelect={() => go(`/search?q=${encodeURIComponent(query)}`)}>
              <SearchIcon />
              {`See every result for "${query}"`}
            </CommandItem>
          </CommandGroup>
        )}

        {shownChannels.length > 0 && (
          <CommandGroup heading="Channels">
            {shownChannels.map((source) => (
              <CommandItem key={source.id} value={`channel-${source.id}`} onSelect={() => go(`/c/${source.id}`)}>
                <PlatformMark platform={source.platform} className="size-4" />
                {source.title || source.handle}
                <span className="tabular text-xs text-muted-foreground">{`${source.videos_done} of ${source.videos_total}`}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {pages.length > 0 && (
          <CommandGroup heading="Go to">
            {pages.map(({ path, label, icon: Icon }) => (
              <CommandItem key={path} value={`go-${path}`} onSelect={() => go(path)}>
                <Icon />
                {label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {(showStop || showTheme) && (
          <CommandGroup heading="Do">
            {showStop && (
              <CommandItem
                value="do-stop"
                onSelect={() => {
                  setOpen(false);
                  act(() => api("/queue/pause", { method: "POST", body: JSON.stringify({ platform: "all", paused: !stopped }) }), stopped ? "Downloads resumed" : "Downloads stopped");
                }}
              >
                {stopped ? <PlayIcon /> : <PauseIcon />}
                {stopped ? "Resume downloads" : "Stop all downloads"}
              </CommandItem>
            )}
            {showTheme && (
              <CommandItem
                value="do-theme"
                onSelect={() => {
                  setTheme(resolvedTheme === "dark" ? "light" : "dark");
                  setOpen(false);
                }}
              >
                <SunMoonIcon />
                {resolvedTheme === "dark" ? "Switch to light" : "Switch to dark"}
              </CommandItem>
            )}
          </CommandGroup>
        )}
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
