"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  page: number; // 1-based
  pageCount?: number; // leave out when the total isn't known (then pass hasNext)
  hasNext?: boolean;
  onChange: (page: number) => void;
  label: string; // what is being paged, e.g. "Videos"
  className?: string;
};

/** Which page numbers to show: first, last, the current one and its neighbours, with gaps. */
function slots(page: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
  const wanted = new Set([1, 2, count - 1, count, page - 1, page, page + 1]);
  const pages = [...wanted].filter((value) => value >= 1 && value <= count).sort((a, b) => a - b);
  const result: (number | "gap")[] = [];
  pages.forEach((value, index) => {
    if (index > 0 && value - pages[index - 1] > 1) result.push("gap");
    result.push(value);
  });
  return result;
}

/** Previous / page numbers / Next. Renders nothing when there is only one page. */
export function Pager({ page, pageCount, hasNext, onChange, label, className = "" }: Props) {
  const last = pageCount ?? (hasNext ? page + 1 : page);
  if (last <= 1 && page <= 1) return null;
  return (
    <nav aria-label={`${label} pages`} className={`flex flex-wrap items-center justify-center gap-1.5 ${className}`}>
      <Button variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
        <ChevronLeftIcon />
        <span className="hidden sm:inline">Previous</span>
      </Button>
      {pageCount ? (
        <ul className="tabular flex items-center gap-1">
          {slots(page, pageCount).map((slot, index) =>
            slot === "gap" ? (
              <li key={`gap-${index}`} className="px-1 text-mute" aria-hidden>
                …
              </li>
            ) : (
              <li key={slot}>
                <Button
                  variant={slot === page ? "default" : "ghost"}
                  size="icon"
                  className="min-w-9 px-2"
                  aria-current={slot === page ? "page" : undefined}
                  aria-label={`Page ${slot}`}
                  onClick={() => slot !== page && onChange(slot)}
                >
                  {slot}
                </Button>
              </li>
            ),
          )}
        </ul>
      ) : (
        <span className="tabular px-3 text-sm text-mute" aria-current="page">{`Page ${page}`}</span>
      )}
      <Button variant="outline" disabled={pageCount ? page >= pageCount : !hasNext} onClick={() => onChange(page + 1)} aria-label="Next page">
        <span className="hidden sm:inline">Next</span>
        <ChevronRightIcon />
      </Button>
    </nav>
  );
}

/** Cut a list that is already in memory into pages. */
export function pageOf<T>(items: T[], page: number, size: number): { items: T[]; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(page, 1), pageCount);
  return { items: items.slice((current - 1) * size, current * size), pageCount };
}
