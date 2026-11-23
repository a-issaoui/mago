"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlatformMark } from "@/components/icons";
import { useLive, useLiveKey } from "@/components/live";
import { Legend, Progress } from "@/components/progress";
import { Thumb } from "@/components/thumb";
import { api, platformName, roughDuration, statusLabel, useApi, type Activity, type Platform, type Video } from "@/lib/api";

/** "resumes in 12 min", counting down without waiting for the server. */
function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 5000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function wait(seconds: number): string {
  if (seconds < 60) return "less than a minute";
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function Row({ video, children }: { video: Video; children?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-4 py-3">
      <Link href={`/v/${video.id}`} className="block w-24 shrink-0" tabIndex={-1} aria-hidden>
        <Thumb path={video.thumb_path} blur={video.thumb_blur} shape="wide" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/v/${video.id}`} className="line-clamp-1 font-medium hover:underline">
          {video.title || "Untitled video"}
        </Link>
        <p className="flex items-center gap-1.5 truncate text-sm text-mute">
          <PlatformMark platform={video.platform} className="size-3.5 shrink-0" />
          {video.source_title}
        </p>
        {children}
      </div>
    </li>
  );
}

export default function ActivityPage() {
  const { snapshot, connected } = useLive();
  const key = useLiveKey(1200);
  const { data, error, reload } = useApi<Activity>("/activity", key);
  const active = snapshot?.active ?? data?.active ?? [];
  const worker = snapshot?.worker ?? data?.worker;
  const failed = data?.failed.filter((video) => video.status === "failed") ?? [];
  const skipped = data?.failed.filter((video) => video.status === "skipped") ?? [];
  const queued = snapshot?.queued ?? data?.queued ?? 0;
  const idle = active.length === 0 && queued === 0 && (snapshot?.listing.length ?? 0) === 0;
  const now = useNow();
  const platforms = snapshot?.platforms ?? data?.platforms;
  const pauses = (snapshot?.pauses ?? data?.pauses ?? []).filter((pause) => pause.until > now);
  const names: Platform[] = ["youtube", "tiktok"];
  const total = platforms ? names.reduce((sum, name) => sum + platforms[name].total, 0) : 0;
  const sum = (field: "done" | "working" | "failed") => (platforms ? names.reduce((value, name) => value + platforms[name][field], 0) : 0);

  async function retry(id: number) {
    await api(`/videos/${id}/retry`, { method: "POST" });
    reload();
  }
  async function retryAll() {
    await api("/retry-failed", { method: "POST" });
    reload();
  }

  const engine = !worker
    ? ""
    : !worker.alive
      ? "The worker isn't running, so nothing in the queue will move."
      : worker.device
        ? `Whisper ${worker.model ?? ""} is running on the ${worker.device === "cuda" ? "graphics card" : "processor (slower)"}.`
        : "The worker is running. Whisper loads when a video needs it.";

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="display text-4xl sm:text-6xl">Activity</h1>
      <p className="mt-3 flex items-center gap-2 text-sm text-mute">
        {worker && <span className={`size-2 rounded-full ${worker.alive ? "bg-sea" : "bg-amber"}`} />}
        {engine}
        {!connected && snapshot && " Live updates are reconnecting."}
      </p>
      {error && <p className="mt-4 text-amber">{error}</p>}

      {platforms && total > 0 && (
        <section aria-label="Overall progress" className="mt-7 rounded-2xl border border-line bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="tabular text-lg font-semibold">{`${sum("done")} of ${total} videos transcribed`}</p>
            {data && data.eta_s > 0 && sum("working") > 0 && <p className="text-sm text-mute">{`${roughDuration(data.eta_s)} left at the current pace`}</p>}
          </div>
          <Progress done={sum("done")} working={sum("working")} failed={sum("failed")} total={total} className="mt-3 h-2.5" />
          <div className="mt-3">
            <Legend done={sum("done")} working={sum("working")} failed={sum("failed")} />
          </div>
          <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            {names.filter((name) => platforms[name].total > 0).map((name) => {
              const pause = pauses.find((item) => item.platform === name);
              return (
                <div key={name}>
                  <p className="tabular flex items-center gap-2 text-sm font-semibold">
                    <PlatformMark platform={name} className="size-[18px]" />
                    {platformName(name)}
                    <span className="ml-auto font-normal text-mute">{`${platforms[name].done} of ${platforms[name].total}`}</span>
                  </p>
                  <Progress {...platforms[name]} className="mt-2 h-1.5" label={`${platformName(name)} transcribed`} />
                  {pause && (
                    <p className="mt-2 text-xs text-amber">
                      {pause.reason === "budget"
                        ? `Paused: this hour's YouTube limit is used up. Resumes in ${wait(pause.until - now)}.`
                        : `Paused: ${platformName(name)} asked Mago to slow down. Trying again in ${wait(pause.until - now)}.`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-9" aria-labelledby="now-heading">
        <h2 id="now-heading" className="text-xl font-semibold">
          Now
        </h2>
        {idle && <p className="mt-2 text-mute">Nothing is running. Paste a link in the library to add videos.</p>}
        {!idle && active.length === 0 && (snapshot?.listing.length ?? 0) === 0 && (
          <p className="mt-2 text-mute">
            {pauses.length > 0 ? "Waiting. The platforms with videos left are paused; see above for when they resume." : "Waiting a few seconds before the next video."}
          </p>
        )}
        <ul className="divide-y divide-line">
          {snapshot?.listing.map((source) => (
            <li key={`list-${source.id}`} className="flex items-center gap-3 py-3">
              <span className="live-dot size-2 shrink-0 rounded-full bg-murex" />
              <Link href={`/c/${source.id}`} className="min-w-0 truncate font-medium hover:underline">
                {source.title || source.handle ? `Listing the videos of ${source.title || source.handle}` : "Reading a new link"}
              </Link>
            </li>
          ))}
          {active.map((video) => (
            <Row key={video.id} video={video}>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(video.progress * 100)}>
                  <div
                    className={`h-full origin-left rounded-full bg-murex transition-transform duration-700 ${video.status === "transcribing" ? "" : "live-dot"}`}
                    style={{ transform: `scaleX(${video.status === "transcribing" ? Math.max(video.progress, 0.02) : 1})` }}
                  />
                </div>
                <span className="tabular shrink-0 text-right text-xs text-mute sm:w-44">{statusLabel(video)}</span>
              </div>
            </Row>
          ))}
        </ul>
      </section>

      {queued > 0 && (
        <section className="mt-9" aria-labelledby="next-heading">
          <h2 id="next-heading" className="text-xl font-semibold">
            Up next <span className="tabular font-normal text-mute">{queued}</span>
          </h2>
          <ul className="divide-y divide-line">
            {data?.up_next.map((video) => (
              <Row key={video.id} video={video}>
                {video.error && !pauses.some((pause) => pause.platform === video.platform) && <p className="truncate text-xs text-amber">{video.error}</p>}
              </Row>
            ))}
          </ul>
          {data && queued > data.up_next.length && <p className="tabular mt-2 text-sm text-mute">{`and ${queued - data.up_next.length} more`}</p>}
        </section>
      )}

      {failed.length > 0 && (
        <section className="mt-9" aria-labelledby="failed-heading">
          <div className="flex items-center justify-between">
            <h2 id="failed-heading" className="text-xl font-semibold">
              Failed <span className="tabular font-normal text-mute">{failed.length}</span>
            </h2>
            <button type="button" onClick={retryAll} className="h-9 rounded-full border border-line px-4 text-sm font-semibold hover:bg-raised">
              Try all again
            </button>
          </div>
          <ul className="divide-y divide-line">
            {failed.map((video) => (
              <Row key={video.id} video={video}>
                <div className="mt-1 flex items-start justify-between gap-3">
                  <p className="line-clamp-2 text-xs text-amber">{video.error}</p>
                  <button type="button" onClick={() => retry(video.id)} className="h-8 shrink-0 rounded-full bg-murex px-4 text-xs font-semibold text-on-murex hover:brightness-110">
                    Try again
                  </button>
                </div>
              </Row>
            ))}
          </ul>
        </section>
      )}

      {data && data.failed_sources.length > 0 && (
        <section className="mt-9" aria-labelledby="links-heading">
          <h2 id="links-heading" className="text-xl font-semibold">
            Links that couldn&apos;t be read <span className="tabular font-normal text-mute">{data.failed_sources.length}</span>
          </h2>
          <ul className="divide-y divide-line">
            {data.failed_sources.map((source) => (
              <li key={source.id} className="py-3">
                <p className="truncate font-medium">{source.title || source.handle || source.url}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-amber">{source.error}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => api(`/sources/${source.id}/sync`, { method: "POST" }).then(reload)} className="h-8 rounded-full bg-murex px-4 text-xs font-semibold text-on-murex hover:brightness-110">
                    Try again
                  </button>
                  <button type="button" onClick={() => api(`/sources/${source.id}`, { method: "DELETE" }).then(reload)} className="h-8 rounded-full border border-line px-4 text-xs font-semibold hover:bg-raised">
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {skipped.length > 0 && (
        <section className="mt-9" aria-labelledby="skipped-heading">
          <h2 id="skipped-heading" className="text-xl font-semibold">
            Unavailable <span className="tabular font-normal text-mute">{skipped.length}</span>
          </h2>
          <p className="mt-1 text-sm text-mute">{"Private, removed or blocked videos. Mago doesn't keep retrying these."}</p>
          <ul className="divide-y divide-line">
            {skipped.map((video) => (
              <Row key={video.id} video={video}>
                <p className="mt-1 line-clamp-2 text-xs text-mute">{video.error}</p>
              </Row>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
