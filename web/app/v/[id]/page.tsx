"use client";

import { Fragment, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ALargeSmallIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, LinkIcon, ListIcon, SearchIcon } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { Breadcrumb } from "@/components/breadcrumb";
import { PlatformMark } from "@/components/icons";
import { useLiveKey } from "@/components/live";
import { Player, type PlayerHandle } from "@/components/player";
import { Thumb } from "@/components/thumb";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useTitle } from "@/hooks/use-title";
import { act } from "@/lib/act";
import { api, clock, compact, isWorking, platformName, shortDate, statusLabel, useApi, type ChannelOffer, type Segment, type Source, type Video } from "@/lib/api";

type Line = Segment & { index: number };
type Paragraph = { start: number; first: number; last: number; lines: Line[] };
type Payload = {
  video: Video;
  segments: Segment[];
  channel: ChannelOffer | null;
  original: { id: number; title: string | null } | null;
  copies: { id: number; title: string | null; duplicate_kind: string }[];
};

/** Group timed lines into paragraphs: break on a pause, or at a sentence end once the paragraph is long. */
function toParagraphs(segments: Segment[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let length = 0;
  segments.forEach((segment, index) => {
    const current = paragraphs.at(-1);
    const last = current?.lines.at(-1);
    const sentenceEnded = last ? /[.?!]["')]?$/.test(last.text.trim()) : false;
    if (!current || !last || segment.start - last.end > 2 || (length > 420 && sentenceEnded) || length > 1600) {
      paragraphs.push({ start: segment.start, first: index, last: index, lines: [{ ...segment, index }] });
      length = segment.text.length;
    } else {
      current.lines.push({ ...segment, index });
      current.last = index;
      length += segment.text.length + 1;
    }
  });
  return paragraphs;
}

/** The line being spoken at `seconds` (binary search; transcripts can have thousands of lines). */
function lineAt(segments: Segment[], seconds: number): number {
  let low = 0;
  let high = segments.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (segments[middle].start <= seconds + 0.15) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/** TikTok has no titles: yt-dlp cuts the caption short and adds "...". The video's own page shows all of it. */
function fullTitle(video: Video): string {
  const title = video.title || "Untitled video";
  const stem = title.replace(/(\.\.\.|…)$/, "");
  return stem !== title && video.description?.startsWith(stem) ? video.description : title;
}

const SIZES = { small: "text-[15px] leading-[1.7]", medium: "text-[17px] leading-[1.75]", large: "text-[20px] leading-[1.8]" } as const;
const WIDTHS = { narrow: "max-w-[68ch]", full: "" } as const;
type Reading = { size: keyof typeof SIZES; width: keyof typeof WIDTHS };

/** How the owner likes to read (text size, line length), remembered on this computer. */
function useReading(): [Reading, (next: Partial<Reading>) => void] {
  const [reading, setReading] = useState<Reading>({ size: "medium", width: "narrow" });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("mago-reading") ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this browser's storage after mount
      if (saved && saved.size in SIZES && saved.width in WIDTHS) setReading(saved);
    } catch {
      /* no stored preference */
    }
  }, []);
  const update = useCallback((next: Partial<Reading>) => {
    setReading((current) => {
      const merged = { ...current, ...next };
      try {
        localStorage.setItem("mago-reading", JSON.stringify(merged));
      } catch {
        /* private mode: lasts for this page */
      }
      return merged;
    });
  }, []);
  return [reading, update];
}

const EXPORTS = [
  { format: "txt", label: "Plain text" },
  { format: "md", label: "Markdown, with timestamps" },
  { format: "srt", label: "SRT subtitles" },
  { format: "vtt", label: "VTT subtitles" },
  { format: "json", label: "JSON" },
];

/** One paragraph. Memoised: while the video plays only the paragraph holding the current line re-renders.
 *  Lines are clickable; the timestamp is the keyboard stop, so a long transcript is not thousands of tab stops. */
