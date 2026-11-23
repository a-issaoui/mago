"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PlatformMark, SearchIcon } from "@/components/icons";
import { Thumb } from "@/components/thumb";
import { clock, shortDate, useApi, type Hit, type Source } from "@/lib/api";

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

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 220);
    return () => clearTimeout(timer);
  }, [text]);

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    router.replace(`/search?${next}`, { scroll: false });
  }
  useEffect(() => {
    if ((params.get("q") ?? "") !== query) setParam("q", query);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the typed query drives the URL
  }, [query]);

  const search = new URLSearchParams({ q: query, limit: "60" });
  if (platform) search.set("platform", platform);
  if (sourceId) search.set("source_id", sourceId);
  const results = useApi<{ items: Hit[]; loose?: boolean }>(query.length >= 2 ? `/search?${search}` : null);
  const sources = useApi<Source[]>("/sources");
  const channels = sources.data?.filter((source) => source.kind !== "video") ?? [];
  const groups = results.data ? groupByVideo(results.data.items) : [];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="sr-only">Search transcripts</h1>
      <div className="flex h-16 items-center gap-3 rounded-[22px] border border-line bg-surface px-5 focus-within:border-murex sm:h-[72px] sm:px-7">
        <SearchIcon className="size-5 shrink-0 text-mute" />
        <label htmlFor="q" className="sr-only">
          Search everything that was said
        </label>
        <input
          id="q"
          type="search"
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search everything that was said"
          className="h-full w-full bg-transparent text-lg outline-none placeholder:text-mute sm:text-xl"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {[
          { value: "", label: "Everywhere" },
          { value: "youtube", label: "YouTube" },
          { value: "tiktok", label: "TikTok" },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={platform === option.value}
            onClick={() => setParam("platform", option.value)}
            className="rounded-full border border-line px-3.5 py-1.5 text-sm font-medium text-mute hover:text-ink aria-pressed:border-transparent aria-pressed:bg-ink aria-pressed:text-night"
          >
            {option.label}
          </button>
        ))}
        {channels.length > 0 && (
          <>
            <label htmlFor="channel" className="sr-only">
              Channel
            </label>
            <select id="channel" value={sourceId} onChange={(event) => setParam("source", event.target.value)} className="ml-auto h-9 max-w-[55%] rounded-full border border-line bg-surface px-3 text-sm outline-none focus:border-murex">
              <option value="">Every channel</option>
              {channels.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title || source.handle}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="mt-8" aria-live="polite">
        {results.error && <p className="text-amber">{results.error}</p>}
        {query.length < 2 && <p className="text-mute">Type a word or a phrase. Put a phrase in quotes to find it exactly.</p>}
        {query.length >= 2 && results.loading && !results.data && (
          <div className="space-y-6">
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
        {results.data && groups.length === 0 && query.length >= 2 && (
          <p className="text-mute">{`Nobody said "${query}" in the videos you've transcribed. Try fewer words, or check the filters.`}</p>
        )}
        {groups.length > 0 && results.data?.loose && (
          <p className="mb-3 text-sm text-amber">No line has all of these words. Showing the closest passages instead.</p>
        )}
        {groups.length > 0 && (
          <p className="tabular mb-6 text-sm text-mute">
            {`${results.data!.items.length}${results.data!.items.length === 60 ? "+" : ""} ${results.data!.items.length === 1 ? "line" : "lines"} in ${groups.length} ${groups.length === 1 ? "video" : "videos"}`}
          </p>
        )}
        <ol className="space-y-9">
          {groups.map(({ video, lines }) => (
            <li key={video.video_id} className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 sm:grid-cols-[168px_minmax(0,1fr)] sm:gap-x-6">
              <Link href={`/v/${video.video_id}?t=${Math.floor(lines[0].start)}`} className="card block self-start" tabIndex={-1} aria-hidden>
                <Thumb path={video.thumb_path} blur={video.thumb_blur} shape={video.shape} duration={video.duration_s} className={video.shape === "tall" ? "mx-auto w-[62%]" : ""} />
              </Link>
              <div className="min-w-0">
                <Link href={`/v/${video.video_id}?t=${Math.floor(lines[0].start)}`} className="line-clamp-2 font-semibold leading-snug hover:underline">
                  {video.title || "Untitled video"}
                </Link>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-mute">
                  <PlatformMark platform={video.platform} className="size-3.5 shrink-0" />
                  {[video.source_title !== video.title ? video.source_title : "", shortDate(video.published_at)].filter(Boolean).join(", ")}
                </p>
                <ul className="mt-2.5 space-y-1.5">
                  {lines.slice(0, 5).map((line) => (
                    <li key={line.start}>
                      <Link href={`/v/${line.video_id}?t=${Math.floor(line.start)}`} className="group/line grid grid-cols-[3.2rem_minmax(0,1fr)] gap-x-1 rounded-lg py-1 hover:bg-raised sm:px-2 sm:-mx-2">
                        <span className="tabular mt-[0.4em] text-xs font-medium text-murex">{clock(line.start)}</span>
                        <span className="font-serif text-[16px] leading-relaxed">
                          <Snippet text={line.snippet} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {lines.length > 5 && <p className="tabular mt-1.5 text-xs text-mute sm:pl-[3.2rem]">{`and ${lines.length - 5} more in this video`}</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>
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
