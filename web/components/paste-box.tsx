"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PlatformMark } from "@/components/icons";
import { api, clock, kindLabel, type Preview, type Source } from "@/lib/api";

type State =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "ready"; preview: Preview }
  | { step: "error"; message: string };

// Anything shaped like a web address is sent to Mago to judge (YouTube, TikTok, or a podcast feed).
const looksLikeLink = (text: string) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+\/\S*$/i.test(text) && !/\s/.test(text);

/** Send a file in pieces (the web server caps a single request at 10 MB) and report progress. */
async function uploadFile(file: File, onProgress: (fraction: number) => void): Promise<number> {
  const head = { "x-mago": "1", "content-type": "application/json" };
  const fail = async (response: Response) => {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : "The upload failed. Try again.");
  };
  const started = await fetch("/api/files", { method: "POST", headers: head, body: JSON.stringify({ name: file.name, size: file.size }) });
  if (!started.ok) await fail(started);
  const { upload_id, chunk_bytes } = await started.json();
  for (let offset = 0; offset < file.size; offset += chunk_bytes) {
    const piece = await fetch(`/api/files/${upload_id}/chunk?offset=${offset}`, { method: "PUT", headers: { "x-mago": "1" }, body: file.slice(offset, offset + chunk_bytes) });
    if (!piece.ok) await fail(piece);
    onProgress(Math.min(1, (offset + chunk_bytes) / file.size));
  }
  const finished = await fetch(`/api/files/${upload_id}/finish`, { method: "POST", headers: head, body: JSON.stringify({ name: file.name, size: file.size }) });
  if (!finished.ok) await fail(finished);
  return (await finished.json()).video_id;
}

/** The paste box. It recognises a link as it is typed or pasted and opens
 *  into a preview card; nothing starts until the button is pressed. */
