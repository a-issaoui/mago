"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Snapshot } from "@/lib/api";

type Live = { snapshot: Snapshot | null; tick: number; connected: boolean };

const LiveContext = createContext<Live>({ snapshot: null, tick: 0, connected: false });

/** One Server-Sent Events connection for the whole app. `tick` changes whenever
 *  the queue changes, so screens can refetch what they show. */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [live, setLive] = useState<Live>({ snapshot: null, tick: 0, connected: false });
  const router = useRouter();
  const seen = useRef<Set<number> | null>(null);

  // Say so when a video finishes while you are looking at something else.
  useEffect(() => {
    const finished = live.snapshot?.finished;
    if (!finished) return;
    if (seen.current === null) {
      seen.current = new Set(finished.map((video) => video.id)); // what was already done when the page opened
      return;
    }
    const fresh = finished.filter((video) => !seen.current!.has(video.id));
    fresh.forEach((video) => seen.current!.add(video.id));
    if (fresh.length === 1) {
      toast.success("Transcribed", {
        description: fresh[0].title ?? "A video",
        action: { label: "Open", onClick: () => router.push(`/v/${fresh[0].id}`) },
      });
    } else if (fresh.length > 1) {
      toast.success(`${fresh.length} more videos transcribed`);
    }
  }, [live.snapshot, router]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data) as Snapshot;
        setLive((previous) => ({ snapshot, tick: previous.tick + 1, connected: true }));
      } catch {
        /* ignore a malformed frame; the next one replaces it */
      }
    };
    source.onerror = () => setLive((previous) => ({ ...previous, connected: false }));
    return () => source.close();
  }, []);

  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);

/** A refresh key for screens: it changes as soon as anything in the library changes (a video
 *  finishing, a channel added from another tab or by Claude, a setting), but at most once per
 *  `ms`, so a busy queue doesn't refetch a long list many times a second. */
export function useLiveKey(ms = 500): number {
  const { tick } = useLive();
  const [key, setKey] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, last.current + ms - Date.now());
    const timer = setTimeout(() => {
      last.current = Date.now();
      setKey(tick);
    }, wait);
    return () => clearTimeout(timer);
  }, [tick, ms]);
  return key;
}
