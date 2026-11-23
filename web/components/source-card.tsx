"use client";

import Link from "next/link";
import { PlatformMark } from "@/components/icons";
import { mediaUrl, thumbUrl, type Source } from "@/lib/api";

export function Avatar({ source, className = "size-12" }: { source: Pick<Source, "avatar_path" | "title" | "handle" | "covers">; className?: string }) {
  const src = mediaUrl(source.avatar_path) ?? thumbUrl(source.covers?.[0]?.thumb_path ?? null);
  const initial = (source.title || source.handle || "?").replace(/^@/, "").charAt(0).toUpperCase();
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- local, already resized
    <img src={src} alt="" className={`${className} shrink-0 rounded-full bg-raised object-cover ring-4 ring-surface`} />
  ) : (
    <span className={`${className} display grid shrink-0 place-items-center rounded-full bg-murex text-xl text-on-murex ring-4 ring-surface`}>{initial}</span>
  );
}

/** A banner strip. Channels without a banner (every TikTok profile) get a
 *  strip made of their own latest thumbnails instead. */
export function Banner({ source, className = "" }: { source: Pick<Source, "banner_path" | "covers">; className?: string }) {
  const banner = mediaUrl(source.banner_path);
  if (banner) {
    // eslint-disable-next-line @next/next/no-img-element -- local, already resized
    return <img src={banner} alt="" className={`w-full bg-raised object-cover ${className}`} />;
  }
  const covers = source.covers ?? [];
  return (
    <div className={`flex w-full overflow-hidden bg-raised ${className}`}>
      {covers.map((cover) => (
        // eslint-disable-next-line @next/next/no-img-element -- local, already resized
        <img key={cover.thumb_path} src={thumbUrl(cover.thumb_path)!} alt="" className="h-full min-w-0 flex-1 object-cover" />
      ))}
    </div>
  );
}

export function progressText(source: Source): string {
  if (source.listing && source.videos_total === 0) return "Listing videos";
  if (source.videos_total === 0) return "No videos yet";
  if (source.videos_done === source.videos_total) return `${source.videos_total} transcribed`;
  return `${source.videos_done} of ${source.videos_total} transcribed`;
}

export function SourceCard({ source }: { source: Source }) {
  const fraction = source.videos_total ? source.videos_done / source.videos_total : 0;
  return (
    <Link href={`/c/${source.id}`} className="card group block overflow-hidden rounded-2xl border border-line bg-surface">
      <Banner source={source} className="h-24" />
      <div className="relative px-4 pb-4">
        <Avatar source={source} className="-mt-6 size-14" />
        <p className="mt-2 truncate text-lg font-semibold leading-tight">{source.title || source.handle || source.url}</p>
        <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-mute">
          <PlatformMark platform={source.platform} className="size-3.5 shrink-0" />
          {source.handle || (source.kind === "playlist" ? "Playlist" : "")}
        </p>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={source.videos_total} aria-valuenow={source.videos_done} aria-label="Transcribed">
          <div className="h-full origin-left rounded-full bg-sea transition-transform duration-500" style={{ transform: `scaleX(${fraction})` }} />
        </div>
        <p className="tabular mt-2 text-xs text-mute">{progressText(source)}</p>
      </div>
    </Link>
  );
}
