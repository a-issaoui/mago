"use client";

import { useState } from "react";
import { PlatformMark, PlayIcon } from "@/components/icons";
import { clock, thumbUrl, type Platform, type Shape, type Status } from "@/lib/api";

type Props = {
  path: string | null;
  blur: string | null;
  shape: Shape;
  platform?: Platform;
  duration?: number | null;
  status?: Status;
  progress?: number;
  size?: "sm" | "lg";
  eager?: boolean;
  showPlay?: boolean;
  className?: string;
};

/** A thumbnail frame in the video's own shape. The blurred placeholder holds
 *  the space, so nothing jumps when the picture arrives. */
export function Thumb({ path, blur, shape, platform, duration, status, progress = 0, size = "sm", eager, showPlay, className = "" }: Props) {
  const [loaded, setLoaded] = useState(false);
  const src = thumbUrl(path, size);
  const waiting = status === "queued" || status === "listed";
  const working = status === "captions" || status === "downloading" || status === "transcribing";
  const unavailable = status === "failed" || status === "skipped";

  return (
    <div
      className={`frame ${shape === "tall" ? "aspect-[9/16]" : "aspect-video"} ${className}`}
      style={blur ? { backgroundImage: `url(${blur})` } : undefined}
    >
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- already resized WebP served from the local library
        <img
          src={src}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          data-loaded={loaded}
          ref={(node) => {
            if (node?.complete && node.naturalWidth > 0) setLoaded(true);
          }}
          onLoad={() => setLoaded(true)}
          className={waiting || unavailable ? "saturate-[0.35] brightness-[0.6]" : working ? "brightness-[0.55]" : ""}
        />
      )}
      {platform && (
        <span className="absolute left-1.5 top-1.5 grid size-6 place-items-center rounded-md bg-black/55 text-white backdrop-blur-sm">
          <PlatformMark platform={platform} className="size-3.5 [--night:#000]" />
        </span>
      )}
      {duration != null && duration > 0 && (
        <span className="tabular absolute bottom-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium leading-none text-white">
          {clock(duration)}
        </span>
      )}
      {working && <ProgressRing progress={status === "transcribing" ? progress : null} />}
      {showPlay && !working && !waiting && !unavailable && (
        <span className="play absolute inset-0 grid place-items-center bg-black/25">
          <span className="grid size-11 place-items-center rounded-full bg-murex text-on-murex shadow-lg">
            <PlayIcon className="size-5 translate-x-px" />
          </span>
        </span>
      )}
    </div>
  );
}

/** The status ring shown on a thumbnail while its video is being worked on. */
function ProgressRing({ progress }: { progress: number | null }) {
  const radius = 15;
  const length = 2 * Math.PI * radius;
  const known = progress != null && progress > 0;
  return (
    <span className="absolute inset-0 grid place-items-center" role="img" aria-label={known ? `${Math.round(progress * 100)}% transcribed` : "Working"}>
      <svg viewBox="0 0 40 40" className={`size-11 -rotate-90 ${known ? "" : "animate-spin"}`}>
        <circle cx="20" cy="20" r={radius} fill="rgb(0 0 0 / 0.45)" stroke="rgb(255 255 255 / 0.25)" strokeWidth="3" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          stroke="var(--murex)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - (known ? progress : 0.25))}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
    </span>
  );
}