const ParagraphView = memo(function ParagraphView({ paragraph, active, needle, onSeek, onCopyLink }: { paragraph: Paragraph; active: number; needle: string; onSeek: (seconds: number) => void; onCopyLink: (seconds: number) => void }) {
  return (
    <p className="group/paragraph relative mb-5 grid grid-cols-[3.6rem_minmax(0,1fr)] gap-x-2">
      {/* Mouse only (the C key does the same for the current moment), so it adds no keyboard stops. */}
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onCopyLink(paragraph.start)}
        className="absolute left-0 top-8 hidden size-7 place-items-center rounded-md text-mute hover:bg-raised hover:text-murex group-hover/paragraph:grid"
        aria-label={`Copy a link to ${clock(paragraph.start)}`}
        title="Copy a link to this moment"
      >
        <LinkIcon className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onSeek(paragraph.start)}
        className="time -ml-1.5 mt-[0.25em] flex h-7 items-center self-start rounded-md px-1.5 text-xs font-medium text-mute hover:bg-raised hover:text-murex"
        aria-label={`Play from ${clock(paragraph.start)}`}
      >
        {clock(paragraph.start)}
      </button>
      <span>
        {paragraph.lines.map((line) => {
          const hit = needle && line.text.toLowerCase().includes(needle);
          return (
            <span
              key={line.index}
              data-line={line.index}
              onClick={() => onSeek(line.start)}
              className={`cursor-pointer rounded-[3px] box-decoration-clone py-0.5 transition-colors hover:bg-raised ${line.index === active ? "bg-murex-soft shadow-[inset_0_-2px_0_var(--murex)]" : ""} ${hit ? "!bg-[var(--mark)]" : ""}`}
            >
              {line.text}{" "}
            </span>
          );
        })}
      </span>
    </p>
  );
});

