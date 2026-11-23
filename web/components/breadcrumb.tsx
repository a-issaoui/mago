import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

/** Where this screen sits: links to the levels above, then the current one. */
export function Breadcrumb({ trail, current }: { trail: { href: string; label: string }[]; current?: string | null }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex min-h-6 items-center gap-1.5 text-sm font-medium text-mute">
      {trail.map((step, index) => (
        <span key={step.href} className="flex min-w-0 items-center gap-1.5">
          {index > 0 && <ChevronRightIcon className="size-3.5 shrink-0" />}
          <Link href={step.href} className="flex min-h-6 items-center truncate hover:text-ink">
            {step.label}
          </Link>
        </span>
      ))}
      {current && (
        <span className="flex min-w-0 items-center gap-1.5 text-ink" aria-current="page">
          <ChevronRightIcon className="size-3.5 shrink-0 text-mute" />
          <span className="truncate">{current}</span>
        </span>
      )}
    </nav>
  );
}
