"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CopyIcon, DownloadIcon, PlatformMark, SyncIcon } from "@/components/icons";
import { useLiveKey } from "@/components/live";
import { Legend, Progress } from "@/components/progress";
import { Avatar, Banner, progressText } from "@/components/source-card";
import { Sheet, SheetSkeleton } from "@/components/video-card";
import { api, kindLabel, shortDate, useApi, type Source, type Video } from "@/lib/api";

const FILTERS = [
  { value: "", label: "All" },
  { value: "done", label: "Transcribed" },
  { value: "working", label: "In progress" },
  { value: "failed", label: "Failed" },
] as const;

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "views", label: "Most viewed" },
  { value: "longest", label: "Longest" },
];

const PAGE = 90;

export default function ChannelPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const key = useLiveKey();
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("newest");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState("");
  async function copyAll() {
    setCopied("Copying");
    try {
      const response = await fetch(`/api/sources/${id}/export?format=txt`);
      if (!response.ok) throw new Error();
      await navigator.clipboard.writeText(await response.text());
      setCopied("Copied");
    } catch {
      setCopied("Couldn't copy");
    }
    setTimeout(() => setCopied(""), 2200);
  }

  const source = useApi<Source>(`/sources/${id}`, key);
  const params = new URLSearchParams({ source_id: id, sort, limit: String(limit) });
  if (status) params.set("status", status);
  if (query.trim()) params.set("q", query.trim());
  const videos = useApi<{ total: number; items: Video[] }>(`/videos?${params}`, key);

  if (source.error) return <p className="text-amber">{source.error}</p>;
  const data = source.data;
  const failed = (data?.counts?.failed ?? 0) + (data?.counts?.skipped ?? 0);

  async function sync() {
    await api(`/sources/${id}/sync`, { method: "POST" });
    source.reload();
  }
  async function remove() {
    await api(`/sources/${id}`, { method: "DELETE" });
    router.push("/");
  }

  return (
    <div>
      <header className="overflow-hidden rounded-3xl border border-line bg-surface">
        {data ? <Banner source={data} className="h-28 sm:h-44" /> : <div className="skeleton h-28 rounded-none sm:h-44" />}
        <div className="flex flex-col gap-4 px-4 pb-5 sm:flex-row sm:items-end sm:px-7 sm:pb-6">
          {data && <Avatar source={data} className="-mt-9 size-20 sm:-mt-10 sm:size-24" />}
          <div className="min-w-0 flex-1">
            <h1 className="display truncate text-3xl sm:text-5xl">{data?.title || data?.handle || " "}</h1>
            {data && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-mute">
                <PlatformMark platform={data.platform} className="size-4" />
                <a href={data.url} target="_blank" rel="noopener noreferrer" className="hover:text-ink hover:underline">
                  {data.handle || kindLabel(data.platform, data.kind)}
                </a>
                <span className="tabular w-full sm:w-auto">
                  {[progressText(data), data.last_synced_at ? `checked ${shortDate(data.last_synced_at + "Z")}` : ""].filter(Boolean).join(", ")}
                </span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={sync} disabled={data?.listing} className="flex h-10 items-center gap-2 rounded-full bg-murex px-5 text-sm font-semibold text-on-murex hover:brightness-110 disabled:opacity-70">
              <SyncIcon className={`size-4 ${data?.listing ? "animate-spin" : ""}`} />
              {data?.listing ? "Checking for new videos" : "Check for new videos"}
            </button>
            {confirming ? (
              <>
                <button type="button" onClick={remove} className="h-10 rounded-full border border-amber px-4 text-sm font-semibold text-amber">
                  Remove channel and transcripts
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="h-10 rounded-full px-3 text-sm text-mute hover:text-ink">
                  Keep
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className="h-10 rounded-full border border-line px-4 text-sm font-medium text-mute hover:text-ink">
                Remove
              </button>
            )}
          </div>
        </div>
        {data && data.videos_total > 0 && (
          <div className="border-t border-line px-4 py-4 sm:px-7">
            <Progress done={data.videos_done} working={Math.max(data.videos_total - data.videos_done - data.videos_failed, 0)} failed={data.videos_failed} total={data.videos_total} className="h-2" />
            <div className="mt-2.5">
              <Legend done={data.videos_done} working={Math.max(data.videos_total - data.videos_done - data.videos_failed, 0)} failed={data.videos_failed} />
            </div>
          </div>
        )}
      </header>

      <div className="mb-6 mt-7 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={status === filter.value}
              onClick={() => {
                setStatus(filter.value);
                setLimit(PAGE);
              }}
              className="tabular rounded-full border border-line px-3.5 py-1.5 text-sm font-medium text-mute hover:text-ink aria-pressed:border-transparent aria-pressed:bg-ink aria-pressed:text-night"
            >
              {filter.label}
              {filter.value === "failed" && failed > 0 ? ` ${failed}` : ""}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {data && data.videos_done > 0 && (
            <>
              <button type="button" onClick={copyAll} className="flex h-9 items-center gap-2 rounded-full border border-line px-3.5 text-sm font-medium hover:bg-raised" title="Copy every transcript of this channel">
                <CopyIcon className="size-4" />
                <span aria-live="polite">{copied || "Copy all"}</span>
              </button>
              <details className="relative">
                <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-full border border-line px-3.5 text-sm font-medium hover:bg-raised [&::-webkit-details-marker]:hidden">
                  <DownloadIcon className="size-4" />
                  Export all
                </summary>
                <ul className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl">
                  {[
                    { format: "txt", label: "One text file" },
                    { format: "md", label: "One Markdown file, with timestamps" },
                    { format: "json", label: "JSON, with timed lines" },
                    { format: "zip", label: "Zip: Markdown and SRT per video" },
                  ].map((item) => (
                    <li key={item.format}>
                      <a href={`/api/sources/${id}/export?format=${item.format}`} download className="block px-4 py-2 text-sm hover:bg-raised">
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
          <label className="sr-only" htmlFor="title-filter">
            Filter by title
          </label>
          <input
            id="title-filter"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by title"
            className="h-9 w-40 rounded-full border border-line bg-surface px-4 text-sm outline-none placeholder:text-mute focus:border-murex sm:w-56"
          />
          <label className="sr-only" htmlFor="sort">
            Sort
          </label>
          <select id="sort" value={sort} onChange={(event) => setSort(event.target.value)} className="h-9 rounded-full border border-line bg-surface px-3 text-sm outline-none focus:border-murex">
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!videos.data ? (
        <SheetSkeleton tall={data?.platform === "tiktok"} />
      ) : videos.data.items.length === 0 ? (
        <p className="py-10 text-mute">
          {data?.listing ? "Listing this channel's videos. They appear here as they are found." : status || query ? "No videos match these filters." : "No videos found. Check for new videos to list the channel again."}
        </p>
      ) : (
        <>
          <Sheet videos={videos.data.items} />
          {videos.data.total > videos.data.items.length && (
            <div className="mt-10 text-center">
              <button type="button" onClick={() => setLimit((current) => Math.min(current + PAGE, 200))} disabled={limit >= 200} className="tabular h-11 rounded-full border border-line px-6 text-sm font-semibold hover:bg-raised disabled:opacity-50">
                {limit >= 200 ? `Showing 200 of ${videos.data.total}. Filter to narrow down` : `Show more (${videos.data.total - videos.data.items.length} left)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