export function PasteBox({ onAdded }: { onAdded?: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(() => params.get("add") ?? "");
  const [fetched, setFetched] = useState<{ text: string; preview?: Preview; message?: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [upload, setUpload] = useState<{ name: string; fraction: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  async function sendFile(file: File | undefined) {
    if (!file || upload) return;
    setUpload({ name: file.name, fraction: 0 });
    try {
      const videoId = await uploadFile(file, (fraction) => setUpload({ name: file.name, fraction }));
      toast.success("Uploaded. It is being transcribed.");
      onAdded?.();
      router.push(`/v/${videoId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The upload failed.");
    } finally {
      setUpload(null);
    }
  }

  const text = value.trim();
  const isLink = looksLikeLink(text);

  useEffect(() => {
    if (!isLink) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const preview = await api<Preview>("/preview", { method: "POST", body: JSON.stringify({ url: text }) });
        if (!cancelled) setFetched({ text, preview });
      } catch (error) {
        if (!cancelled) setFetched({ text, message: error instanceof Error ? error.message : "Couldn't read that link." });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, isLink]);

  const answer = fetched?.text === text ? fetched : null;
  const state: State = !text
    ? { step: "idle" }
    : !isLink
      ? text.length > 8
        ? { step: "error", message: "Paste a YouTube or TikTok link (video, channel, playlist, profile) or a podcast feed. Or drop an audio or video file here." }
        : { step: "idle" }
      : answer?.preview
        ? { step: "ready", preview: answer.preview }
        : answer?.message
          ? { step: "error", message: answer.message }
          : { step: "checking" };

  async function add(preview: Preview) {
    setAdding(true);
    try {
      const source = await api<Source>("/sources", { method: "POST", body: JSON.stringify({ url: preview.url }) });
      setValue("");
      onAdded?.();
      toast.success(source.kind === "video" ? "Added. It is being transcribed." : "Added. Listing its videos now.");
      if (source.kind !== "video") router.push(`/c/${source.id}`);
    } catch (error) {
      setFetched({ text, message: error instanceof Error ? error.message : "Couldn't add that link." });
    } finally {
      setAdding(false);
    }
  }

  const open = state.step !== "idle";
  return (
    <div
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        sendFile(event.dataTransfer.files[0]);
      }}
      className={`rounded-[22px] border bg-surface ${dragging ? "!border-murex ring-4 ring-murex/25" : ""} shadow-[var(--shadow-panel)] transition-[border-color,box-shadow] ${open ? "border-murex" : "border-line-strong"} focus-within:border-murex focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--murex)_22%,transparent)]`}>
      <label htmlFor="paste" className="sr-only">
        YouTube or TikTok link
      </label>
      <input
        id="paste"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Paste a YouTube, TikTok or podcast link, or drop a file"
        className="h-14 w-full rounded-[22px] bg-transparent px-5 text-lg outline-none placeholder:text-mute sm:h-16 sm:px-6"
      />
      <input ref={picker} type="file" accept="audio/*,video/*,.mkv,.flac,.opus" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => { sendFile(event.target.files?.[0]); event.target.value = ""; }} />
      {upload ? (
        <div className="border-t border-line px-5 py-4 sm:px-6" role="status">
          <p className="flex justify-between gap-4 text-sm">
            <span className="min-w-0 truncate">{`Uploading ${upload.name}`}</span>
            <span className="tabular shrink-0 text-mute">{`${Math.round(upload.fraction * 100)}%`}</span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
            <div className="glow-bg h-full rounded-full transition-[width] duration-300" style={{ width: `${upload.fraction * 100}%` }} />
          </div>
        </div>
      ) : (
        !open && (
          <p className="border-t border-line px-5 py-2.5 text-sm text-mute sm:px-6">
            {dragging ? "Drop the file to transcribe it" : "A video, a channel, a playlist, a podcast feed, or "}
            {!dragging && (
              <button type="button" onClick={() => picker.current?.click()} className="min-h-6 font-medium text-murex underline decoration-transparent underline-offset-4 hover:decoration-current">
                a file from this computer
              </button>
            )}
          </p>
        )
      )}
      <div aria-live="polite">
        {state.step === "checking" && (
          <div className="flex items-center gap-4 border-t border-line p-4 sm:p-5">
            <div className="skeleton h-[72px] w-32 shrink-0" />
            <div className="flex-1">
              <div className="skeleton h-4 w-3/5" />
              <div className="skeleton mt-2 h-3.5 w-2/5" />
            </div>
          </div>
        )}
        {state.step === "error" && <p className="border-t border-line px-5 py-4 text-sm text-amber sm:px-7">{state.message}</p>}
        {state.step === "ready" && <PreviewCard preview={state.preview} adding={adding} onAdd={() => add(state.preview)} onUseChannel={setValue} />}
      </div>
    </div>
  );
}

function PreviewCard({ preview, adding, onAdd, onUseChannel }: { preview: Preview; adding: boolean; onAdd: () => void; onUseChannel: (url: string) => void }) {
  const router = useRouter();
  const isVideo = preview.kind === "video";
  const picture = preview.thumb_url ?? preview.avatar_url;
  const existing = isVideo ? preview.existing_video_id : preview.existing_source_id;
  const detail = isVideo
    ? [preview.channel, clock(preview.duration_s)].filter(Boolean).join(", ")
    : preview.platform === "podcast"
      ? `${preview.video_count} episodes. Every one is downloaded and transcribed here, a few minutes per hour of audio.`
      : preview.video_count
        ? `${preview.video_count} videos. Every one will be transcribed.`
        : "Every video will be listed, then transcribed.";

  return (
    <div className="flex flex-col gap-4 border-t border-line p-4 sm:flex-row sm:items-center sm:p-5">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote preview, shown once before anything is saved
          <img src={picture} alt="" referrerPolicy="no-referrer" className={`h-[72px] shrink-0 rounded-lg bg-raised object-cover ${isVideo ? "w-32" : "w-[72px]"}`} />
        ) : (
          <div className="grid size-[72px] shrink-0 place-items-center rounded-lg bg-raised text-mute">
            <PlatformMark platform={preview.platform} className="size-6" />
          </div>
        )}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-medium text-mute">
            <PlatformMark platform={preview.platform} className="size-4" />
            {kindLabel(preview.platform, preview.kind)}
            {!isVideo && preview.handle ? `, ${preview.handle}` : ""}
          </p>
          <p className="mt-0.5 line-clamp-2 text-base font-semibold leading-snug">{preview.title || preview.url}</p>
          <p className="mt-0.5 truncate text-sm text-mute">{detail}</p>
          {isVideo && preview.channel_url && (
            <button type="button" onClick={() => onUseChannel(preview.channel_url!)} className="mt-1 text-left text-sm font-medium text-murex underline decoration-transparent underline-offset-4 hover:decoration-current">
              {`Look at the whole channel instead${preview.channel ? ` (${preview.channel})` : ""}`}
            </button>
          )}
        </div>
      </div>
      {existing ? (
        <Button variant="outline" size="lg" className="h-11 shrink-0 px-5" onClick={() => router.push(isVideo ? `/v/${existing}` : `/c/${existing}`)}>
          Already in your library. Open it
        </Button>
      ) : (
        <Button size="lg" className="h-11 shrink-0 px-6 font-semibold" onClick={onAdd} disabled={adding}>
          {adding ? "Adding" : isVideo ? "Transcribe this video" : preview.platform === "podcast" ? `Transcribe all ${preview.video_count} episodes` : `Transcribe all ${preview.video_count ? `${preview.video_count} videos` : `of this ${preview.kind}`}`}
        </Button>
      )}
    </div>
  );
}
