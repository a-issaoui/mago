"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Props = {
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string }[];
  label: string; // for screen readers when there is no visible label
  id?: string;
  className?: string;
};

/** A dropdown of labelled options. */
export function Choice({ value, onChange, items, label, id, className = "" }: Props) {
  return (
    <Select items={items} value={value} onValueChange={(next) => onChange(String(next ?? ""))}>
      <SelectTrigger id={id} aria-label={label} className={`h-10 rounded-full border-line-strong bg-surface px-4 ${className}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