function VideoView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const linked = Math.max(0, Number(useSearchParams().get("t")) || 0);
  const key = useLiveKey(800);
  const { data, error, reload } = useApi<Payload>(`/videos/${id}`, key);
  // Where to begin: the moment a link points at, else where the owner stopped last time (kept for the life of this page).
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  if (data && resumeAt === null) {
    const saved = data.video.position_s ?? 0;
    setResumeAt(saved > 5 && saved < (data.video.duration_s ?? Infinity) - 15 ? saved : 0);
  }
  const start = linked > 0 ? linked : (resumeAt ?? 0);
  const [reading, setReadingPref] = useReading();
  const player = useRef<PlayerHandle>(null);
  const playerBox = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const lastManualScroll = useRef(0);
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [addingChannel, setAddingChannel] = useState(false);

  // A background refresh returns the same transcript: keep the same array so nothing re-renders.
  const signature = data ? `${data.video.id}:${data.segments.length}:${data.video.transcribed_at}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the signature on purpose
  const segments = useMemo(() => data?.segments ?? [], [signature]);
  const paragraphs = useMemo(() => toParagraphs(segments), [segments]);
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => (needle ? segments.filter((segment) => segment.text.toLowerCase().includes(needle)).length : 0), [segments, needle]);
  useTitle(data?.video.title);

  // The player reports its position several times a second; state changes only when the line does.
  const [played, setPlayed] = useState<number | null>(null);
  const position = useRef(start);
  const savedAt = useRef(-1);
  // Remember the place every few seconds, and when the page is left.
  const savePosition = useCallback(() => {
    const seconds = Math.floor(position.current);
    if (seconds === savedAt.current || seconds < 1) return;
    savedAt.current = seconds;
    fetch(`/api/videos/${id}/position`, { method: "PUT", keepalive: true, headers: { "x-mago": "1", "content-type": "application/json" }, body: JSON.stringify({ seconds }) }).catch(() => {});
  }, [id]);
  useEffect(() => {
    const timer = setInterval(savePosition, 8000);
    window.addEventListener("pagehide", savePosition);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", savePosition);
      savePosition();
    };
  }, [savePosition]);
  const settleUntil = useRef(0);
  const onTime = useCallback((seconds: number) => {
    // Just after a jump the player still reports where it was; trust the jump until it catches up,
    // so quick repeated presses add up instead of being lost.
    if (Date.now() < settleUntil.current && Math.abs(seconds - position.current) > 1.5) return;
    position.current = seconds;
    const found = lineAt(segments, seconds);
    setPlayed((current) => (current === found ? current : found));
  }, [segments]);
  // Before anything has played, the current line is the one the link pointed at (?t=).
  const active = played ?? (start > 0 ? lineAt(segments, start) : -1);

  const seek = useCallback((seconds: number) => {
    position.current = seconds;
    settleUntil.current = Date.now() + 1500;
    player.current?.seek(seconds);
  }, []);
  // J and L can be pressed several times quickly: add the presses up and send the player one jump.
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nudge = useCallback((delta: number) => {
    position.current = Math.max(0, position.current + delta);
    settleUntil.current = Date.now() + 2000;
    clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(() => seek(position.current), 220);
  }, [seek]);
  useEffect(() => () => clearTimeout(nudgeTimer.current), []);
  const copyMoment = useCallback(
    (seconds: number) => act(() => navigator.clipboard.writeText(`${window.location.origin}/v/${id}?t=${Math.floor(seconds)}`), `Link to ${clock(seconds)} copied`),
    [id],
  );

  // Keys, as on the platforms themselves: K plays or pauses, J and L jump 10 seconds, C copies a link to this moment.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || !target || target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) || document.querySelector('[role="dialog"]')) return;
      const key = event.key.toLowerCase();
      if (key === "k") player.current?.toggle();
      else if (key === "j") nudge(-10);
      else if (key === "l") nudge(10);
      else if (key === "c") copyMoment(position.current);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copyMoment, nudge]);

  // Following: keep the current line in view by scrolling the page, unless the reader has just scrolled themselves.
  useEffect(() => {
    const mark = () => (lastManualScroll.current = Date.now());
    window.addEventListener("wheel", mark, { passive: true });
    window.addEventListener("touchmove", mark, { passive: true });
    return () => {
      window.removeEventListener("wheel", mark);
      window.removeEventListener("touchmove", mark);
    };
  }, []);
  useEffect(() => {
    if (!follow || active < 0 || needle || Date.now() - lastManualScroll.current < 4000) return;
    const line = list.current?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (!line) return;
    const phone = window.matchMedia("(max-width: 1279px)").matches;
    const top = Math.max((phone ? playerBox.current : toolbar.current)?.getBoundingClientRect().bottom ?? 0, 64) + 12;
    const rect = line.getBoundingClientRect();
    if (rect.top < top || rect.bottom > window.innerHeight - 110) {
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollBy({ top: rect.top - (top + (window.innerHeight - top) * 0.3), behavior: calm ? "auto" : "smooth" });
    }
  }, [active, follow, needle]);

  if (!data) {
    if (error) {
      return (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold">This video isn&apos;t in your library</p>
          <p className="mt-1 text-mute">{error}</p>
          <Button className="mt-5" render={<Link href="/" />}>
            Back to the library
          </Button>
        </div>
      );
    }
    return (
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="skeleton aspect-video" />
        <div className="space-y-3">
          {Array.from({ length: 9 }, (_, index) => (
            <div key={index} className="skeleton h-4" style={{ width: `${70 + ((index * 37) % 30)}%` }} />
          ))}
        </div>
      </div>
    );
  }

  const { video } = data;
  const done = video.status === "done";
  const chapters = video.chapters ?? [];
  // The chapter that starts at or before each paragraph, shown as a heading above the first paragraph of it.
  const headings = new Map<number, string>();
  if (chapters.length > 1) {
    let next = 0;
    for (const paragraph of paragraphs) {
      while (next < chapters.length && chapters[next].start <= paragraph.lines.at(-1)!.start) {
        if (!headings.has(paragraph.first)) headings.set(paragraph.first, chapters[next].title);
        next++;
      }
    }
  }
  const inChannel = video.source_kind !== "video";
  const copy = () => act(() => navigator.clipboard.writeText(paragraphs.map((paragraph) => paragraph.lines.map((line) => line.text).join(" ")).join("\n\n")), "Transcript copied");
  const retry = () => act(() => api(`/videos/${video.id}/retry`, { method: "POST" }), "Queued. It will be transcribed shortly.").then(reload);
  async function addChannel(url: string) {
    setAddingChannel(true);
    const source = await act(() => api<Source>("/sources", { method: "POST", body: JSON.stringify({ url }) }), "Channel added. Listing its videos now.");
    setAddingChannel(false);
    if (source) router.push(`/c/${source.id}`);
  }

  return (
    <div>
      <Breadcrumb
        trail={[{ href: "/", label: "Library" }, ...(inChannel ? [{ href: `/c/${video.source_id}`, label: video.source_title ?? "Channel" }] : [])]}
        current={video.title}
      />

      <div className="grid gap-x-10 gap-y-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* On a phone this column dissolves, so the player can stick under the header while the transcript scrolls. */}
        <div className="max-xl:contents xl:sticky xl:top-24 xl:self-start">
          <div ref={playerBox} className="max-xl:sticky max-xl:top-14 max-xl:z-20 max-xl:-mx-4 max-xl:bg-night max-xl:px-4 max-xl:py-2 sm:max-xl:-mx-6 sm:max-xl:px-6 lg:max-xl:top-16 lg:max-xl:-mx-10 lg:max-xl:px-10">
            {done ? (
              <Player ref={player} platform={video.platform} videoId={video.platform_video_id} shape={video.shape} start={start} title={video.title ?? "Video"} onTime={onTime} />
            ) : (
              <Thumb path={video.thumb_path} blur={video.thumb_blur} shape={video.shape} size="lg" status={video.status} progress={video.progress} eager className={video.shape === "tall" ? "mx-auto max-h-[44dvh] xl:max-h-[70dvh]" : ""} />
            )}
          </div>
          <div>
            <h1 className="mt-1 text-xl font-semibold leading-snug [overflow-wrap:anywhere] sm:text-2xl xl:mt-4">{fullTitle(video)}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-mute">
              <PlatformMark platform={video.platform} className="size-4" />
              {inChannel ? (
                <Link href={`/c/${video.source_id}`} className="inline-flex min-h-6 items-center font-medium text-ink hover:underline">
                  {video.source_title}
                </Link>
              ) : video.channel_url ? (
                <a href={video.channel_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center font-medium text-ink hover:underline">
                  {video.channel_name || video.source_handle}
                </a>
              ) : (
                <span className="font-medium text-ink">{video.channel_name || video.source_handle}</span>
              )}
              <span className="tabular">{[shortDate(video.published_at), video.view_count != null ? `${compact(video.view_count)} views` : "", clock(video.duration_s)].filter(Boolean).join(", ")}</span>
              <a href={video.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-6 items-center gap-1 underline decoration-line underline-offset-4 hover:text-ink">
                {`Open on ${platformName(video.platform)}`}
                <ExternalLinkIcon className="size-3" />
              </a>
            </p>
            {data.original && (
              <p className="panel mt-4 !rounded-2xl px-4 py-3 text-sm">
                {video.duplicate_kind === "clip" ? "A clip of " : "Says the same as "}
                <Link href={`/v/${data.original.id}`} className="font-semibold underline decoration-line underline-offset-4 hover:decoration-current">
                  {data.original.title || "another video"}
                </Link>
                . Search shows the original only.
              </p>
            )}
            {data.copies.length > 0 && (
              <p className="mt-4 text-sm text-mute">
                {`${data.copies.length === 1 ? "1 other video repeats" : `${data.copies.length} other videos repeat`} these words: `}
                {data.copies.map((item, index) => (
                  <span key={item.id}>
                    {index > 0 && ", "}
                    <Link href={`/v/${item.id}`} className="underline decoration-line underline-offset-4 hover:text-ink">
                      {item.title || "untitled"}
                    </Link>
                  </span>
                ))}
              </p>
            )}
            {data.channel && (
              <div className="panel mt-4 flex flex-wrap items-center justify-between gap-3 !rounded-2xl px-4 py-3">
                <p className="min-w-0 text-sm">
                  <span className="block truncate font-semibold">{data.channel.name}</span>
                  <span className="block text-mute">
                    {data.channel.source_id ? "This channel is in your library." : "Only this video is in your library, not the rest of the channel."}
                  </span>
                </p>
                {data.channel.source_id ? (
                  <Button variant="outline" render={<Link href={`/c/${data.channel.source_id}`} />}>
                    Open channel
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => addChannel(data.channel!.url)} disabled={addingChannel}>
                    {addingChannel ? "Adding" : "Transcribe the whole channel"}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        <section aria-labelledby="transcript-heading" className="min-w-0">
          <h2 id="transcript-heading" className="sr-only">
            Transcript
          </h2>
          {done ? (
            <>
              <div ref={toolbar} className="z-10 -mx-1 flex flex-wrap items-center gap-2 bg-night/85 px-1 py-2 backdrop-blur-2xl xl:sticky xl:top-16">
                <label className="relative block min-w-40 flex-1">
                  <span className="sr-only">Find in this transcript</span>
                  <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-mute" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Find in transcript"
                    className="field w-full pl-10 pr-4"
                  />
                </label>
                <Button variant="outline" size="lg" className="h-10 px-4" onClick={copy}>
                  <CopyIcon />
                  Copy
                </Button>
                {chapters.length > 1 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" size="lg" className="h-10 px-4" />}>
                      <ListIcon />
                      Chapters
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-[60dvh] w-80 overflow-y-auto">
                      {chapters.map((chapter) => (
                        <DropdownMenuItem key={chapter.start} onClick={() => seek(chapter.start)}>
                          <span className="time w-12 shrink-0 text-xs text-mute">{clock(chapter.start)}</span>
                          <span className="min-w-0 truncate">{chapter.title}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="icon-lg" className="size-10" aria-label="Text size and line width" />}>
                    <ALargeSmallIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuRadioGroup value={reading.size} onValueChange={(value) => setReadingPref({ size: value as Reading["size"] })}>
                      <DropdownMenuRadioItem value="small">Small text</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="medium">Medium text</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="large">Large text</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuRadioGroup value={reading.width} onValueChange={(value) => setReadingPref({ width: value as Reading["width"] })}>
                      <DropdownMenuRadioItem value="narrow">Comfortable line length</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="full">Full width</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="lg" className="h-10 px-4" />}>
                    <DownloadIcon />
                    Export
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    {EXPORTS.map((item) => (
                      <DropdownMenuItem key={item.format} render={<a href={`/api/videos/${video.id}/export?format=${item.format}`} download />}>
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="tabular mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-mute">
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-sea" />
                  {video.method === "whisper" ? "Transcribed by Whisper on this computer" : `Made from ${platformName(video.platform)}'s captions`}
                  {video.language ? `, ${video.language}` : ""}
                </span>
                {needle && <span aria-live="polite">{matches === 1 ? "1 line matches" : `${matches} lines match`}</span>}
                {linked === 0 && (resumeAt ?? 0) > 0 && (
                  <button type="button" onClick={() => seek(0)} className="min-h-6 underline decoration-line underline-offset-4 hover:text-ink">
                    {`Continuing from ${clock(resumeAt)}. Start over`}
                  </button>
                )}
                <label className="ml-auto flex min-h-6 cursor-pointer items-center gap-2">
                  <Switch size="sm" checked={follow} onCheckedChange={setFollow} />
                  Follow the video
                </label>
              </div>
              <p className="mt-2 hidden items-center gap-x-3 gap-y-1 text-xs text-mute xl:flex xl:flex-wrap">
                <span className="flex items-center gap-1.5"><Kbd>K</Kbd> play or pause</span>
                <span className="flex items-center gap-1.5"><Kbd>J</Kbd><Kbd>L</Kbd> back or forward 10 s</span>
                <span className="flex items-center gap-1.5"><Kbd>C</Kbd> copy a link to this moment</span>
              </p>
              <div ref={list} className={`mt-5 font-serif ${SIZES[reading.size]} ${WIDTHS[reading.width]}`}>
                {segments.length === 0 && <p className="font-sans text-base text-mute">No speech was found in this video.</p>}
                {needle && matches === 0 && <p className="font-sans text-base text-mute">{`"${query.trim()}" isn't said in this video.`}</p>}
                {paragraphs.map((paragraph) =>
                  !needle || paragraph.lines.some((line) => line.text.toLowerCase().includes(needle)) ? (
                    <Fragment key={paragraph.first}>
                    {headings.has(paragraph.first) && !needle && (
                      <h3 className="mb-3 mt-8 flex items-baseline gap-3 font-sans text-base font-semibold first:mt-0">
                        <span className="h-px flex-1 self-center bg-line" />
                        {headings.get(paragraph.first)}
                        <span className="h-px flex-1 self-center bg-line" />
                      </h3>
                    )}
                    <ParagraphView key={paragraph.first} paragraph={paragraph} active={active >= paragraph.first && active <= paragraph.last ? active : -1} needle={needle} onSeek={seek} onCopyLink={copyMoment} />
                    </Fragment>
                  ) : null,
                )}
              </div>
            </>
          ) : (
            <div className="panel p-6">
              <p className="text-lg font-semibold">{statusLabel(video)}</p>
              <p className="mt-1 max-w-prose text-sm text-mute">
                {video.status === "skipped" && video.duplicate_of
                  ? video.error
                  : video.status === "skipped"
                    ? `This video can't be reached, so it was left out. ${video.error ?? ""}`
                    : video.status === "failed"
                      ? `The transcript couldn't be made. ${video.error ?? ""}`
                      : video.error
                        ? video.error
                        : isWorking(video.status)
                          ? "The transcript appears here as soon as it is ready. You can leave this page."
                          : "This video hasn't been transcribed yet."}
              </p>
              {!isWorking(video.status) && (
                <Button size="lg" className="mt-4 h-10 px-5 font-semibold" onClick={retry}>
                  {video.status === "listed" || video.duplicate_of ? "Transcribe this video anyway" : "Try again"}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function VideoPage() {
  return (
    <Suspense>
      <VideoView />
    </Suspense>
  );
}
