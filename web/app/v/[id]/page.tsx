"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { CopyIcon, DownloadIcon, PlatformMark } from "@/components/icons";
import { useLiveKey } from "@/components/live";
import { Player, type PlayerHandle } from "@/components/player";
import { Thumb } from "@/components/thumb";
import { api, clock, compact, isWorking, shortDate, statusLabel, useApi, type Segment, type Video } from "@/lib/api";

type Paragraph = { start: number; lines: (Segment & { index: number })[] };

/** Group timed lines into paragraphs: break on a pause, or after a sentence once the paragraph is long. */
function toParagraphs(segments: Segment[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let length = 0;
  segments.forEach((segment, index) => {
    const current = paragraphs.at(-1);
    const last = current?.lines.at(-1);
    const sentenceEnded = last ? /[.?!]["')]?$/.test(last.text) : false;
    if (!current || !last || segment.start - last.end > 2 || (length > 420 && sentenceEnded) || length > 900) {
      paragraphs.push({ start: segment.start, lines: [{ ...segment, index }] });
      length = segment.text.length;
    } else {
      current.lines.push({ ...segment, index });
      length += segment.text.length + 1;
    }
  });
  return paragraphs;
}

/** TikTok has no titles: yt-dlp cuts the caption short and adds "...". The video's own page shows all of it. */
function fullTitle(video: Video): string {
  const title = video.title || "Untitled video";
  const stem = title.replace(/(\.\.\.|…)$/, "");
  return stem !== title && video.description?.startsWith(stem) ? video.description : title;
}

const EXPORTS = [
  { format: "txt", label: "Plain text" },
  { format: "md", label: "Markdown" },
  { format: "srt", label: "SRT subtitles" },
  { format: "vtt", label: "VTT subtitles" },
  { format: "json", label: "JSON" },
];

function VideoView() {
  const { id } = useParams<{ id: string }>();
  const start = Math.max(0, Number(useSearchParams().get("t")) || 0);
  const key = useLiveKey(1500);
  const { data, error, reload } = useApi<{ video: Video; segments: Segment[] }>(`/videos/${id}`, key);
  const player = useRef<PlayerHandle>(null);
  const list = useRef<HTMLDivElement>(null);
  const [time, setTime] = useState(start);
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);

  const segments = useMemo(() => data?.segments ?? [], [data]);
  const paragraphs = useMemo(() => toParagraphs(segments), [segments]);
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => (needle ? segments.filter((segment) => segment.text.toLowerCase().includes(needle)).length : 0), [segments, needle]);

  let active = -1;
  for (let index = 0; index < segments.length && segments[index].start <= time + 0.15; index++) active = index;

  useEffect(() => {
    if (!follow || active < 0 || needle) return;
    const line = list.current?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    const box = list.current;
    if (!line || !box || box.scrollHeight <= box.clientHeight) return;
    const top = line.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 40 || top > box.scrollTop + box.clientHeight - 120) {
      box.scrollTo({ top: top - box.clientHeight / 3, behavior: "smooth" });
    }
  }, [active, follow, needle]);

  const onTime = useCallback((seconds: number) => setTime(seconds), []);

  if (error) return <p className="text-amber">{error}</p>;
  if (!data) {
    return (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
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

  async function copy() {
    await navigator.clipboard.writeText(paragraphs.map((paragraph) => paragraph.lines.map((line) => line.text).join(" ")).join("\n\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  async function retry() {
    await api(`/videos/${video.id}/retry`, { method: "POST" });
    reload();
  }

  return (
    <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-20 lg:self-start">
        {done ? (
          <Player ref={player} platform={video.platform} videoId={video.platform_video_id} shape={video.shape} start={start} title={video.title ?? "Video"} onTime={onTime} />
        ) : (
          <Thumb path={video.thumb_path} blur={video.thumb_blur} shape={video.shape} size="lg" status={video.status} progress={video.progress} eager className={video.shape === "tall" ? "mx-auto max-h-[70dvh]" : ""} />
        )}
        <h1 className="mt-4 text-xl font-semibold leading-snug sm:text-2xl [overflow-wrap:anywhere]">{fullTitle(video)}</h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-sm text-mute">
          <PlatformMark platform={video.platform} className="size-3.5" />
          {video.source_kind !== "video" && video.source_title ? (
            <Link href={`/c/${video.source_id}`} className="font-medium text-ink hover:underline">
              {video.source_title}
            </Link>
          ) : (
            <span className="font-medium text-ink">{video.source_title !== video.title ? video.source_title : video.source_handle}</span>
          )}
          <span className="tabular text-mute">{[shortDate(video.published_at), video.view_count != null ? `${compact(video.view_count)} views` : "", clock(video.duration_s)].filter(Boolean).join(", ")}</span>
        </p>
        <p className="mt-1 text-sm text-mute">
          <a href={video.url} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-4 hover:text-ink">
            {`Open on ${video.platform === "youtube" ? "YouTube" : "TikTok"}`}
          </a>
        </p>
      </div>

      <section aria-label="Transcript" className="min-w-0">
        {done ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="in-transcript">
                Find in this transcript
              </label>
              <input
                id="in-transcript"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find in this transcript"
                className="h-10 min-w-0 flex-1 rounded-full border border-line bg-surface px-4 text-sm outline-none placeholder:text-mute focus:border-murex"
              />
              <button type="button" onClick={copy} className="flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium hover:bg-raised">
                <CopyIcon className="size-4" />
                <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
              </button>
              <details className="relative">
                <summary className="flex h-10 cursor-pointer list-none items-center gap-2 rounded-full border border-line px-4 text-sm font-medium hover:bg-raised [&::-webkit-details-marker]:hidden">
                  <DownloadIcon className="size-4" />
                  Export
                </summary>
                <ul className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl">
                  {EXPORTS.map((item) => (
                    <li key={item.format}>
                      <a href={`/api/videos/${video.id}/export?format=${item.format}`} download className="block px-4 py-2 text-sm hover:bg-raised">
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
            <p className="tabular mt-3 flex flex-wrap items-center gap-x-3 text-xs text-mute">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-sea" />
                {video.method === "whisper" ? "Transcribed by Whisper on this computer" : "Made from the platform's captions"}
                {video.language ? `, ${video.language}` : ""}
              </span>
              {needle && <span>{matches === 1 ? "1 line matches" : `${matches} lines match`}</span>}
              <label className="ml-auto flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} className="accent-[var(--murex)]" />
                Follow the video
              </label>
            </p>
            <div ref={list} className="relative mt-4 max-w-[68ch] font-serif text-[17px] leading-[1.75] lg:max-h-[calc(100dvh-13.5rem)] lg:overflow-y-auto lg:pr-3">
              {segments.length === 0 && <p className="font-sans text-base text-mute">No speech was found in this video.</p>}
              {paragraphs.map((paragraph) => {
                const visible = !needle || paragraph.lines.some((line) => line.text.toLowerCase().includes(needle));
                if (!visible) return null;
                return (
                  <p key={paragraph.start} className="mb-5 grid grid-cols-[3.4rem_minmax(0,1fr)] gap-x-2">
                    <button type="button" onClick={() => player.current?.seek(paragraph.start)} className="tabular mt-[0.42em] self-start text-left font-sans text-xs font-medium text-mute hover:text-murex" aria-label={`Play from ${clock(paragraph.start)}`}>
                      {clock(paragraph.start)}
                    </button>
                    <span>
                      {paragraph.lines.map((line) => {
                        const hit = needle && line.text.toLowerCase().includes(needle);
                        return (
                          <span
                            key={line.index}
                            data-line={line.index}
                            role="button"
                            tabIndex={0}
                            onClick={() => player.current?.seek(line.start)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                player.current?.seek(line.start);
                              }
                            }}
                            className={`cursor-pointer rounded-[3px] box-decoration-clone py-0.5 transition-colors hover:bg-raised ${line.index === active ? "bg-murex-soft text-ink shadow-[inset_0_-2px_0_var(--murex)]" : line.index < active ? "text-mute" : ""} ${hit ? "!bg-[var(--mark)] !text-ink" : ""}`}
                          >
                            {line.text}{" "}
                          </span>
                        );
                      })}
                    </span>
                  </p>
                );
              })}
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-line bg-surface p-6">
            <p className="text-lg font-semibold">{statusLabel(video)}</p>
            <p className="mt-1 max-w-prose text-sm text-mute">
              {video.status === "skipped"
                ? `This video can't be reached, so it was left out. ${video.error ?? ""}`
                : video.status === "failed"
                  ? `The transcript couldn't be made. ${video.error ?? ""}`
                  : video.error
                    ? `Waiting to try again. ${video.error}`
                    : isWorking(video.status)
                      ? "The transcript appears here as soon as it is ready. You can leave this page."
                      : "This video hasn't been transcribed yet."}
            </p>
            {!isWorking(video.status) && (
              <button type="button" onClick={retry} className="mt-4 h-10 rounded-full bg-murex px-5 text-sm font-semibold text-on-murex hover:brightness-110">
                {video.status === "listed" ? "Transcribe this video" : "Try again"}
              </button>
            )}
          </div>
        )}
      </section>
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
