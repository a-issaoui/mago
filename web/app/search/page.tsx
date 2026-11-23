"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { Choice } from "@/components/choice";
import { PlatformMark } from "@/components/icons";
import { Pager } from "@/components/pager";
import { Pills } from "@/components/pills";
import { Thumb } from "@/components/thumb";
import { useTitle } from "@/hooks/use-title";
import { clock, platformName, shortDate, useApi, type Hit, type Source } from "@/lib/api";

/** The search engine wraps matches in <mark>. Build elements from that
 *  instead of injecting HTML: transcript text is not trusted markup. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split(/(<mark>.*?<\/mark>)/g).map((part, index) =>
        part.startsWith("<mark>") ? <mark key={index}>{part.slice(6, -7)}</mark> : <span key={index}>{part}</span>,
      )}
    </>
  );
}

function groupByVideo(hits: Hit[]): { video: Hit; lines: Hit[] }[] {
  const groups = new Map<number, { video: Hit; lines: Hit[] }>();
  for (const hit of hits) {
    const group = groups.get(hit.video_id) ?? { video: hit, lines: [] };
    group.lines.push(hit);
    groups.set(hit.video_id, group);
  }
  return [...groups.values()].map((group) => ({ ...group, lines: group.lines.sort((a, b) => a.start - b.start) }));
}

function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const [text, setText] = useState(params.get("q") ?? "");
  const [query, setQuery] = useState(text);
  const platform = params.get("platform") ?? "";
  const sourceId = params.get("source") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const PAGE = 40;
  useTitle(query ? `"${query}"` : "Search");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 220);
    return () => clearTimeout(timer);
  }, [text]);

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name !== "page") next.delete("page"); // a new query or filter starts at page 1
    router.replace(`/search?${next}`, { scroll: false });
  }
  useEffect(() => {
    if ((params.get("q") ?? "") !== query) setParam("q", query);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the typed query drives the URL
  }, [query]);

  const search = new URLSearchParams({ q: query, limit: String(PAGE), offset: String((page - 1) * PAGE) });
  if (platform) search.set("platform", platform);
  if (sourceId) search.set("source_id", sourceId);
  const results = useApi<{ items: Hit[]; loose?: boolean; has_more?: boolean }>(query.length >= 2 ? `/search?${search}` : null);
  // Keep the last results on screen while the next query loads.
  const [shown, setShown] = useState<{ items: Hit[]; loose?: boolean; has_more?: boolean } | null>(null);
  if (results.data && results.data !== shown) setShown(results.data);
  const visible = query.length >= 2 ? shown : null;
  const sources = useApi<Source[]>("/sources");
  const channels = sources.data?.filter((source) => source.kind !== "video") ?? [];
  const groups = visible ? groupByVideo(visible.items) : [];
  const lineCount = visible?.items.length ?? 0;
  const summary = !visible
    ? ""
    : groups.length === 0
      ? "No results"
      : page > 1 || visible.has_more
        ? `Lines ${(page - 1) * PAGE + 1} to ${(page - 1) * PAGE + lineCount}, in ${groups.length} ${groups.length === 1 ? "video" : "videos"}`
        : `${lineCount} ${lineCount === 1 ? "line" : "lines"} in ${groups.length} ${groups.length === 1 ? "video" : "videos"}`;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="display mb-5 text-[34px] sm:text-[44px]">Search</h1>
      <label className="flex h-14 items-center gap-3 rounded-[22px] border border-line bg-surface px-5 shadow-sm transition-[border-color,box-shadow] focus-within:border-murex focus-within:ring-4 focus-within:ring-murex/15 sm:h-16 sm:px-6">
        <SearchIcon className="size-5 shrink-0 text-mute" />
        <span className="sr-only">Search everything that was said</span>
        <input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search everything that was said"
          className="h-full w-full bg-transparent text-lg outline-none placeholder:text-mute"
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Pills
          label="Platform"
          value={platform}
          onChange={(value) => setParam("platform", value)}
          options={[
            { value: "", label: "Everywhere" },
            { value: "youtube", label: "YouTube", icon: <PlatformMark platform="youtube" className="size-[18px]" /> },
            { value: "tiktok", label: "TikTok", icon: <PlatformMark platform="tiktok" className="size-[18px]" /> },
          ]}
        />
        {channels.length > 0 && (
          <Choice
            label="Channel"
            className="ml-auto max-w-[60vw]"
            value={sourceId || "all"}
            onChange={(value) => setParam("source", value === "all" ? "" : value)}
            items={[{ value: "all", label: "Every channel" }, ...channels.map((source) => ({ value: String(source.id), label: `${source.title || source.handle} (${platformName(source.platform)})` }))]}
          />
        )}
      </div>

      <p className="tabular mt-7 min-h-5 text-sm text-mute" role="status">
        {summary}
      </p>
      {results.error && <p className="mt-2 text-amber">{results.error}</p>}
      {query.length < 2 && (
        <div className="mt-2 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <p className="font-semibold">Find the moment something was said</p>
          <p className="mt-1 text-sm text-mute">Type a word or a phrase. Put a phrase in quotes to find it exactly. Each result opens the video at that second.</p>
        </div>
      )}
      {query.length >= 2 && !visible && results.loading && (
        <div className="mt-4 space-y-6">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex gap-4">
              <div className="skeleton aspect-video w-40 shrink-0" />
              <div className="flex-1 space-y-2.5">
                <div className="skeleton h-4 w-3/5" />
                <div className="skeleton h-4" />
                <div className="skeleton h-4 w-4/5" />
              </div>
            </div>
          ))}
        </div>
      )}
      {visible && groups.length === 0 && (
        <div className="mt-2 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
          <p className="font-semibold">{`Nobody said "${query}"`}</p>
          <p className="mt-1 text-sm text-mute">Not in the videos transcribed so far. Try fewer words, or check the filters above.</p>
        </div>
      )}
      {groups.length > 0 && visible?.loose && <p className="mt-2 text-sm text-amber">No line has all of these words. Showing the closest passages instead.</p>}

      <ol className={`mt-5 space-y-9 transition-opacity ${results.loading ? "opacity-60" : ""}`}>
        {groups.map(({ video, lines }) => (
          <li key={video.video_id} className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 sm:grid-cols-[168px_minmax(0,1fr)] sm:gap-x-6">
            <Link href={`/v/${video.video_id}?t=${Math.floor(lines[0].start)}`} className="card block self-start" tabIndex={-1} aria-hidden>
              <Thumb path={video.thumb_path} blur={video.thumb_blur} shape={video.shape} duration={video.duration_s} className={video.shape === "tall" ? "mx-auto w-[62%]" : ""} />
            </Link>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold leading-snug">
                <Link href={`/v/${video.video_id}?t=${Math.floor(lines[0].start)}`} className="line-clamp-2 hover:underline">
                  {video.title || "Untitled video"}
                </Link>
              </h2>
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-mute">
                <PlatformMark platform={video.platform} className="size-3.5 shrink-0" />
                {[video.source_title !== video.title ? video.source_title : "", shortDate(video.published_at)].filter(Boolean).join(", ")}
              </p>
              <ul className="mt-2 space-y-0.5">
                {lines.slice(0, 5).map((line) => (
                  <li key={line.start}>
                    <Link href={`/v/${line.video_id}?t=${Math.floor(line.start)}`} className="grid min-h-9 grid-cols-[3.4rem_minmax(0,1fr)] items-baseline gap-x-1 rounded-lg py-1.5 transition-colors hover:bg-surface sm:-mx-2 sm:px-2">
                      <span className="tabular text-xs font-semibold text-murex">{clock(line.start)}</span>
                      <span className="font-serif text-[16px] leading-relaxed">
                        <Snippet text={line.snippet} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {lines.length > 5 && <p className="tabular mt-1.5 text-xs text-mute sm:pl-[3.4rem]">{`and ${lines.length - 5} more in this video`}</p>}
            </div>
          </li>
        ))}
      </ol>
      {visible && (
        <Pager
          label="Search results"
          className="mt-10"
          page={page}
          hasNext={Boolean(visible.has_more)}
          onChange={(next) => {
            setParam("page", next > 1 ? String(next) : "");
            window.scrollTo({ top: 0 });
          }}
        />
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  );
}
