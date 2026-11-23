"use client";

import { useState } from "react";
import Link from "next/link";
import { DownloadIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { PlatformMark } from "@/components/icons";
import { useLiveKey } from "@/components/live";
import { NoteField } from "@/components/note-field";
import { PageHeader } from "@/components/page-header";
import { Pager, pageOf } from "@/components/pager";
import { Thumb } from "@/components/thumb";
import { Button } from "@/components/ui/button";
import { useTitle } from "@/hooks/use-title";
import { act } from "@/lib/act";
import { api, clock, useApi, type HighlightRow } from "@/lib/api";

const PAGE = 20;

export default function HighlightsPage() {
  useTitle("Highlights");
  const key = useLiveKey();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, reload } = useApi<HighlightRow[]>(`/highlights${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ""}`, key);
  const [shown, setShown] = useState<HighlightRow[] | null>(null);
  if (data && data !== shown) setShown(data);
  const paged = pageOf(shown ?? [], page, PAGE);

  return (
    <div>
      <PageHeader title="Highlights" note="Passages you saved, with your notes. Select text in any transcript and press Save highlight.">
        <Button variant="outline" size="lg" render={<a href="/api/highlights/export" download />} disabled={!shown?.length}>
          <DownloadIcon />
          Export as Markdown
        </Button>
      </PageHeader>

      <label className="relative mb-6 block">
        <span className="sr-only">Find in highlights</span>
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-mute" />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Find in highlights and notes"
          className="field h-11 w-full pl-11 pr-4"
        />
      </label>

      {error && !shown && <p className="text-amber">{error}</p>}
      {!shown && !error && (
        <div className="space-y-4">
          {[0, 1, 2].map((index) => (
            <div key={index} className="skeleton h-32 rounded-3xl" />
          ))}
        </div>
      )}
      {shown && shown.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
          <p className="font-semibold">{query.trim() ? "No highlight matches" : "No highlights yet"}</p>
          <p className="mt-1 text-sm text-mute">{query.trim() ? "Try other words." : "Open a video, select a passage in the transcript, and press Save highlight."}</p>
        </div>
      )}

      <ul className="grid gap-4 xl:grid-cols-2">
        {paged.items.map((row) => (
          <li key={row.id} className="panel grid grid-cols-[72px_minmax(0,1fr)] gap-x-4 p-4 sm:grid-cols-[112px_minmax(0,1fr)] sm:p-5">
            <Link href={`/v/${row.video_id}?t=${Math.floor(row.start_s)}`} className="card block self-start" tabIndex={-1} aria-hidden>
              <Thumb path={row.thumb_path} blur={row.thumb_blur} shape={row.shape} className={row.shape === "tall" ? "mx-auto w-[62%]" : ""} />
            </Link>
            <div className="min-w-0">
              <blockquote className="border-l-2 border-murex pl-3 font-serif text-[16px] leading-relaxed">{row.text}</blockquote>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mute">
                <PlatformMark platform={row.platform} className="size-3.5 shrink-0" />
                <Link href={`/v/${row.video_id}?t=${Math.floor(row.start_s)}`} className="flex min-h-6 min-w-0 items-center gap-2 font-medium text-ink hover:underline">
                  <span className="time text-murex">{clock(row.start_s)}</span>
                  <span className="truncate">{row.title || "Untitled video"}</span>
                </Link>
              </p>
              <NoteField id={row.id} note={row.note} onSaved={reload} />
              <div className="mt-1 flex justify-end">
                <Button variant="ghost" size="sm" className="text-mute" onClick={() => act(() => api(`/highlights/${row.id}`, { method: "DELETE" }), "Highlight removed").then(reload)}>
                  <Trash2Icon />
                  Remove
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <Pager label="Highlights" className="mt-8" page={Math.min(page, paged.pageCount)} pageCount={paged.pageCount} onChange={setPage} />
    </div>
  );
}
