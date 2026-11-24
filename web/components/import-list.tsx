"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CopyIcon, FileUpIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { act } from "@/lib/act";
import { api } from "@/lib/api";

type Item = { url: string; note: string; kind: string | null; state: "new" | "known" | "unusable" | "repeated"; problem: string | null };
type Checked = {
  title: string;
  sections: { title: string; items: Item[] }[];
  totals: { links: number; videos: number; whole: number; known: number; unusable: number; repeated: number };
};
type Imported = { collection_id: number; title: string; queued: number; filed: number };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Import a list of links an AI wrote after researching a topic. Three steps in one dialog:
 *  copy the request for the AI, paste its answer, look at what Mago understood, then import. */
export function ImportListDialog({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (open: boolean) => void; onImported?: () => void }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [topic, setTopic] = useState("");
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<{ text: string; result: Checked } | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || prompt) return;
    api<{ prompt: string }>("/lists/prompt").then((answer) => setPrompt(answer.prompt)).catch(() => {});
  }, [open, prompt]);

  const result = checked?.text === text ? checked.result : null; // editing the text sends it back to "check"

  async function check() {
    setBusy(true);
    const answer = await act(() => api<Checked>("/lists/check", { method: "POST", body: JSON.stringify({ text }) }));
    setBusy(false);
    if (answer) setChecked({ text, result: answer });
  }

  async function runImport() {
    setBusy(true);
    const done = await act(() => api<Imported>("/lists", { method: "POST", body: JSON.stringify({ text }) }));
    setBusy(false);
    if (!done) return;
    toast.success(`${done.title} imported. ${plural(done.queued, "link is", "links are")} being listed and transcribed.`);
    setText("");
    setChecked(null);
    onOpenChange(false);
    onImported?.();
    router.push(`/k/${done.collection_id}`);
  }

  const totals = result?.totals;
  const unusable = result?.sections.flatMap((section) => section.items.filter((item) => item.state === "unusable")) ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import a list made by an AI</DialogTitle>
          <DialogDescription>
            Ask an AI assistant to research a topic and answer with a list of videos. Mago transcribes them all and files them in
            collections, in the order and sections the AI chose.
          </DialogDescription>
        </DialogHeader>

        <section>
          <h3 className="text-sm font-semibold">1. Ask the AI</h3>
          <p className="mt-1 text-sm text-mute">Write your topic, copy the request, and paste it into an assistant that can search the web.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              maxLength={300}
              aria-label="Topic"
              placeholder="Learn machine learning from zero, with the maths"
              className="field min-w-0 flex-1 px-4"
            />
            <Button
              variant="outline"
              className="h-10 shrink-0 px-4"
              disabled={!prompt || !topic.trim()}
              onClick={() => act(() => navigator.clipboard.writeText(prompt.replace("{topic}", topic.trim())), "Request copied. Paste it into your AI assistant.")}
            >
              <CopyIcon />
              Copy the request
            </Button>
          </div>
        </section>

        <section>
          <div className="flex items-end justify-between gap-3">
            <h3 className="text-sm font-semibold">2. Paste its answer</h3>
            <button type="button" onClick={() => picker.current?.click()} className="flex min-h-6 items-center gap-1.5 text-sm font-medium text-murex underline decoration-transparent underline-offset-4 hover:decoration-current">
              <FileUpIcon className="size-4" />
              or choose a file
            </button>
          </div>
          <input
            ref={picker}
            type="file"
            accept=".json,.txt,.md,application/json,text/plain"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) setText((await file.text()).slice(0, 400_000));
            }}
          />
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="The AI's answer"
            spellCheck={false}
            placeholder={'{ "title": "...", "sections": [ ... ] }'}
            className="mt-3 max-h-48 min-h-28 font-mono text-xs md:text-xs"
          />
        </section>

        {result && totals && (
          <section aria-live="polite">
            <h3 className="text-sm font-semibold">{`3. ${result.title}`}</h3>
            <p className="mt-1 text-sm text-mute">
              {`${plural(totals.links, "link", "links")}: ${plural(totals.videos, "single video", "single videos")}, ${plural(totals.whole, "channel or playlist", "channels or playlists")}.`}
              {totals.known > 0 && ` ${plural(totals.known, "is", "are")} already in your library and will only be filed.`}
            </p>
            {totals.whole > 0 && <p className="mt-2 text-sm text-amber">Every video in a channel or playlist is transcribed. That can be hundreds of videos.</p>}
            <ul className="mt-3 divide-y divide-line rounded-xl border border-line text-sm">
              {result.sections.map((section) => {
                const usable = section.items.filter((item) => item.state === "new" || item.state === "known");
                return (
                  <li key={section.title} className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <span className="min-w-0 truncate font-medium">{section.title}</span>
                    <span className="tabular shrink-0 text-mute">{plural(usable.length, "link", "links")}</span>
                  </li>
                );
              })}
            </ul>
            {unusable.length > 0 && (
              <div className="mt-3 text-sm">
                <p className="text-amber">{`${plural(unusable.length, "link", "links")} can't be used and will be left out:`}</p>
                <ul className="mt-1 space-y-0.5 text-mute">
                  {unusable.slice(0, 8).map((item, index) => (
                    <li key={`${item.url}-${index}`} className="truncate">{item.url}</li>
                  ))}
                  {unusable.length > 8 && <li>{`and ${unusable.length - 8} more`}</li>}
                </ul>
              </div>
            )}
          </section>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={runImport} disabled={busy || !totals?.links}>
              <CheckIcon />
              {busy ? "Importing" : `Import ${plural(totals?.links ?? 0, "link", "links")}`}
            </Button>
          ) : (
            <Button onClick={check} disabled={busy || text.trim().length < 2}>
              {busy ? "Checking" : "Check the list"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
