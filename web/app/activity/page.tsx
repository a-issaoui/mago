"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { PlatformMark } from "@/components/icons";
import { useLive, useLiveKey } from "@/components/live";
import { PageHeader } from "@/components/page-header";
import { Pager, pageOf } from "@/components/pager";
import { Legend, Progress } from "@/components/progress";
import { Thumb } from "@/components/thumb";
import { Button } from "@/components/ui/button";
import { useTitle } from "@/hooks/use-title";
import { act } from "@/lib/act";
import { api, platformName, roughDuration, statusLabel, useApi, type Activity, type Platform, type Video } from "@/lib/api";

/** "resumes in 12 minutes", counting down without waiting for the server. */
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
        <Link href={`/v/${video.id}`} className="line-clamp-1 py-0.5 font-medium hover:underline">
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

function Section({ id, title, count, action, children }: { id: string; title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-10" aria-labelledby={id}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title} {count != null && <span className="tabular font-normal text-mute">{count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function ActivityPage() {
  useTitle("Activity");
  const { snapshot, connected } = useLive();
  const key = useLiveKey(500);
  const NEXT = 20;
  const LIST = 15;
  const [nextPage, setNextPage] = useState(1);
  const [failedPage, setFailedPage] = useState(1);
  const [skippedPage, setSkippedPage] = useState(1);
  const fresh = useApi<Activity>(`/activity?next_limit=${NEXT}&next_offset=${(nextPage - 1) * NEXT}`, key);
  const [data, setData] = useState<Activity | undefined>();
  if (fresh.data && fresh.data !== data) setData(fresh.data);
  const { error, reload } = fresh;
  const now = useNow();
  const active = snapshot?.active ?? data?.active ?? [];
  const listing = snapshot?.listing ?? data?.listing ?? [];
  const worker = snapshot?.worker ?? data?.worker;
  const failed = data?.failed.filter((video) => video.status === "failed") ?? [];
  const skipped = data?.failed.filter((video) => video.status === "skipped") ?? [];
  const queued = snapshot?.queued ?? data?.queued ?? 0;
  const platforms = snapshot?.platforms ?? data?.platforms;
  const stopped = snapshot?.paused ?? data?.paused ?? [];
  const pauses = (snapshot?.pauses ?? data?.pauses ?? []).filter((pause) => pause.until > now);
  const names: Platform[] = ["youtube", "tiktok"];
  const sum = (field: "done" | "working" | "failed" | "total") => (platforms ? names.reduce((value, name) => value + platforms[name][field], 0) : 0);
  const total = sum("total");
  const idle = active.length === 0 && queued === 0 && listing.length === 0;
  const allStopped = stopped.length === 2;

  const setPaused = (platform: Platform | "all", paused: boolean) =>
    act(
      () => api("/queue/pause", { method: "POST", body: JSON.stringify({ platform, paused }) }),
      paused ? `${platform === "all" ? "All downloads" : platformName(platform)} stopped` : `${platform === "all" ? "Downloads" : platformName(platform)} resumed`,
    ).then(reload);
  const retry = (id: number) => act(() => api(`/videos/${id}/retry`, { method: "POST" }), "Queued again").then(reload);

  const engine = !worker
    ? ""
    : !worker.alive
      ? "The worker isn't running, so nothing in the queue will move. Start it with bin/mago start worker."
      : worker.device
        ? `Whisper ${worker.model ?? ""} runs on the ${worker.device === "cuda" ? "graphics card" : "processor (slower)"}.`
        : "The worker is running. Whisper loads when a video needs it.";

  return (
    <div>
      <PageHeader
        title="Activity"
        note={
          <span className="flex items-start gap-2">
            {worker && <span className={`mt-1.5 size-2 shrink-0 rounded-full ${worker.alive ? "bg-sea" : "bg-amber"}`} />}
            <span>
              {engine}
              {!connected && snapshot && " Live updates are reconnecting."}
            </span>
          </span>
        }
      />
      {error && !data && <p className="mb-4 text-amber">{error}</p>}
      <div className="grid items-start gap-x-10 gap-y-2 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="xl:sticky xl:top-24 xl:order-2">

      {platforms && total > 0 && (
        <section aria-label="Overall progress" className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div>
              <p className="tabular text-xl font-semibold">{`${sum("done")} of ${total} videos transcribed`}</p>
              <p className="mt-0.5 text-sm text-mute">
                {sum("working") === 0
                  ? "Everything in your library has been processed."
                  : allStopped
                    ? "Downloads are stopped."
                    : data && data.eta_s > 0
                      ? `${roughDuration(data.eta_s)} left at the current pace.`
                      : "Working through the queue."}
              </p>
            </div>
            {sum("working") > 0 && (
              <Button size="lg" variant={allStopped ? "default" : "outline"} className="h-10 px-5 font-semibold" onClick={() => setPaused("all", !allStopped)}>
                {allStopped ? <PlayIcon /> : <PauseIcon />}
                {allStopped ? "Resume downloads" : "Stop all downloads"}
              </Button>
            )}
          </div>
          <Progress done={sum("done")} working={sum("working")} failed={sum("failed")} total={total} className="mt-4 h-2.5" />
          <div className="mt-3">
            <Legend done={sum("done")} working={sum("working")} failed={sum("failed")} paused={allStopped} />
          </div>
          <div className="mt-5 grid gap-x-6 gap-y-5 border-t border-line pt-5 sm:grid-cols-2 xl:grid-cols-1">
            {names.filter((name) => platforms[name].total > 0).map((name) => {
              const pause = pauses.find((item) => item.platform === name);
              const isStopped = stopped.includes(name);
              return (
                <div key={name}>
                  <div className="tabular flex min-h-8 items-center gap-2 text-sm font-semibold">
                    <PlatformMark platform={name} className="size-[18px]" />
                    {platformName(name)}
                    <span className="ml-auto font-normal text-mute">{`${platforms[name].done} of ${platforms[name].total}`}</span>
                    {platforms[name].working > 0 && (
                      <Button variant="outline" size="sm" className="h-8 px-3" onClick={() => setPaused(name, !isStopped)}>
                        {isStopped ? "Resume" : "Stop"}
                      </Button>
                    )}
                  </div>
                  <Progress {...platforms[name]} className="mt-2 h-1.5" label={`${platformName(name)} transcribed`} />
                  {isStopped && platforms[name].working > 0 && <p className="mt-2 text-xs text-amber">{`Stopped by you. Nothing is downloaded from ${platformName(name)} until you resume.`}</p>}
                  {pause && !isStopped && (
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

      </div>
      <div className="min-w-0 xl:order-1 [&>section:first-child]:mt-8 xl:[&>section:first-child]:mt-0">
      <Section id="now-heading" title="Now">
        {idle && <p className="mt-2 text-mute">Nothing is running. Paste a link in the library to add videos.</p>}
        {!idle && active.length === 0 && listing.length === 0 && (
          <p className="mt-2 text-mute">
            {stopped.length > 0 && pauses.length + stopped.length >= names.filter((name) => platforms?.[name].working).length
              ? "Stopped. Press Resume downloads to carry on."
              : pauses.length > 0
                ? "Waiting. The platforms with videos left are paused; see above for when they resume."
                : "Waiting a few seconds before the next video."}
          </p>
        )}
        <ul className="divide-y divide-line">
          {listing.map((source) => (
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
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised"
                  role="progressbar"
                  aria-label={video.title ?? "Video"}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(video.progress * 100)}
                  aria-valuetext={statusLabel(video)}
                >
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
      </Section>

      {queued > 0 && (
        <Section id="next-heading" title="Up next" count={queued}>
          <ul className="divide-y divide-line">
            {data?.up_next.map((video) => (
              <Row key={video.id} video={video}>
                {video.error && !pauses.some((pause) => pause.platform === video.platform) && <p className="truncate text-xs text-amber">{video.error}</p>}
              </Row>
            ))}
          </ul>
          <Pager label="Up next" className="mt-5" page={nextPage} pageCount={Math.ceil(queued / NEXT)} onChange={setNextPage} />
        </Section>
      )}

      {failed.length > 0 && (
        <Section
          id="failed-heading"
          title="Failed"
          count={failed.length}
          action={
            <Button variant="outline" className="h-9 px-4" onClick={() => act(() => api<{ queued: number }>("/retry-failed", { method: "POST" }), (result) => `${result.queued} videos queued again`).then(reload)}>
              <RotateCcwIcon />
              Try all again
            </Button>
          }
        >
          <ul className="divide-y divide-line">
            {pageOf(failed, failedPage, LIST).items.map((video) => (
              <Row key={video.id} video={video}>
                <div className="mt-1 flex items-start justify-between gap-3">
                  <p className="line-clamp-2 text-xs text-amber">{video.error}</p>
                  <Button size="sm" className="h-8 shrink-0 px-3.5" onClick={() => retry(video.id)}>
                    Try again
                  </Button>
                </div>
              </Row>
            ))}
          </ul>
          <Pager label="Failed videos" className="mt-5" page={Math.min(failedPage, pageOf(failed, failedPage, LIST).pageCount)} pageCount={pageOf(failed, failedPage, LIST).pageCount} onChange={setFailedPage} />
        </Section>
      )}

      {data && data.failed_sources.length > 0 && (
        <Section id="links-heading" title="Links that couldn't be read" count={data.failed_sources.length}>
          <ul className="divide-y divide-line">
            {data.failed_sources.map((source) => (
              <li key={source.id} className="py-3">
                <p className="truncate font-medium">{source.title || source.handle || source.url}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-amber">{source.error}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" className="h-8 px-3.5" onClick={() => act(() => api(`/sources/${source.id}/sync`, { method: "POST" }), "Trying that link again").then(reload)}>
                    Try again
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 px-3.5" onClick={() => act(() => api(`/sources/${source.id}`, { method: "DELETE" }), "Link removed").then(reload)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {skipped.length > 0 && (
        <Section id="skipped-heading" title="Left out" count={skipped.length}>
          <p className="mt-1 text-sm text-mute">Private, removed or blocked videos, and repeats of an earlier upload. Mago doesn&apos;t keep retrying these.</p>
          <ul className="divide-y divide-line">
            {pageOf(skipped, skippedPage, LIST).items.map((video) => (
              <Row key={video.id} video={video}>
                <p className="mt-1 line-clamp-2 text-xs text-mute">{video.error}</p>
              </Row>
            ))}
          </ul>
          <Pager label="Left out videos" className="mt-5" page={Math.min(skippedPage, pageOf(skipped, skippedPage, LIST).pageCount)} pageCount={pageOf(skipped, skippedPage, LIST).pageCount} onChange={setSkippedPage} />
        </Section>
      )}
      </div>
      </div>
    </div>
  );
}
