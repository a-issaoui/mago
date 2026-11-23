"use client";

import { useEffect, useState } from "react";
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

const looksLikeLink = (text: string) => /(youtube\.com|youtu\.be|tiktok\.com)\//i.test(text);

/** The paste box. It recognises a link as it is typed or pasted and opens
 *  into a preview card; nothing starts until the button is pressed. */
export function PasteBox({ onAdded }: { onAdded?: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(() => params.get("add") ?? "");
  const [fetched, setFetched] = useState<{ text: string; preview?: Preview; message?: string } | null>(null);
  const [adding, setAdding] = useState(false);

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
        ? { step: "error", message: "Paste a YouTube or TikTok link: a video, a channel, a playlist or a profile." }
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
    <div className={`rounded-[22px] border bg-surface shadow-[var(--shadow-panel)] transition-[border-color,box-shadow] ${open ? "border-murex" : "border-line-strong"} focus-within:border-murex focus-within:shadow-[0_0_0_4px_color-mix(in_oklab,var(--murex)_22%,transparent)]`}>
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
        placeholder="Paste a YouTube or TikTok link"
        className="h-14 w-full rounded-[22px] bg-transparent px-5 text-lg outline-none placeholder:text-mute sm:h-16 sm:px-6"
      />
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
          {adding ? "Adding" : isVideo ? "Transcribe this video" : `Transcribe all ${preview.video_count ? `${preview.video_count} videos` : `of this ${preview.kind}`}`}
        </Button>
      )}
    </div>
  );
}
