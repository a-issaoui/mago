"use client";

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PlatformMark } from "@/components/icons";
import { useLive, useLiveKey } from "@/components/live";
import { Pager } from "@/components/pager";
import { PasteBox } from "@/components/paste-box";
import { Pills } from "@/components/pills";
import { SourceCard } from "@/components/source-card";
import { Sheet, VideoCard } from "@/components/video-card";
import { useTitle } from "@/hooks/use-title";
import { useApi, type Platform, type Source, type Video } from "@/lib/api";

type Page = { total: number; items: Video[] };

function Library() {
  useTitle("Library");
  const router = useRouter();
  const params = useSearchParams();
  const platform = (params.get("platform") ?? "") as Platform | "";
  const filter = platform ? `&platform=${platform}` : "";
  const key = useLiveKey();
  const { snapshot } = useLive();
  const sources = useApi<Source[]>("/sources", key);
  const recent = useApi<Page>(`/videos?sort=recent&limit=24${filter}`, key);
  const working = useApi<Page>(`/videos?status=working&limit=12${filter}`, key);
  const SINGLES = 24;
  const [singlesPage, setSinglesPage] = useState(1);
  const singlesTop = useRef<HTMLElement>(null);
  const singles = useApi<Page>(`/videos?single=true&limit=${SINGLES}&offset=${(singlesPage - 1) * SINGLES}${filter}`, key);
  const [singlesShown, setSinglesShown] = useState<Page | null>(null);
  if (singles.data && singles.data !== singlesShown) setSinglesShown(singles.data);

  const channels = sources.data?.filter((source) => source.kind !== "video" && (!platform || source.platform === platform)) ?? [];
  const empty = sources.data?.length === 0;
  const stopped = snapshot?.paused ?? [];
  const refresh = () => {
    sources.reload();
    working.reload();
    singles.reload();
  };
  // With a small library the newest transcripts are the single videos listed below: don't show them twice.
  const singleIds = new Set(singles.data?.items.map((video) => video.id));
  const recentIsRepeat = Boolean(singlesPage === 1 && recent.data && singles.data && recent.data.items.every((video) => singleIds.has(video.id)));
  const nothingHere = !empty && sources.data && channels.length === 0 && singles.data?.total === 0;
  // The big headline is for the first visit; once there is a library, the library is the page.
  const firstVisit = empty || (!sources.data && !sources.error);

  return (
    <div className="space-y-12 sm:space-y-14">
      <section className={`max-w-3xl ${firstVisit ? "pt-2 sm:pt-10" : "pt-0"}`}>
        {firstVisit ? (
          <>
            <h1 className="display text-[44px] sm:text-[76px]">Keep what was said</h1>
            <p className="mb-7 mt-4 max-w-xl text-base text-mute sm:text-lg">
              Paste one video or a whole channel. Mago saves the words with their timestamps, so you can search them and read along.
            </p>
          </>
        ) : (
          <h1 className="display mb-5 text-[34px] sm:text-[44px]">Library</h1>
        )}
        <PasteBox onAdded={refresh} />
        {sources.error && <p className="mt-4 text-sm text-amber">{sources.error}</p>}
      </section>

      {!empty && sources.data && (
        <div className="!mt-9">
          <Pills
            label="Show"
            value={platform}
            onChange={(value) => {
              setSinglesPage(1);
              router.replace(value ? `/?platform=${value}` : "/", { scroll: false });
            }}
            options={[
              { value: "", label: "Everything" },
              { value: "youtube", label: "YouTube", count: snapshot?.platforms.youtube.total, icon: <PlatformMark platform="youtube" className="size-[18px]" /> },
              { value: "tiktok", label: "TikTok", count: snapshot?.platforms.tiktok.total, icon: <PlatformMark platform="tiktok" className="size-[18px]" /> },
            ]}
          />
        </div>
      )}

      {working.data && working.data.items.length > 0 && (
        <section aria-labelledby="working-heading" className="!mt-9">
          <h2 id="working-heading" className="mb-4 flex flex-wrap items-baseline gap-x-2 text-xl font-semibold">
            {stopped.length === 2 ? "Waiting" : "In progress"}
            <span className="tabular font-normal text-mute">{working.data.total}</span>
            {stopped.length > 0 && (
              <span className="text-sm font-normal text-amber">
                {stopped.length === 2 ? "Downloads are stopped. Resume them in Activity." : `${stopped[0] === "youtube" ? "YouTube" : "TikTok"} downloads are stopped.`}
              </span>
            )}
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

      {singlesShown && singlesShown.items.length > 0 && (
        <section aria-labelledby="singles-heading" ref={singlesTop} className="scroll-mt-20">
          <h2 id="singles-heading" className="text-xl font-semibold">
            Single videos <span className="tabular font-normal text-mute">{singlesShown.total}</span>
          </h2>
          <p className="mb-4 mt-1 text-sm text-mute">Added on their own, without the rest of their channel.</p>
          <Sheet videos={singlesShown.items} showSource />
          <Pager
            label="Single videos"
            className="mt-8"
            page={singlesPage}
            pageCount={Math.ceil(singlesShown.total / SINGLES)}
            onChange={(next) => {
              setSinglesPage(next);
              singlesTop.current?.scrollIntoView({ block: "start" });
            }}
          />
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
