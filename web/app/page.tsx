"use client";

import { useLiveKey } from "@/components/live";
import { PasteBox } from "@/components/paste-box";
import { SourceCard } from "@/components/source-card";
import { VideoCard } from "@/components/video-card";
import { useApi, type Source, type Video } from "@/lib/api";

export default function LibraryPage() {
  const key = useLiveKey();
  const sources = useApi<Source[]>("/sources", key);
  const recent = useApi<{ total: number; items: Video[] }>("/videos?sort=recent&limit=24", key);
  const working = useApi<{ total: number; items: Video[] }>("/videos?status=working&limit=12", key);

  const channels = sources.data?.filter((source) => source.kind !== "video") ?? [];
  const empty = sources.data?.length === 0;
  const refresh = () => {
    sources.reload();
    working.reload();
  };

  return (
    <div className="space-y-12 sm:space-y-16">
      <section className="max-w-3xl pt-2 sm:pt-6">
        <h1 className="display text-[44px] sm:text-[72px]">Keep what was said</h1>
        <p className="mb-6 mt-3 max-w-xl text-base text-mute sm:text-lg">
          Paste one video or a whole channel. Mago saves the words with their timestamps, so you can search them and read along.
        </p>
        <PasteBox onAdded={refresh} />
        {sources.error && <p className="mt-4 text-sm text-amber">{sources.error}</p>}
      </section>

      {working.data && working.data.items.length > 0 && (
        <section aria-labelledby="working-heading">
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
            Channels
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {channels.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        </section>
      )}

      {recent.data && recent.data.items.length > 0 && (
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

      {empty && (
        <p className="max-w-3xl text-mute">
          Your library is empty. Paste a link above to add the first video. Videos with captions take a second or two; the rest are transcribed on this computer.
        </p>
      )}
    </div>
  );
}
