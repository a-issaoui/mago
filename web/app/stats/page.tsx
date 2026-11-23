"use client";

import Link from "next/link";
import { PlatformMark } from "@/components/icons";
import { useLiveKey } from "@/components/live";
import { PageHeader } from "@/components/page-header";
import { useTitle } from "@/hooks/use-title";
import { compact, useApi, type Platform } from "@/lib/api";

type Stats = {
  totals: { videos: number; all_videos: number; seconds: number; words: number; from_captions: number; from_whisper: number; duplicates: number };
  channels: { id: number; title: string | null; handle: string | null; platform: Platform; videos: number; done: number; seconds: number; words: number }[];
  by_month: { month: string; videos: number }[];
  terms: { term: string; lines: number; times: number }[];
};

function hours(seconds: number): string {
  const h = seconds / 3600;
  return h >= 10 ? `${Math.round(h)} h` : h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(seconds / 60)} min`;
}

function Figure({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="panel p-5">
      <p className="display text-[34px] leading-none">{value}</p>
      <p className="mt-2 text-sm font-medium">{label}</p>
      {note && <p className="mt-0.5 text-sm text-mute">{note}</p>}
    </div>
  );
}

export default function StatsPage() {
  useTitle("Statistics");
  const key = useLiveKey(3000);
  const { data, error } = useApi<Stats>("/stats", key);
  const busiest = Math.max(1, ...(data?.by_month.map((month) => month.videos) ?? [1]));
  const longest = Math.max(1, ...(data?.channels.map((channel) => channel.seconds) ?? [1]));
  const top = Math.max(1, ...(data?.terms.map((term) => term.times) ?? [1]));

  return (
    <div>
      <PageHeader title="Statistics" note="What your library holds. It updates as videos are transcribed." />
      {error && !data && <p className="text-amber">{error}</p>}
      {!data && !error && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="skeleton h-32 rounded-3xl" />
          ))}
        </div>
      )}
      {data && (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Figure value={String(data.totals.videos)} label="videos transcribed" note={`of ${data.totals.all_videos} in the library`} />
            <Figure value={hours(data.totals.seconds)} label="of video" note="total running time transcribed" />
            <Figure value={compact(data.totals.words)} label="words" note={`about ${Math.max(1, Math.round(data.totals.words / 300))} pages of text`} />
            <Figure
              value={`${data.totals.videos ? Math.round((data.totals.from_whisper / data.totals.videos) * 100) : 0}%`}
              label="transcribed by Whisper"
              note={`${data.totals.from_captions} from captions, ${data.totals.duplicates} repeats or clips`}
            />
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-2">
            <section aria-labelledby="channels-heading" className="panel p-5 sm:p-6">
              <h2 id="channels-heading" className="text-lg font-semibold tracking-tight">
                Channels
              </h2>
              {data.channels.length === 0 && <p className="mt-2 text-sm text-mute">Add a channel to see it here.</p>}
              <ul className="mt-4 space-y-4">
                {data.channels.map((channel) => (
                  <li key={channel.id}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <Link href={`/c/${channel.id}`} className="flex min-h-6 min-w-0 items-center gap-2 font-medium hover:underline">
                        <PlatformMark platform={channel.platform} className="size-4 shrink-0" />
                        <span className="truncate">{channel.title || channel.handle}</span>
                      </Link>
                      <span className="tabular shrink-0 text-mute">{`${hours(channel.seconds)}, ${compact(channel.words)} words, ${channel.done} of ${channel.videos}`}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
                      <div className="glow-bg h-full rounded-full" style={{ width: `${(channel.seconds / longest) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="months-heading" className="panel p-5 sm:p-6">
              <h2 id="months-heading" className="text-lg font-semibold tracking-tight">
                When the videos were published
              </h2>
              <p className="mt-1 text-sm text-mute">Transcribed videos per month, last two years with any.</p>
              {data.by_month.length === 0 ? (
                <p className="mt-4 text-sm text-mute">Nothing yet.</p>
              ) : (
                <ol className="mt-5 flex h-40 items-end gap-1" aria-label="Videos per month">
                  {data.by_month.map((month) => (
                    <li key={month.month} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${month.month}: ${month.videos}`}>
                      <span className="w-full rounded-t-sm bg-murex/70 transition-colors group-hover:bg-murex" style={{ height: `${Math.max(3, (month.videos / busiest) * 100)}%` }} />
                      <span className="sr-only">{`${month.month}: ${month.videos} videos`}</span>
                    </li>
                  ))}
                </ol>
              )}
              {data.by_month.length > 0 && (
                <p className="time mt-2 flex justify-between text-xs text-mute">
                  <span>{data.by_month[0].month}</span>
                  <span>{data.by_month.at(-1)!.month}</span>
                </p>
              )}
            </section>
          </div>

          <section aria-labelledby="terms-heading" className="panel p-5 sm:p-6">
            <h2 id="terms-heading" className="text-lg font-semibold tracking-tight">
              Said most often
            </h2>
            <p className="mt-1 text-sm text-mute">Common words across every transcript, everyday words left out. Click one to search for it.</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {data.terms.map((term) => (
                <li key={term.term}>
                  <Link
                    href={`/search?q=${encodeURIComponent(term.term)}`}
                    className="flex h-9 items-center gap-2 rounded-full border border-line-strong px-3.5 text-sm transition-colors hover:border-murex"
                    style={{ opacity: 0.55 + 0.45 * (term.times / top) }}
                  >
                    {term.term}
                    <span className="tabular text-xs text-mute">{compact(term.times)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
