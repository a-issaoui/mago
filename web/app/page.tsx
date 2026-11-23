"use client";

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PlatformMark } from "@/components/icons";
import { useLive, useLiveKey } from "@/components/live";
import { Pager } from "@/components/pager";
import { PageHeader } from "@/components/page-header";
import { CollectionCard, NewCollectionDialog } from "@/components/collections";
import { PasteBox } from "@/components/paste-box";
import { Button } from "@/components/ui/button";
import { Strip } from "@/components/strip";
import { Pills } from "@/components/pills";
import { SourceCard } from "@/components/source-card";
import { Sheet, VideoCard } from "@/components/video-card";
import { useTitle } from "@/hooks/use-title";
import { PLATFORMS, platformName, useApi, type Collection, type Platform, type Source, type Video } from "@/lib/api";

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
  const collections = useApi<Collection[]>("/collections", key);
  const [creating, setCreating] = useState(false);
  const going = useApi<Page>(`/videos?sort=continue&limit=12${filter}`, key);
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
    <div className="space-y-11 sm:space-y-12">
      <section>
        {firstVisit ? (
          <div className="max-w-3xl pt-2 sm:pt-10">
            <h1 className="display text-[44px] sm:text-[72px]">Keep what was said</h1>
            <p className="mb-7 mt-4 max-w-xl text-base text-mute sm:text-lg">
              Paste one video or a whole channel. Mago saves the words with their timestamps, so you can search them and read along.
            </p>
          </div>
        ) : (
          <PageHeader title="Library" note="Paste a video or a channel to add it. Everything you add is transcribed and searchable." />
        )}
        <div>
          <PasteBox onAdded={refresh} />
          {sources.error && <p className="mt-4 text-sm text-amber">{sources.error}</p>}
        </div>
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
              { value: "" as Platform | "", label: "Everything" },
              ...PLATFORMS.filter((name) => name === "youtube" || name === "tiktok" || (snapshot?.platforms[name]?.total ?? 0) > 0).map((name) => ({
                value: name as Platform | "",
                label: platformName(name),
                count: snapshot?.platforms[name]?.total,
                icon: <PlatformMark platform={name} className="size-[18px]" />,
              })),
            ]}
          />
        </div>
      )}

      {working.data && working.data.items.length > 0 && (
        <section aria-labelledby="working-heading" className="!mt-9">
          <h2 id="working-heading" className="mb-4 flex flex-wrap items-baseline gap-x-2 text-lg font-semibold tracking-tight">
            {stopped.length === 2 ? "Waiting" : "In progress"}
            <span className="tabular font-normal text-mute">{working.data.total}</span>
            {stopped.length > 0 && (
              <span className="text-sm font-normal text-amber">
                {stopped.length === 2 ? "Downloads are stopped. Resume them in Activity." : `${platformName(stopped[0])} downloads are stopped.`}
              </span>
            )}
          </h2>
          <Strip label={stopped.length === 2 ? "waiting videos" : "videos in progress"}>
            {working.data.items.map((video) => (
              <VideoCard key={video.id} video={video} showSource />
            ))}
          </Strip>
        </section>
      )}

      {going.data && going.data.items.length > 0 && (
        <section aria-labelledby="continue-heading">
          <h2 id="continue-heading" className="mb-4 text-lg font-semibold tracking-tight">
            Continue
          </h2>
          <Strip label="videos you started">
            {going.data.items.map((video) => (
              <VideoCard key={video.id} video={video} showSource />
            ))}
          </Strip>
        </section>
      )}

      {channels.length > 0 && (
        <section aria-labelledby="channels-heading">
          <h2 id="channels-heading" className="mb-4 text-lg font-semibold tracking-tight">
            Channels <span className="tabular font-normal text-mute">{channels.length}</span>
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {channels.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        </section>
      )}

      {!empty && collections.data && !platform && (
        <section aria-labelledby="collections-heading">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="collections-heading" className="text-lg font-semibold tracking-tight">
              Collections {collections.data.length > 0 && <span className="tabular font-normal text-mute">{collections.data.length}</span>}
            </h2>
            <Button variant="outline" onClick={() => setCreating(true)}>
              New collection
            </Button>
          </div>
          {collections.data.length === 0 ? (
            <p className="text-sm text-mute">Group videos from any channel by topic or project. Create one here, then add videos from their pages.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
              {collections.data.map((collection) => (
                <CollectionCard key={collection.id} collection={collection} />
              ))}
            </div>
          )}
          <NewCollectionDialog open={creating} onOpenChange={setCreating} onCreated={(made) => router.push(`/k/${made.id}`)} />
        </section>
      )}

      {recent.data && recent.data.items.length > 0 && !recentIsRepeat && (
        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="mb-4 text-lg font-semibold tracking-tight">
            Recently transcribed
          </h2>
          <Strip label="recently transcribed videos">
            {recent.data.items.map((video, index) => (
              <VideoCard key={video.id} video={video} showSource eager={index < 6} />
            ))}
          </Strip>
        </section>
      )}

      {singlesShown && singlesShown.items.length > 0 && (
        <section aria-labelledby="singles-heading" ref={singlesTop} className="scroll-mt-20">
          <h2 id="singles-heading" className="text-lg font-semibold tracking-tight">
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

      {nothingHere && platform && <p className="text-mute">{`Nothing from ${platformName(platform)} in your library yet.`}</p>}
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
