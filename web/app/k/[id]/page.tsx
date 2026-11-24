"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Breadcrumb } from "@/components/breadcrumb";
import { CollectionCard, CollectionMenu } from "@/components/collections";
import { useLiveKey } from "@/components/live";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/pager";
import { Button } from "@/components/ui/button";
import { Sheet, SheetSkeleton } from "@/components/video-card";
import { useTitle } from "@/hooks/use-title";
import { PlatformMark } from "@/components/icons";
import { kindLabel, useApi, type Collection, type Video } from "@/lib/api";

const PAGE = 48;

function CollectionView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const key = useLiveKey();
  const page = Math.max(1, Number(useSearchParams().get("page")) || 1);
  const collection = useApi<Collection>(`/collections/${id}`, key);
  const videos = useApi<{ total: number; items: Video[] }>(`/videos?collection_id=${id}&sort=list&limit=${PAGE}&offset=${(page - 1) * PAGE}`, key);
  const all = useApi<Collection[]>("/collections", key);
  const here = collection.data;
  const parent = all.data?.find((other) => other.id === here?.parent_id);
  const inside = (all.data ?? []).filter((other) => other.parent_id === Number(id));
  useTitle(collection.data?.name);

  if (collection.error && !collection.data) {
    return (
      <div className="py-16 text-center">
        <p className="text-lg font-semibold">This collection doesn&apos;t exist</p>
        <Button className="mt-5" render={<Link href="/" />}>
          Back to the library
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Breadcrumb trail={[{ href: "/", label: "Library" }, ...(parent ? [{ href: `/k/${parent.id}`, label: parent.name }] : [])]} current={collection.data?.name} />
      <PageHeader
        title={collection.data?.name ?? " "}
        note={
          here
            ? `${inside.length ? `${inside.length} ${inside.length === 1 ? "collection" : "collections"} and ` : ""}${here.videos === 1 ? "1 video" : `${here.videos} videos`} in this collection.`
            : undefined
        }
      >
        {here && (
          <CollectionMenu
            collection={here}
            all={all.data ?? []}
            onChanged={() => {
              collection.reload();
              all.reload();
            }}
            onDeleted={() => router.push(parent ? `/k/${parent.id}` : "/")}
          />
        )}
      </PageHeader>

      {inside.length > 0 && (
        <section aria-label="Collections inside" className="mb-10 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
          {inside.map((child) => (
            <CollectionCard key={child.id} collection={child} all={all.data ?? []} onChanged={all.reload} />
          ))}
        </section>
      )}

      {here?.sources && here.sources.length > 0 && (
        <section aria-labelledby="from-the-list" className="mb-10">
          <h2 id="from-the-list" className="text-sm font-semibold text-mute">
            From the list
          </h2>
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
            {here.sources.map((source) => (
              <li key={source.id}>
                <Link href={`/c/${source.id}`} className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-raised sm:flex-row sm:items-baseline sm:gap-4 sm:px-5">
                  <span className="flex min-w-0 items-center gap-2 font-medium sm:w-2/5 sm:shrink-0">
                    <PlatformMark platform={source.platform} className="size-4 shrink-0" />
                    <span className="truncate">{source.title || kindLabel(source.platform, source.kind)}</span>
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-mute">{source.note || kindLabel(source.platform, source.kind)}</span>
                  {source.video_count != null && <span className="tabular shrink-0 text-sm text-mute">{`${source.video_count} videos`}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!videos.data ? (
        <SheetSkeleton />
      ) : videos.data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
          <p className="font-semibold">Nothing in this collection yet</p>
          <p className="mt-1 text-sm text-mute">Open a video and use &quot;Add to a collection&quot;, or move another collection into this one from its menu.</p>
        </div>
      ) : (
        <>
          <Sheet videos={videos.data.items} showSource />
          <Pager label="Videos" className="mt-10" page={page} pageCount={Math.ceil(videos.data.total / PAGE)} onChange={(next) => router.replace(next > 1 ? `/k/${id}?page=${next}` : `/k/${id}`)} />
        </>
      )}

    </div>
  );
}

export default function CollectionPage() {
  return (
    <Suspense>
      <CollectionView />
    </Suspense>
  );
}
