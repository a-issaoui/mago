"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { Platform, Shape } from "@/lib/api";

export type PlayerHandle = { seek: (seconds: number) => void; toggle: () => void };

type Props = {
  platform: Platform;
  videoId: string;
  shape: Shape;
  start?: number;
  title: string;
  onTime: (seconds: number) => void;
  ref: Ref<PlayerHandle>;
};

type YouTubePlayer = { getPlayerState?: () => number; pauseVideo?: () => void; getCurrentTime?: () => number; seekTo?: (s: number, allow: boolean) => void; playVideo?: () => void; destroy?: () => void };
type YouTubeApi = { Player: new (el: HTMLElement, options: object) => YouTubePlayer };

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youTubeApi: Promise<YouTubeApi> | null = null;

function loadYouTubeApi(): Promise<YouTubeApi> {
  youTubeApi ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.head.append(script);
  });
  return youTubeApi;
}

/** The embedded player. It reports the playing position so the transcript
 *  can follow, and seeks when a transcript line is clicked. */
export function Player({ platform, videoId, shape, start = 0, title, onTime, ref }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const youTube = useRef<YouTubePlayer | null>(null);
  const playing = useRef(false); // TikTok's player doesn't say; we track what we asked for
  const report = useRef(onTime);
  useEffect(() => {
    report.current = onTime;
  }, [onTime]);

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      if (platform === "youtube") {
        // The methods only exist once the player has loaded.
        youTube.current?.seekTo?.(seconds, true);
        youTube.current?.playVideo?.();
      } else {
        const send = (type: string, value?: number) => frame.current?.contentWindow?.postMessage({ type, value, "x-tiktok-player": true }, "https://www.tiktok.com");
        send("seekTo", seconds);
        send("play");
        playing.current = true;
      }
      report.current(seconds);
    },
    toggle() {
      if (platform === "youtube") {
        // 1 = playing, 3 = buffering
        if ([1, 3].includes(youTube.current?.getPlayerState?.() ?? -1)) youTube.current?.pauseVideo?.();
        else youTube.current?.playVideo?.();
      } else {
        playing.current = !playing.current;
        frame.current?.contentWindow?.postMessage({ type: playing.current ? "play" : "pause", "x-tiktok-player": true }, "https://www.tiktok.com");
      }
    },
  }), [platform]);

  useEffect(() => {
    if (platform !== "youtube" || !holder.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const mount = document.createElement("div");
    holder.current.append(mount);
    loadYouTubeApi().then((api) => {
      if (cancelled) return;
      youTube.current = new api.Player(mount, {
        videoId,
        width: "100%",
        height: "100%",
        host: "https://www.youtube-nocookie.com",
        playerVars: { start: Math.floor(start), rel: 0, playsinline: 1 },
      });
      timer = setInterval(() => {
        const time = youTube.current?.getCurrentTime?.();
        if (typeof time === "number") report.current(time);
      }, 300);
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      youTube.current?.destroy?.();
      youTube.current = null;
      mount.remove();
    };
  }, [platform, videoId, start]);

  useEffect(() => {
    if (platform !== "tiktok") return;
    const listen = (event: MessageEvent) => {
      if (event.origin !== "https://www.tiktok.com" || !event.data?.["x-tiktok-player"]) return;
      if (event.data.type === "onCurrentTime" && typeof event.data.value?.currentTime === "number") report.current(event.data.value.currentTime);
      if (event.data.type === "onPlayerReady" && start > 0) {
        frame.current?.contentWindow?.postMessage({ type: "seekTo", value: start, "x-tiktok-player": true }, "https://www.tiktok.com");
      }
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, [platform, start]);

  // A portrait video would fill a phone screen; cap it so the transcript stays visible under the sticky player.
  const box = shape === "tall" ? "aspect-[9/16] max-h-[40dvh] xl:max-h-[62dvh] mx-auto" : "aspect-video w-full max-xl:mx-auto max-xl:max-w-[68dvh]";
  return (
    <div ref={holder} className={`overflow-hidden rounded-2xl bg-black [&_iframe]:size-full ${box}`}>
      {platform === "tiktok" && (
        <iframe
          ref={frame}
          src={`https://www.tiktok.com/player/v1/${encodeURIComponent(videoId)}?music_info=0&description=0&rel=0&native_context_menu=0&closed_caption=0`}
          title={title}
          allow="fullscreen; autoplay; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
        />
      )}
    </div>
  );
}
