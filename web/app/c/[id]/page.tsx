"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CopyIcon, DownloadIcon, ExternalLinkIcon, MoreHorizontalIcon, RefreshCwIcon, RotateCcwIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Breadcrumb } from "@/components/breadcrumb";
import { Choice } from "@/components/choice";
import { PlatformMark } from "@/components/icons";
import { Pager } from "@/components/pager";
import { useLiveKey } from "@/components/live";
import { Pills } from "@/components/pills";
import { Legend, Progress } from "@/components/progress";
import { Avatar, Banner, progressText } from "@/components/source-card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetSkeleton } from "@/components/video-card";
import { useTitle } from "@/hooks/use-title";
import { act } from "@/lib/act";
import { api, kindLabel, shortDate, useApi, type Source, type Video } from "@/lib/api";

type Filter = "" | "done" | "working" | "failed";

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "views", label: "Most viewed" },
  { value: "longest", label: "Longest" },
];

const EXPORTS = [
  { format: "txt", label: "One text file" },
  { format: "md", label: "One Markdown file, with timestamps" },
  { format: "json", label: "JSON, with timed lines" },
  { format: "zip", label: "Zip: Markdown and SRT per video" },
];

const PAGE = 48;

function ChannelView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const key = useLiveKey();
  const [status, setStatus] = useState<Filter>("");
  const [sort, setSort] = useState("newest");
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState(false);
  const page = Math.max(1, Number(useSearchParams().get("page")) || 1);
  const setPage = (next: number, scroll = true) => {
    router.replace(next > 1 ? `/c/${id}?page=${next}` : `/c/${id}`, { scroll: false });
    if (scroll) document.getElementById("videos-top")?.scrollIntoView({ block: "start" });
  };

  const source = useApi<Source>(`/sources/${id}`, key);
  const params = new URLSearchParams({ source_id: id, sort, limit: String(PAGE), offset: String((page - 1) * PAGE) });
  if (status) params.set("status", status);
  if (query.trim()) params.set("q", query.trim());
  const videos = useApi<{ total: number; items: Video[] }>(`/videos?${params}`, key);
  // Keep showing the previous page of results while the next one loads (no flash back to skeletons).
  const [shown, setShown] = useState<{ total: number; items: Video[] } | null>(null);
  if (videos.data && videos.data !== shown) setShown(videos.data);

  const data = source.data;
  useTitle(data?.title || data?.handle);
  const pageCount = shown ? Math.max(1, Math.ceil(shown.total / PAGE)) : 1;

  if (source.error) {
    return (
      <div className="py-16 text-center">
        <p className="text-lg font-semibold">This channel isn&apos;t in your library</p>
        <p className="mt-1 text-mute">{source.error}</p>
        <Button className="mt-5" render={<Link href="/" />}>
          Back to the library
        </Button>
      </div>
    );
  }

  const failedCount = data?.counts?.failed ?? 0;
  const problemCount = failedCount + (data?.counts?.skipped ?? 0);
  const working = data ? Math.max(data.videos_total - data.videos_done - data.videos_failed, 0) : 0;
  const change = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    if (page !== 1) setPage(1, false);
  };

  function copyAll() {
    const promise = fetch(`/api/sources/${id}/export?format=txt`).then(async (response) => {
      if (!response.ok) throw new Error("export failed");
      await navigator.clipboard.writeText(await response.text());
    });
    toast.promise(promise, { loading: "Copying every transcript", success: `Copied ${data?.videos_done ?? ""} transcripts`, error: "Couldn't copy. Use an export instead." });
  }

  return (
    <div>
      <Breadcrumb trail={[{ href: "/", label: "Library" }]} current={data?.title || data?.handle} />

      <header className="panel overflow-hidden">
        {data ? <Banner source={data} className="h-28 sm:h-44" /> : <div className="skeleton h-28 rounded-none sm:h-44" />}
        <div className="flex flex-col gap-4 px-4 pb-5 sm:flex-row sm:items-end sm:px-7 sm:pb-6">
          {data ? <Avatar source={data} className="-mt-9 size-20 sm:-mt-10 sm:size-24" /> : <div className="skeleton -mt-9 size-20 rounded-full sm:size-24" />}
          <div className="min-w-0 flex-1">
            <h1 className="display truncate text-3xl sm:text-5xl">{data?.title || data?.handle || " "}</h1>
            {data && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-mute">
                <PlatformMark platform={data.platform} className="size-4" />
                <a href={data.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-ink hover:underline">
                  {data.handle || kindLabel(data.platform, data.kind)}
                  <ExternalLinkIcon className="size-3" aria-label="opens on the platform" />
                </a>
                <span className="tabular w-full sm:w-auto">
                  {[progressText(data), data.last_synced_at ? `checked ${shortDate(data.last_synced_at + "Z")}` : ""].filter(Boolean).join(", ")}
                </span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="lg"
              className="h-10 px-5 font-semibold"
              disabled={!data || data.listing}
              onClick={() => act(() => api(`/sources/${id}/sync`, { method: "POST" }), "Checking for new videos").then(source.reload)}
            >
              <RefreshCwIcon className={data?.listing ? "animate-spin" : ""} />
              {data?.listing ? "Checking" : "Check for new videos"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon-lg" className="size-10" aria-label="More actions for this channel" />}>
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuItem disabled={!data?.videos_done} onClick={copyAll}>
                  <CopyIcon />
                  Copy every transcript
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {EXPORTS.map((item) => (
                  <DropdownMenuItem key={item.format} disabled={!data?.videos_done} render={<a href={`/api/sources/${id}/export?format=${item.format}`} download />}>
                    <DownloadIcon />
                    {item.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={failedCount === 0}
                  onClick={() => act(() => api<{ queued: number }>(`/retry-failed?source_id=${id}`, { method: "POST" }), (result) => `${result.queued} videos queued again`).then(source.reload)}
                >
                  <RotateCcwIcon />
                  {failedCount > 0 ? `Try the ${failedCount} failed again` : "No failed videos"}
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setRemoving(true)}>
                  <Trash2Icon />
                  Remove this channel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {data && data.videos_total > 0 && (
          <div className="border-t border-line px-4 py-4 sm:px-7">
            <Progress done={data.videos_done} working={working} failed={data.videos_failed} total={data.videos_total} className="h-2" />
            <div className="mt-2.5">
              <Legend done={data.videos_done} working={working} failed={data.videos_failed} />
            </div>
          </div>
        )}
      </header>

      <div id="videos-top" className="scroll-mt-16" />
      <div className="sticky top-14 z-20 -mx-4 mb-6 mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 bg-night/85 px-4 py-3 backdrop-blur-2xl sm:-mx-6 sm:px-6 lg:top-16 lg:-mx-10 lg:px-10">
        <Pills<Filter>
          label="Show"
          value={status}
          onChange={change(setStatus)}
          options={[
            { value: "", label: "All", count: data?.videos_total },
            { value: "done", label: "Transcribed", count: data?.videos_done },
            { value: "working", label: "In progress", count: working },
            { value: "failed", label: "Failed", count: problemCount },
          ]}
        />
        <div className="flex w-full items-center gap-2 md:ml-auto md:w-auto">
          <label className="relative block min-w-0 flex-1 md:flex-none">
            <span className="sr-only">Filter by title</span>
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-mute" />
            <input
              type="search"
              value={query}
              onChange={(event) => change(setQuery)(event.target.value)}
              placeholder="Filter by title"
              className="field w-full pl-10 pr-4 md:w-60"
            />
          </label>
          <Choice label="Sort" value={sort} onChange={change(setSort)} items={SORTS} />
        </div>
      </div>

      {!shown ? (
        <SheetSkeleton tall={data?.platform === "tiktok"} />
      ) : shown.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
          <p className="font-semibold">
            {data?.listing ? "Listing this channel's videos" : status || query ? "No videos match these filters" : "No videos found"}
          </p>
          <p className="mt-1 text-sm text-mute">
            {data?.listing ? "They appear here as they are found." : status || query ? "Clear the filter or choose All." : "Check for new videos to list the channel again."}
          </p>
        </div>
      ) : (
        <>
          <div className={`transition-opacity ${videos.loading ? "opacity-60" : ""}`}>
            <Sheet videos={shown.items} />
          </div>
          <Pager label="Videos" className="mt-10" page={page} pageCount={pageCount} onChange={setPage} />
          {shown.total > PAGE && (
            <p className="tabular mt-3 text-center text-sm text-mute" aria-live="polite">
              {`${(page - 1) * PAGE + 1} to ${Math.min(page * PAGE, shown.total)} of ${shown.total} videos`}
            </p>
          )}
        </>
      )}

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Remove ${data?.title || "this channel"}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {`This deletes its ${data?.videos_total ?? ""} videos and ${data?.videos_done ?? ""} transcripts from your library. It can't be undone, but you can add the channel again and transcribe it from scratch.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                const removed = await act(() => api(`/sources/${id}`, { method: "DELETE" }).then(() => true), `${data?.title || "Channel"} removed`);
                if (removed) router.push("/");
              }}
            >
              Remove channel and transcripts
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function ChannelPage() {
  return (
    <Suspense>
      <ChannelView />
    </Suspense>
  );
}
