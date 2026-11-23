type Props = { className?: string };

const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true } as const;

export const PlayIcon = ({ className }: Props) => (
  <svg {...base} className={className}>
    <path d="M5 3.2v9.6a.6.6 0 0 0 .92.5l7.3-4.8a.6.6 0 0 0 0-1L5.92 2.7A.6.6 0 0 0 5 3.2Z" fill="currentColor" />
  </svg>
);

/** Platform badges in each platform's own colours, so the two are told apart at a glance. */
export const PlatformMark = ({ platform, className }: Props & { platform: "youtube" | "tiktok" | "podcast" | "file" }) => {
  if (platform === "youtube")
    return (
      <svg {...base} className={className} role="img" aria-label="YouTube">
        <rect x="0.5" y="2.5" width="15" height="11" rx="3.2" fill="var(--youtube)" />
        <path d="M6.5 5.4v5.2L11 8 6.5 5.4Z" fill="#fff" />
      </svg>
    );
  if (platform === "tiktok")
    return (
      <svg {...base} className={className} role="img" aria-label="TikTok">
        <rect width="16" height="16" rx="4" fill="#111" />
        <path d="M9.3 3.2H7.8v6.3a1.45 1.45 0 1 1-1.45-1.45c.15 0 .3.02.45.07V6.6a3 3 0 1 0 2.5 2.95V6.3c.68.5 1.5.77 2.35.77V5.55A2.35 2.35 0 0 1 9.3 3.2Z" fill="#25f4ee" transform="translate(-0.45 0.35)" />
        <path d="M9.3 3.2H7.8v6.3a1.45 1.45 0 1 1-1.45-1.45c.15 0 .3.02.45.07V6.6a3 3 0 1 0 2.5 2.95V6.3c.68.5 1.5.77 2.35.77V5.55A2.35 2.35 0 0 1 9.3 3.2Z" fill="#fe2c55" transform="translate(0.45 -0.35)" />
        <path d="M9.3 3.2H7.8v6.3a1.45 1.45 0 1 1-1.45-1.45c.15 0 .3.02.45.07V6.6a3 3 0 1 0 2.5 2.95V6.3c.68.5 1.5.77 2.35.77V5.55A2.35 2.35 0 0 1 9.3 3.2Z" fill="#fff" />
      </svg>
    );
  if (platform === "podcast")
    return (
      <svg {...base} className={className} role="img" aria-label="Podcast">
        <rect width="16" height="16" rx="4" fill="#8b46e6" />
        <rect x="6.2" y="3" width="3.6" height="6.2" rx="1.8" fill="#fff" />
        <path d="M4.4 7.6a3.6 3.6 0 0 0 7.2 0M8 11.2v1.9" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg {...base} className={className} role="img" aria-label="A file from this computer">
      <rect width="16" height="16" rx="4" fill="#3d6ee8" />
      <path d="M5 3.2h4l2.4 2.4v7.2H5V3.2Z" fill="#fff" />
      <path d="M9 3.2v2.4h2.4" stroke="#3d6ee8" strokeWidth="0.9" />
    </svg>
  );
};

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
