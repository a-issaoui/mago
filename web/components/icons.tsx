type Props = { className?: string };

const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true } as const;

export const PlayIcon = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M5 3.2v9.6a.6.6 0 0 0 .92.5l7.3-4.8a.6.6 0 0 0 0-1L5.92 2.7A.6.6 0 0 0 5 3.2Z" fill="currentColor" />
  </svg>
);

/** Small platform marks: a screen with a play wedge for YouTube, a note for TikTok. */
export const PlatformMark = ({ platform, className }: Props & { platform: "youtube" | "tiktok" }) =>
  platform === "youtube" ? (
    <svg {...base} className={className}>
      <rect x="1" y="3" width="14" height="10" rx="3" fill="currentColor" />
      <path d="M6.6 5.8v4.4L10.4 8 6.6 5.8Z" fill="var(--night)" />
    </svg>
  ) : (
    <svg {...base} className={className}>
      <path
        d="M9.2 1.5h-2v8.3a1.9 1.9 0 1 1-1.9-1.9c.2 0 .4 0 .6.1V5.9a4 4 0 1 0 3.3 3.9V5.6c.9.7 2 1 3.1 1V4.6a3.1 3.1 0 0 1-3.1-3.1Z"
        fill="currentColor"
      />
    </svg>
  );

export const SearchIcon = ({ className }: Props) => (
  <svg {...base} className={className} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3.5 3.5" />
  </svg>
);

export const LibraryIcon = ({ className }: Props) => (
  <svg {...base} className={className} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M2.5 2.5v11M6 2.5v11M9.5 3l3.5 10.2" />
  </svg>
);

export const QueueIcon = ({ className }: Props) => (
  <svg {...base} className={className} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <path d="M2.5 4h11M2.5 8h11M2.5 12h6" />
  </svg>
);

export const GearIcon = ({ className }: Props) => (
  <svg {...base} className={className} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
  </svg>
);

export const SyncIcon = ({ className }: Props) => (
  <svg {...base} className={className} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 3.5v3h-3M3 12.5v-3h3" />
    <path d="M12.6 6.5A5 5 0 0 0 3.7 5.6M3.4 9.5a5 5 0 0 0 8.9.9" />
  </svg>
);

export const CopyIcon = ({ className }: Props) => (
  <svg {...base} className={className} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 3.5v-1h-8v8h1" />
  </svg>
);

export const DownloadIcon = ({ className }: Props) => (
  <svg {...base} className={className} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2.5v8M4.8 7.6 8 10.7l3.2-3.1M3 13.5h10" />
  </svg>
);

export const SunMoonIcon = ({ className }: Props) => (
  <svg {...base} className={className}>
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" />
  </svg>
);
