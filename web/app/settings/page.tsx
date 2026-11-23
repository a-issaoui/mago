"use client";

import { useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Choice } from "@/components/choice";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useTitle } from "@/hooks/use-title";
import { act } from "@/lib/act";
import { api, useApi } from "@/lib/api";

type Settings = {
  whisper_model: string; device: string; language: string; translate: string; tiktok_delay_s: string;
  youtube_delay_s: string; youtube_per_hour: string; skip_repeats: string; resync_hours: string;
};
type System = { ytdlp_version: string; gpu_free_mb: number; gpu_lock_busy: boolean; alive: boolean; device: string | null; model: string | null };

const MODELS = [
  { value: "tiny", label: "Tiny: fastest, rough" },
  { value: "base", label: "Base: fast" },
  { value: "small", label: "Small: good balance" },
  { value: "medium", label: "Medium: most accurate that fits, slower" },
];
const DEVICES = [
  { value: "auto", label: "Graphics card when it is free" },
  { value: "cuda", label: "Graphics card" },
  { value: "cpu", label: "Processor only (slower)" },
];
const LANGUAGES = [
  { value: "auto", label: "Detect for each video" },
  { value: "en", label: "English" },
  { value: "fr", label: "French" },
  { value: "ar", label: "Arabic" },
  { value: "es", label: "Spanish" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
];
const RESYNC = [
  { value: "0", label: "Only when I press the button on a channel" },
  { value: "6", label: "Every 6 hours" },
  { value: "24", label: "Every day" },
  { value: "168", label: "Every week" },
];

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  const id = `${title.toLowerCase().replace(/\W+/g, "-")}-heading`;
  return (
    <section id={id.replace("-heading", "")} aria-labelledby={id} className="panel scroll-mt-24 p-5 sm:p-6">
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {note && <p className="mt-1 max-w-prose text-sm text-mute">{note}</p>}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-center">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-sm text-mute">{hint}</p>}
      </div>
      <div className="sm:justify-self-end">{children}</div>
    </div>
  );
}

const numberField = "field tabular w-28 px-4";

