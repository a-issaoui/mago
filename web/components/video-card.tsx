"use client";

import Link from "next/link";
import { useLive } from "@/components/live";
import { Thumb } from "@/components/thumb";
import { isWorking, shortDate, statusLabel, type Video } from "@/lib/api";

const dotColor = (video: Video) =>
  video.status === "done" ? "bg-sea" : video.status === "failed" || video.status === "skipped" ? "bg-amber" : isWorking(video.status) ? "bg-murex" : "bg-mute";

export function VideoCard({ video, showSource = false, eager = false }: { video: Video; showSource?: boolean; eager?: boolean }) {
  const { snapshot } = useLive();
  const working = isWorking(video.status) && video.status !== "queued";
  const paused = video.status === "queued" && (snapshot?.paused.includes(video.platform) ?? false);
  const meta = paused ? "Paused" : video.status === "done" ? shortDate(video.published_at) || statusLabel(video) : statusLabel(video);
  return (
    <Link href={`/v/${video.id}`} className={`card group block min-w-0 rounded-[10px] ${video.shape}`} title={video.title ?? undefined} aria-label={`${video.title || "Untitled video"}, ${video.platform === "youtube" ? "YouTube" : "TikTok"}, ${meta}`}>
      <Thumb
        path={video.thumb_path}
        blur={video.thumb_blur}
        shape={video.shape}
        platform={video.platform}
        duration={video.duration_s}
        status={video.status}
        progress={video.progress}
        eager={eager}
        showPlay
        watched={video.position_s && video.duration_s ? Math.min(1, video.position_s / video.duration_s) : 0}
      />
      <div className="mt-2 min-w-0">
        <p className={`line-clamp-2 font-medium leading-snug ${video.shape === "tall" ? "text-[12.5px]" : "text-sm"} ${video.status === "done" ? "" : "text-mute"}`}>
          {video.title || "Untitled video"}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-mute">
          <span className={`size-1.5 shrink-0 rounded-full ${dotColor(video)} ${working ? "live-dot" : ""}`} />
          <span className="truncate">
            {showSource && video.source_title && video.source_title !== video.title && video.shape === "wide" ? `${video.source_title}, ${meta}` : meta}
          </span>
        </p>
      </div>
    </Link>
  );
}

/** Videos laid out as a contact sheet; each keeps its own shape. */
export function Sheet({ videos, showSource }: { videos: Video[]; showSource?: boolean }) {
  const allTall = videos.every((video) => video.shape === "tall");
  return (
    <div className={`sheet ${allTall ? "all-tall" : ""}`}>
      {videos.map((video, index) => (
        <VideoCard key={video.id} video={video} showSource={showSource} eager={index < 8} />
      ))}
    </div>
  );
}

export function SheetSkeleton({ count = 9, tall = false }: { count?: number; tall?: boolean }) {
  return (
    <div className={`sheet ${tall ? "all-tall" : ""}`} aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={tall ? "tall" : "wide"}>
          <div className={`skeleton ${tall ? "aspect-[9/16]" : "aspect-video"}`} />
          <div className="skeleton mt-2 h-3.5 w-4/5" />
          <div className="skeleton mt-1.5 h-3 w-2/5" />
        </div>
      ))}
    </div>
  );
}
