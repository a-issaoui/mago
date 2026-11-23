"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PlatformMark } from "@/components/icons";
import { useLive, useLiveKey } from "@/components/live";
import { PasteBox } from "@/components/paste-box";
import { SourceCard } from "@/components/source-card";
import { Sheet, VideoCard } from "@/components/video-card";
import { useApi, type Platform, type Source, type Video } from "@/lib/api";

type Page = { total: number; items: Video[] };

const FILTERS: { value: Platform | ""; label: string }[] = [
  { value: "", label: "Everything" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
];

function Library() {
  const router = useRouter();
  const params = useSearchParams();
  const platform = (params.get("platform") ?? "") as Platform | "";
  const filter = platform ? `&platform=${platform}` : "";
  const key = useLiveKey();
  const { snapshot } = useLive();
  const sources = useApi<Source[]>("/sources", key);
  const recent = useApi<Page>(`/videos?sort=recent&limit=24${filter}`, key);
  const working = useApi<Page>(`/videos?status=working&limit=12${filter}`, key);
  const singles = useApi<Page>(`/videos?single=true&limit=36${filter}`, key);

  const channels = sources.data?.filter((source) => source.kind !== "video" && (!platform || source.platform === platform)) ?? [];
  const empty = sources.data?.length === 0;
  const refresh = () => {
    sources.reload();
    working.reload();
    singles.reload();
  };
  // With a small library the newest transcripts are the single videos listed below: don't show them twice.
  const singleIds = new Set(singles.data?.items.map((video) => video.id));
  const recentIsRepeat = Boolean(recent.data && singles.data && recent.data.items.every((video) => singleIds.has(video.id)));
  const nothingHere = !empty && sources.data && channels.length === 0 && singles.data?.total === 0;

  return (
    <div className="space-y-12 sm:space-y-14">
      <section className="max-w-3xl pt-2 sm:pt-6">
        <h1 className="display text-[44px] sm:text-[72px]">Keep what was said</h1>
        <p className="mb-6 mt-3 max-w-xl text-base text-mute sm:text-lg">
          Paste one video or a whole channel. Mago saves the words with their timestamps, so you can search them and read along.
        </p>
        <PasteBox onAdded={refresh} />
        {sources.error && <p className="mt-4 text-sm text-amber">{sources.error}</p>}
      </section>

      {!empty && (
        <div className="!mt-10 flex flex-wrap gap-2" role="group" aria-label="Show">
          {FILTERS.map((option) => {
            const counts = option.value && snapshot ? snapshot.platforms[option.value] : null;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={platform === option.value}
                onClick={() => router.replace(option.value ? `/?platform=${option.value}` : "/", { scroll: false })}
                className="tabular flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-mute hover:text-ink aria-pressed:border-transparent aria-pressed:bg-ink aria-pressed:text-night"
              >
                {option.value && <PlatformMark platform={option.value} className="size-[18px]" />}
                {option.label}
                {counts && <span className="font-normal opacity-70">{counts.total}</span>}
              </button>
            );
          })}
        </div>
      )}

      {working.data && working.data.items.length > 0 && (
        <section aria-labelledby="working-heading" className="!mt-8">
          <h2 id="working-heading" className="mb-4 text-xl font-semibold">
            In progress <span className="tabular font-normal text-mute">{working.data.total}</span>
          </h2>
          <div className="strip">
            {working.data.items.map((video) => (
              <VideoCard key={video.id} video={video} showSource />
            ))}
          </div>
        </section>
      )}

      {channels.length > 0 && (
        <section aria-labelledby="channels-heading">
          <h2 id="channels-heading" className="mb-4 text-xl font-semibold">
            Channels <span className="tabular font-normal text-mute">{channels.length}</span>
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {channels.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        </section>
      )}

      {recent.data && recent.data.items.length > 0 && !recentIsRepeat && (
        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="mb-4 text-xl font-semibold">
            Recently transcribed
          </h2>
          <div className="strip">
            {recent.data.items.map((video, index) => (
              <VideoCard key={video.id} video={video} showSource eager={index < 6} />
            ))}
          </div>
        </section>
      )}

      {singles.data && singles.data.items.length > 0 && (
        <section aria-labelledby="singles-heading">
          <h2 id="singles-heading" className="text-xl font-semibold">
            Single videos <span className="tabular font-normal text-mute">{singles.data.total}</span>
          </h2>
          <p className="mb-4 mt-1 text-sm text-mute">Added on their own, without the rest of their channel.</p>
          <Sheet videos={singles.data.items} showSource />
        </section>
      )}

      {nothingHere && <p className="text-mute">{`Nothing from ${platform === "youtube" ? "YouTube" : "TikTok"} in your library yet.`}</p>}
      {empty && (
        <p className="max-w-3xl text-mute">
          Your library is empty. Paste a link above to add the first video. Videos with captions take a few seconds; the rest are transcribed on this computer.
        </p>
      )}
    </div>
  );
}

export default function LibraryPage() {
  return (
    <Suspense>
      <Library />
    </Suspense>
  );
}