export default function SettingsPage() {
  useTitle("Settings");
  const settings = useApi<Settings>("/settings");
  const system = useApi<System>("/system");
  const [updating, setUpdating] = useState(false);

  const save = (patch: Record<string, string | number>) =>
    act(() => api("/settings", { method: "PUT", body: JSON.stringify(patch) }), "Saved. It applies to the next video.").then(settings.reload);

  async function updateYtdlp() {
    setUpdating(true);
    const result = await act(() => api<{ before: string; after: string; updated: boolean }>("/system/update-ytdlp", { method: "POST" }));
    setUpdating(false);
    if (!result) return;
    if (result.updated) toast.success(`yt-dlp updated from ${result.before} to ${result.after}`);
    else toast.info(`yt-dlp ${result.after} is already the newest`);
    system.reload();
  }

  const values = settings.data;
  const number = (name: "tiktok_delay_s" | "youtube_delay_s" | "youtube_per_hour", max: number, step: number, label: string) =>
    values && (
      <input
        key={values[name]}
        type="number"
        inputMode="decimal"
        aria-label={label}
        min={0}
        max={max}
        step={step}
        defaultValue={values[name]}
        onBlur={(event) => event.target.value !== values[name] && event.target.value !== "" && save({ [name]: Number(event.target.value) })}
        onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        className={numberField}
      />
    );

  return (
    <div>
      <PageHeader title="Settings" note="Changes are saved as you make them and apply to the next video." />
      <div className="grid items-start gap-x-10 gap-y-4 xl:grid-cols-[200px_minmax(0,760px)]">
      <nav aria-label="Settings sections" className="hidden xl:sticky xl:top-24 xl:block">
        <ul className="space-y-0.5 border-l border-line">
          {["Transcribing", "Pace", "New videos and repeats", "This computer"].map((name) => (
            <li key={name}>
              <a href={`#${name.toLowerCase().replace(/\W+/g, "-")}`} className="-ml-px block border-l-2 border-transparent py-1.5 pl-4 text-sm text-mute hover:border-murex hover:text-ink">
                {name}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0">
      {settings.error && !values && <p className="mt-4 text-amber">{settings.error}</p>}
      {!values && !settings.error && (
        <div className="space-y-5">
          <div className="skeleton h-64 rounded-3xl" />
          <div className="skeleton h-48 rounded-3xl" />
        </div>
      )}

      {values && (
        <div className="space-y-5">
          <Group title="Transcribing" note="Used only for videos that have no captions.">
            <Field label="Whisper model" hint="Bigger is more accurate and slower.">
              <Choice label="Whisper model" className="w-full sm:w-80" value={values.whisper_model} onChange={(value) => save({ whisper_model: value })} items={MODELS} />
            </Field>
            <Field label="Run Whisper on">
              <Choice label="Run Whisper on" className="w-full sm:w-80" value={values.device} onChange={(value) => save({ device: value })} items={DEVICES} />
            </Field>
            <Field label="Language" hint="Forcing a language helps short or noisy videos.">
              <Choice label="Language" className="w-full sm:w-80" value={values.language || "auto"} onChange={(value) => save({ language: value === "auto" ? "" : value })} items={LANGUAGES} />
            </Field>
            <Field label="Translate to English" hint="Whisper writes English whatever is spoken. Captions are skipped, so every video is transcribed here.">
              <Switch aria-label="Translate to English" checked={values.translate === "1"} onCheckedChange={(checked) => save({ translate: checked ? "1" : "0" })} />
            </Field>
          </Group>

          <Group title="Pace" note="Both platforms refuse requests that come too fast. When one does, Mago pauses that platform and resumes by itself.">
            <Field label="Seconds between YouTube videos" hint="YouTube's own tools recommend 5 to 10.">
              {number("youtube_delay_s", 120, 0.5, "Seconds between YouTube videos")}
            </Field>
            <Field label="YouTube videos per hour, at most" hint="About 300 an hour are allowed without an account. 0 removes the limit.">
              {number("youtube_per_hour", 2000, 10, "YouTube videos per hour")}
            </Field>
            <Field label="Seconds between TikTok videos">{number("tiktok_delay_s", 120, 0.5, "Seconds between TikTok videos")}</Field>
          </Group>

          <Group title="New videos and repeats">
            <Field label="Check channels for new videos">
              <Choice label="Check channels for new videos" className="w-full sm:w-80" value={String(Number(values.resync_hours))} onChange={(value) => save({ resync_hours: Number(value) })} items={RESYNC} />
            </Field>
            <Field label="Skip re-uploads" hint="A video with the same title and length as an earlier one in the same channel is listed but not transcribed again.">
              <Switch aria-label="Skip re-uploads" checked={values.skip_repeats === "1"} onCheckedChange={(checked) => save({ skip_repeats: checked ? "1" : "0" })} />
            </Field>
          </Group>

          <Group title="This computer">
            {system.data ? (
              <dl className="tabular -mt-2 divide-y divide-line text-sm">
                {[
                  ["Worker", system.data.alive ? "Running" : "Not running"],
                  ["Whisper last ran on", system.data.device === "cuda" ? "Graphics card" : system.data.device === "cpu" ? "Processor" : "Not used yet"],
                  ["Free graphics memory", `${system.data.gpu_free_mb} MB`],
                  ["Graphics card reserved by another project", system.data.gpu_lock_busy ? "Yes, Whisper uses the processor meanwhile" : "No"],
                  ["yt-dlp version", system.data.ytdlp_version],
                ].map(([name, value]) => (
                  <div key={name} className="flex justify-between gap-4 py-2.5">
                    <dt className="text-mute">{name}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="skeleton h-40" />
            )}
            <Field label="Update yt-dlp" hint="The tool that reads YouTube and TikTok. Update it when links stop working.">
              <Button variant="outline" size="lg" className="h-10 px-5" onClick={updateYtdlp} disabled={updating}>
                <RefreshCwIcon className={updating ? "animate-spin" : ""} />
                {updating ? "Updating" : "Update now"}
              </Button>
            </Field>
          </Group>
        </div>
      )}
      </div>
      </div>
    </div>
  );
}
