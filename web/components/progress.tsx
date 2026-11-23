type Props = { done: number; working: number; failed: number; total: number; className?: string; label?: string };

/** One bar, three parts: transcribed (sea), in progress (murex), failed or unavailable (amber). */
export function Progress({ done, working, failed, total, className = "h-1.5", label = "Transcribed" }: Props) {
  const share = (count: number) => `${total > 0 ? (count / total) * 100 : 0}%`;
  return (
    <div className={`progress ${className}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <span className="bg-sea" style={{ width: share(done) }} />
      <span className="bg-murex" style={{ width: share(working) }} />
      <span className="bg-amber" style={{ width: share(failed) }} />
    </div>
  );
}

export function Legend({ done, working, failed }: { done: number; working: number; failed: number }) {
  const items = [
    { count: done, label: "transcribed", color: "bg-sea" },
    { count: working, label: "in progress", color: "bg-murex" },
    { count: failed, label: "failed or unavailable", color: "bg-amber" },
  ].filter((item) => item.count > 0);
  return (
    <ul className="tabular flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${item.color}`} />
          <span className="font-semibold text-ink">{item.count}</span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
