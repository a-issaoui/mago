"use client";

import { act } from "@/lib/act";
import { api } from "@/lib/api";

/** A note under a highlight: click to write, saved when you leave the field. */
export function NoteField({ id, note, onSaved }: { id: number; note: string; onSaved: () => void }) {
  return (
    <textarea
      key={note}
      defaultValue={note}
      rows={note ? Math.min(6, note.split("\n").length + 1) : 1}
      placeholder="Add a note"
      aria-label="Note"
      maxLength={4000}
      onBlur={(event) => event.target.value.trim() !== note && act(() => api(`/highlights/${id}`, { method: "PUT", body: JSON.stringify({ note: event.target.value }) }), "Note saved").then(onSaved)}
      className="mt-2 w-full resize-y rounded-xl border border-transparent bg-raised/50 px-3 py-2 font-sans text-sm outline-none transition-[border-color,box-shadow] placeholder:text-mute hover:border-line-strong focus:border-murex focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--murex)_22%,transparent)]"
    />
  );
}
