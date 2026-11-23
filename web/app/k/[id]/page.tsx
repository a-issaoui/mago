"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CornerLeftUpIcon, FolderInputIcon, FolderPlusIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { Breadcrumb } from "@/components/breadcrumb";
import { CollectionCard, NewCollectionDialog } from "@/components/collections";
import { useLiveKey } from "@/components/live";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/pager";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetSkeleton } from "@/components/video-card";
import { useTitle } from "@/hooks/use-title";
import { act } from "@/lib/act";
import { api, useApi, type Collection, type Video } from "@/lib/api";

const PAGE = 48;

function CollectionView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const key = useLiveKey();
  const page = Math.max(1, Number(useSearchParams().get("page")) || 1);
  const collection = useApi<Collection>(`/collections/${id}`, key);
  const videos = useApi<{ total: number; items: Video[] }>(`/videos?collection_id=${id}&limit=${PAGE}&offset=${(page - 1) * PAGE}`, key);
  const all = useApi<Collection[]>("/collections", key);
  const here = collection.data;
  const parent = all.data?.find((other) => other.id === here?.parent_id);
  const inside = (all.data ?? []).filter((other) => other.parent_id === Number(id));
  // Where this collection may go: a top-level collection, and only if this one holds no collections itself.
  const targets = here && inside.length === 0 ? (all.data ?? []).filter((other) => other.parent_id === null && other.id !== here.id && other.id !== here.parent_id) : [];
  const move = (to: Collection | null) =>
    act(() => api(`/collections/${id}`, { method: "PUT", body: JSON.stringify({ parent_id: to?.id ?? null }) }), to ? `Moved into ${to.name}` : "Moved to the top").then(() => {
      collection.reload();
      all.reload();
    });
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
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
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="icon-lg" aria-label="More actions for this collection" />}>
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem
              onClick={() => {
                setName(collection.data?.name ?? "");
                setRenaming(true);
              }}
            >
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            {here && here.parent_id === null && (
              <DropdownMenuItem onClick={() => setAdding(true)}>
                <FolderPlusIcon />
                New collection inside
              </DropdownMenuItem>
            )}
            {parent && (
              <DropdownMenuItem onClick={() => move(null)}>
                <CornerLeftUpIcon />
                {`Move out of ${parent.name}`}
              </DropdownMenuItem>
            )}
            {targets.map((target) => (
              <DropdownMenuItem key={target.id} onClick={() => move(target)}>
                <FolderInputIcon />
                <span className="truncate">{`Move into ${target.name}`}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={async () => {
                const gone = await act(() => api(`/collections/${id}`, { method: "DELETE" }).then(() => true), inside.length ? "Collection deleted. The collections inside it are now at the top." : "Collection deleted. Its videos are still in the library.");
                if (gone) router.push("/");
              }}
            >
              <Trash2Icon />
              Delete this collection
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>

      {inside.length > 0 && (
        <section aria-label="Collections inside" className="mb-10 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
          {inside.map((child) => (
            <CollectionCard key={child.id} collection={child} />
          ))}
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

      <NewCollectionDialog open={adding} onOpenChange={setAdding} parent={here} onCreated={(made) => router.push(`/k/${made.id}`)} />
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename collection</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const done = await act(() => api(`/collections/${id}`, { method: "PUT", body: JSON.stringify({ name }) }), "Renamed");
              if (done) {
                setRenaming(false);
                collection.reload();
              }
            }}
          >
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} aria-label="Collection name" className="field w-full px-4" />
            <DialogFooter className="mt-5">
              <Button type="submit" disabled={!name.trim()}>
                Save name
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
