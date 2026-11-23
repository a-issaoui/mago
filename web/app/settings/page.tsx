"use client";

import { useState } from "react";
import { api, useApi } from "@/lib/api";

type Settings = { whisper_model: string; device: string; language: string; translate: string; tiktok_delay_s: string; youtube_delay_s: string };
type System = { ytdlp_version: string; gpu_free_mb: number; gpu_lock_busy: boolean; alive: boolean; device: string | null; model: string | null };

const MODELS = [
  { value: "tiny", label: "Tiny", note: "fastest, rough" },
  { value: "base", label: "Base", note: "fast" },
  { value: "small", label: "Small", note: "good balance" },
  { value: "medium", label: "Medium", note: "most accurate that fits this graphics card, slower" },
];

const field = "h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] outline-none focus:border-murex";

export default function SettingsPage() {
  const settings = useApi<Settings>("/settings");
  const system = useApi<System>("/system");
  const [saved, setSaved] = useState("");
  const [failure, setFailure] = useState("");

  async function save(patch: Record<string, string | number>) {
    setFailure("");
    try {
      await api("/settings", { method: "PUT", body: JSON.stringify(patch) });
      settings.reload();
      setSaved("Saved. It applies to the next video.");
      setTimeout(() => setSaved(""), 2500);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Couldn't save that.");
    }
  }

  const values = settings.data;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="display text-4xl sm:text-6xl">Settings</h1>
      <p className="mt-3 h-5 text-sm" aria-live="polite">
        <span className="text-sea">{saved}</span>
        <span className="text-amber">{failure || settings.error}</span>
      </p>

      {values && (
        <div className="mt-4 space-y-10">
          <section aria-labelledby="whisper-heading" className="space-y-5">
            <h2 id="whisper-heading" className="text-xl font-semibold">
              Transcribing
            </h2>
            <p className="-mt-3 text-sm text-mute">Used only for videos that have no captions.</p>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Whisper model</span>
              <select className={field} value={values.whisper_model} onChange={(event) => save({ whisper_model: event.target.value })}>
                {MODELS.map((model) => (
                  <option key={model.value} value={model.value}>{`${model.label}: ${model.note}`}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Run Whisper on</span>
              <select className={field} value={values.device} onChange={(event) => save({ device: event.target.value })}>
                <option value="auto">Graphics card, or the processor if it is busy</option>
                <option value="cuda">Graphics card</option>
                <option value="cpu">Processor only (slower)</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Language</span>
              <select className={field} value={values.language} onChange={(event) => save({ language: event.target.value })}>
                <option value="">Detect for each video</option>
                <option value="en">English</option>
                <option value="fr">French</option>
                <option value="ar">Arabic</option>
                <option value="es">Spanish</option>
                <option value="de">German</option>
                <option value="it">Italian</option>
              </select>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--murex)]" checked={values.translate === "1"} onChange={(event) => save({ translate: event.target.checked ? "1" : "0" })} />
              <span>
                <span className="block text-sm font-medium">Translate to English</span>
                <span className="block text-sm text-mute">Whisper writes the transcript in English whatever the spoken language. Captions are skipped, so every video is transcribed here.</span>
              </span>
            </label>
          </section>

          <section aria-labelledby="pace-heading" className="space-y-5">
            <h2 id="pace-heading" className="text-xl font-semibold">
              Pace
            </h2>
            <p className="-mt-3 text-sm text-mute">Seconds to wait between videos. TikTok blocks requests that come too fast.</p>
            <div className="grid grid-cols-2 gap-4">
              {(["tiktok_delay_s", "youtube_delay_s"] as const).map((name) => (
                <label key={name} className="block">
                  <span className="mb-1.5 block text-sm font-medium">{name === "tiktok_delay_s" ? "TikTok" : "YouTube"}</span>
                  <input
                    key={values[name]}
                    type="number"
                    min={0}
                    max={120}
                    step={0.5}
                    defaultValue={values[name]}
                    onBlur={(event) => event.target.value !== values[name] && save({ [name]: Number(event.target.value) })}
                    className={`${field} tabular`}
                  />
                </label>
              ))}
            </div>
          </section>

          <section aria-labelledby="system-heading">
            <h2 id="system-heading" className="text-xl font-semibold">
              This computer
            </h2>
            {system.data && (
              <dl className="tabular mt-3 divide-y divide-line text-sm">
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
            )}
          </section>
        </div>
      )}
    </div>
  );
}
