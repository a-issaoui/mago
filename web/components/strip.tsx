"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

/** A row that scrolls sideways, with arrows that appear only when there is more in that direction. */
export function Strip({ children, label }: { children: React.ReactNode; label: string }) {
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const node = row.current;
    if (!node) return;
    const left = node.scrollLeft > 4;
    const right = node.scrollLeft + node.clientWidth < node.scrollWidth - 4;
    setEdges((current) => (current.left === left && current.right === right ? current : { left, right }));
  }, []);

  useEffect(() => {
    const node = row.current;
    if (!node) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    Array.from(node.children).forEach((child) => observer.observe(child));
    node.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", measure);
    };
  }, [measure, children]);

  const move = (direction: 1 | -1) => row.current?.scrollBy({ left: direction * row.current.clientWidth * 0.85, behavior: "smooth" });
  const arrow = "absolute top-[38%] z-10 hidden size-10 -translate-y-1/2 place-items-center rounded-full border border-line-strong bg-surface text-ink shadow-lg transition-colors hover:border-murex sm:grid";

  return (
    <div className="relative">
      <div ref={row} className="strip" role="group" aria-label={label}>
        {children}
      </div>
      {edges.left && (
        <>
          <span className="pointer-events-none absolute inset-y-0 left-0 hidden w-16 bg-gradient-to-r from-night to-transparent sm:block" />
          <button type="button" className={`${arrow} -left-3`} onClick={() => move(-1)} aria-label={`Earlier in ${label}`}>
            <ChevronLeftIcon className="size-5" />
          </button>
        </>
      )}
      {edges.right && (
        <>
          <span className="pointer-events-none absolute inset-y-0 right-0 hidden w-16 bg-gradient-to-l from-night to-transparent sm:block" />
          <button type="button" className={`${arrow} -right-3`} onClick={() => move(1)} aria-label={`More in ${label}`}>
            <ChevronRightIcon className="size-5" />
          </button>
        </>
      )}
    </div>
  );
}
