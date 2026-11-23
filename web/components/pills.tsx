"use client";

type Option<T extends string> = { value: T; label: string; count?: number | null; icon?: React.ReactNode };

/** A row of filter pills where exactly one is on. */
export function Pills<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: Option<T>[]; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className="tabular flex h-10 items-center gap-2 rounded-full border border-line-strong px-4 text-sm font-medium text-mute transition-colors hover:border-murex hover:text-ink aria-pressed:border-transparent aria-pressed:bg-ink aria-pressed:text-night"
        >
          {option.icon}
          {option.label}
          {option.count != null && option.count > 0 && <span className="font-normal">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}
