"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Snapshot } from "@/lib/api";

type Live = { snapshot: Snapshot | null; tick: number; connected: boolean };

const LiveContext = createContext<Live>({ snapshot: null, tick: 0, connected: false });

/** One Server-Sent Events connection for the whole app. `tick` changes whenever
 *  the queue changes, so screens can refetch what they show. */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [live, setLive] = useState<Live>({ snapshot: null, tick: 0, connected: false });

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

/** A refresh key that changes on queue events, but at most once per `ms`, so a
 *  busy queue doesn't refetch a big grid every second. */
export function useLiveKey(ms = 2500): number {
  const { tick } = useLive();
  const [key, setKey] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setKey(tick), ms);
    return () => clearTimeout(timer);
  }, [tick, ms]);
  return key;
}
