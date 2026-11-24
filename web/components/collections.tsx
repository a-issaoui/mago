"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CornerLeftUpIcon, FolderIcon, FolderInputIcon, FolderPlusIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { act } from "@/lib/act";
import { api, collectionTree, thumbUrl, type Collection } from "@/lib/api";

/** Ask for a name and create the collection. `onCreated` gets the new (or existing) one. */
export function NewCollectionDialog({ open, onOpenChange, onCreated, parent }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (collection: Collection) => void; parent?: Collection }) {
  const [name, setName] = useState("");
  async function create() {
    const made = await act(() => api<Collection>("/collections", { method: "POST", body: JSON.stringify({ name, parent_id: parent?.id ?? null }) }));
    if (!made) return;
    setName("");
    onOpenChange(false);
    onCreated(made);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{parent ? `New collection in ${parent.name}` : "New collection"}</DialogTitle>
          <DialogDescription>A collection groups videos from any channel, for example by topic or project.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) create();
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Name</span>
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Local SEO" className="field w-full px-4" />
          </label>
          <DialogFooter className="mt-5">
            <Button type="submit" disabled={!name.trim()}>
              Create collection
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** On a video: tick the collections it belongs to, or make a new one. */
export function CollectionPicker({ videoId, collections, memberOf, onChanged }: { videoId: number; collections: Collection[]; memberOf: number[]; onChanged: () => void }) {
  const [creating, setCreating] = useState(false);
  const toggle = (collection: Collection, on: boolean) =>
    act(
      () => (on ? api(`/collections/${collection.id}/videos`, { method: "POST", body: JSON.stringify({ video_id: videoId }) }) : api(`/collections/${collection.id}/videos/${videoId}`, { method: "DELETE" })),
      on ? `Added to ${collection.name}` : `Removed from ${collection.name}`,
    ).then(onChanged);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          <FolderPlusIcon />
          {memberOf.length ? `In ${memberOf.length} ${memberOf.length === 1 ? "collection" : "collections"}` : "Add to a collection"}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {collectionTree(collections).map(({ collection, inside }) => (
            <DropdownMenuCheckboxItem key={collection.id} className={inside ? "pl-6" : undefined} checked={memberOf.includes(collection.id)} onCheckedChange={(checked) => toggle(collection, Boolean(checked))}>
              {collection.name}
            </DropdownMenuCheckboxItem>
          ))}
          {collections.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={() => setCreating(true)}>
            <FolderPlusIcon />
            New collection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewCollectionDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(collection) => act(() => api(`/collections/${collection.id}/videos`, { method: "POST", body: JSON.stringify({ video_id: videoId }) }), `Added to ${collection.name}`).then(onChanged)}
      />
    </>
  );
}

/** The "..." menu of a collection: rename, nest, move, delete. Used on its page and on its card. */
export function CollectionMenu({ collection, all, onChanged, onDeleted, onCard }: { collection: Collection; all: Collection[]; onChanged: () => void; onDeleted?: () => void; onCard?: boolean }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const parent = all.find((other) => other.id === collection.parent_id);
  // Where it may go: a top-level collection, and only if this one holds no collections itself.
  const targets = collection.children === 0 ? all.filter((other) => other.parent_id === null && other.id !== collection.id && other.id !== collection.parent_id) : [];
  const move = (to: Collection | null) =>
    act(() => api(`/collections/${collection.id}`, { method: "PUT", body: JSON.stringify({ parent_id: to?.id ?? null }) }), to ? `Moved into ${to.name}` : "Moved to the top").then(onChanged);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size={onCard ? "icon" : "icon-lg"}
              aria-label={`Rename, move or delete ${collection.name}`}
              className={onCard ? "absolute right-2 top-2 z-10 bg-surface/90 backdrop-blur" : undefined}
            />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem
            onClick={() => {
              setName(collection.name);
              setRenaming(true);
            }}
          >
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          {collection.parent_id === null && (
            <DropdownMenuItem onClick={() => setAdding(true)}>
              <FolderPlusIcon />
              New collection inside
            </DropdownMenuItem>
          )}
          {parent && (
            <DropdownMenuItem onClick={() => move(null)}>
              <CornerLeftUpIcon />
              <span className="truncate">{`Move out of ${parent.name}`}</span>
            </DropdownMenuItem>
          )}
          {targets.map((target) => (
            <DropdownMenuItem key={target.id} onClick={() => move(target)}>
              <FolderInputIcon />
              <span className="truncate">{`Move into ${target.name}`}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2Icon />
            Delete this collection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewCollectionDialog open={adding} onOpenChange={setAdding} parent={collection} onCreated={(made) => router.push(`/k/${made.id}`)} />

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename collection</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const done = await act(() => api(`/collections/${collection.id}`, { method: "PUT", body: JSON.stringify({ name }) }), "Renamed");
              if (done) {
                setRenaming(false);
                onChanged();
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

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Delete ${collection.name}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {collection.children > 0
                ? `Only the grouping is deleted. Its ${collection.children} ${collection.children === 1 ? "collection moves" : "collections move"} to the top, and every video and transcript stays in the library.`
                : "Only the grouping is deleted. Its videos and their transcripts stay in the library."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const gone = await act(() => api(`/collections/${collection.id}`, { method: "DELETE" }).then(() => true), "Collection deleted");
                if (!gone) return;
                setDeleting(false);
                onChanged();
                onDeleted?.();
              }}
            >
              Delete collection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A collection as a card. With `all` and `onChanged` it also carries the "..." menu. */
export function CollectionCard({ collection, all, onChanged }: { collection: Collection; all?: Collection[]; onChanged?: () => void }) {
  return (
    <div className="relative">
      {all && onChanged && <CollectionMenu collection={collection} all={all} onChanged={onChanged} onCard />}
      <CollectionLink collection={collection} />
    </div>
  );
}

function CollectionLink({ collection }: { collection: Collection }) {
  return (
    <Link href={`/k/${collection.id}`} className="panel group block overflow-hidden transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-murex">
      <div className="flex h-24 w-full overflow-hidden bg-raised">
        {collection.covers.length === 0 && (
          <span className="grid w-full place-items-center text-mute">
            <FolderIcon className="size-7" />
          </span>
        )}
        {collection.covers.map((cover) => (
          // eslint-disable-next-line @next/next/no-img-element -- local, already resized
          <img key={cover.thumb_path} src={thumbUrl(cover.thumb_path)!} alt="" className="h-full min-w-0 flex-1 object-cover" />
        ))}
      </div>
      <div className="px-4 py-3">
        <p className="truncate font-semibold">{collection.name}</p>
        <p className="tabular text-sm text-mute">
          {collection.children > 0 && `${collection.children} ${collection.children === 1 ? "collection" : "collections"}, `}
          {collection.videos === 1 ? "1 video" : `${collection.videos} videos`}
        </p>
      </div>
    </Link>
  );
}
