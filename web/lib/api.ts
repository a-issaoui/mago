"use client";

import { useCallback, useEffect, useState } from "react";

export type Platform = "youtube" | "tiktok";
export type Shape = "wide" | "tall";
export type Status = "listed" | "queued" | "captions" | "downloading" | "transcribing" | "done" | "failed" | "skipped";

export type Video = {
  id: number;
  source_id: number;
  platform: Platform;
  platform_video_id: string;
  url: string;
  title: string | null;
  description?: string | null;
  published_at: string | null;
  duration_s: number | null;
  view_count: number | null;
  thumb_path: string | null;
  thumb_blur: string | null;
  shape: Shape;
  language: string | null;
  status: Status;
  error: string | null;
  method: "captions" | "whisper" | null;
  progress: number;
  transcribed_at: string | null;
  source_title?: string | null;
  source_handle?: string | null;
  source_kind?: string;
  duplicate_of?: number | null;
  duplicate_kind?: "repeat" | "clip" | null;
  channel_name?: string | null;
  channel_url?: string | null;
};

export type ChannelOffer = { name: string; handle: string; url: string; source_id: number | null };
export type PlatformCounts = { total: number; done: number; working: number; failed: number };

export type Cover = { thumb_path: string; thumb_blur: string | null; shape: Shape };

export type Source = {
  id: number;
  platform: Platform;
  kind: "video" | "channel" | "playlist" | "profile";
  url: string;
  handle: string | null;
  title: string | null;
  avatar_path: string | null;
  banner_path: string | null;
  last_synced_at: string | null;
  videos_total: number;
  videos_done: number;
  videos_failed: number;
  covers: Cover[];
  listing: boolean;
  counts?: Partial<Record<Status, number>>;
};

export type Segment = { start: number; end: number; text: string };

export type Preview = {
  platform: Platform;
  kind: Source["kind"];
  url: string;
  title: string | null;
  handle: string | null;
  channel: string | null;
  thumb_url: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  video_count: number | null;
  duration_s: number | null;
  channel_url?: string | null;
  existing_source_id: number | null;
  existing_video_id: number | null;
};

export type Hit = {
  video_id: number;
  platform: Platform;
  title: string | null;
  thumb_path: string | null;
  thumb_blur: string | null;
  shape: Shape;
  duration_s: number | null;
  published_at: string | null;
  source_id: number;
  source_title: string | null;
  start: number;
  snippet: string;
};

export type McpStatus = { sessions: number; calls: number; last_tool: string | null; last_call_at: number | null; busy: boolean };

export type Snapshot = {
  revision: number;
  mcp: McpStatus;
  finished: { id: number; title: string | null; platform: Platform }[];
  paused: Platform[];
  pauses: { platform: Platform; until: number; reason: "refused" | "budget" }[];
  platforms: Record<Platform, PlatformCounts>;
  counts: Partial<Record<Status, number>>;
  queued: number;
  active: Video[];
  listing: { id: number; title: string | null; handle: string | null; url: string }[];
  worker: { alive: boolean; device: string | null; model: string | null };
};

export type Activity = Snapshot & {
  eta_s: number;
  up_next: Video[];
  failed: Video[];
  failed_sources: { id: number; title: string | null; handle: string | null; url: string; error: string | null }[];
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      // X-Mago marks the request as coming from this app; the API refuses writes without it.
      headers: { "x-mago": "1", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "Mago's engine isn't answering. Check that it is running.");
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      if (response.status >= 500) message = "Mago's engine isn't answering. Check that it is running.";
    }
    throw new ApiError(response.status, message);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

/** Fetch `path`, and again whenever `refreshKey` changes (live updates). Keeps the last data while refetching. */
export function useApi<T>(path: string | null, refreshKey: unknown = 0) {
  const [result, setResult] = useState<{ path: string; data?: T; error: string | null } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    api<T>(path).then(
      (data) => {
        if (!cancelled) setResult({ path, data, error: null });
      },
      (caught: unknown) => {
        if (cancelled) return;
        const error = caught instanceof Error ? caught.message : "Something went wrong.";
        setResult((previous) => ({ path, data: previous?.path === path ? previous.data : undefined, error }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [path, refreshKey, nonce]);

  const current = result && result.path === path ? result : null;
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data: current?.data, error: current?.error ?? null, loading: Boolean(path) && !current, reload };
}

export const thumbUrl = (path: string | null, size: "sm" | "lg" = "sm") => (path ? `/media/${path}_${size}.webp` : null);
export const mediaUrl = (path: string | null) => (path ? `/media/${path}` : null);

export function clock(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function shortDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

export function compact(n: number | null | undefined): string {
  if (n == null) return "";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** "just now", "4 minutes ago", "2 hours ago" (from a time in seconds since 1970). */
export function ago(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const passed = Math.max(0, Date.now() / 1000 - seconds);
  if (passed < 60) return "just now";
  if (passed < 3600) return `${Math.floor(passed / 60)} min ago`;
  if (passed < 86400) return `${Math.floor(passed / 3600)} h ago`;
  return `${Math.floor(passed / 86400)} d ago`;
}

/** What Claude is doing, in a few words. */
export function mcpLine(mcp: McpStatus | undefined): string {
  if (!mcp || mcp.sessions === 0) return "Claude is not connected";
  const who = mcp.sessions === 1 ? "Claude is connected" : `${mcp.sessions} Claude sessions connected`;
  return mcp.last_tool ? `${who}. Last used ${mcp.last_tool.replace(/_/g, " ")}, ${ago(mcp.last_call_at)}` : `${who}, idle`;
}

/** "about 25 minutes", "about 3 hours" */
export function roughDuration(seconds: number): string {
  if (seconds < 90) return "about a minute";
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} minutes`;
  const hours = seconds / 3600;
  return hours < 1.5 ? "about an hour" : `about ${Math.round(hours)} hours`;
}

export const platformName = (platform: Platform) => (platform === "youtube" ? "YouTube" : "TikTok");

export function kindLabel(platform: Platform, kind: Source["kind"]): string {
  const names = { video: "video", channel: "channel", playlist: "playlist", profile: "profile" } as const;
  return `${platformName(platform)} ${names[kind]}`;
}

export function statusLabel(video: Pick<Video, "status" | "method" | "progress"> & { duplicate_of?: number | null }): string {
  switch (video.status) {
    case "done":
      return video.method === "whisper" ? "Transcribed by Whisper" : "From captions";
    case "queued":
      return "Queued";
    case "captions":
      return "Looking for captions";
    case "downloading":
      return "Downloading audio";
    case "transcribing":
      return `Transcribing ${Math.round(video.progress * 100)}%`;
    case "failed":
      return "Failed";
    case "skipped":
      return "duplicate_of" in video && video.duplicate_of ? "Repeat, not transcribed" : "Unavailable";
    default:
      return "Not started";
  }
}

export const isWorking = (status: Status) => ["queued", "captions", "downloading", "transcribing"].includes(status);
