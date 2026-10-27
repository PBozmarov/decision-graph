import type { ReactNode } from 'react';
import type { Kind, OutcomeRating } from './model';

function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const KIND_PATHS: Record<Kind, ReactNode> = {
  problem: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.2a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 4" />
      <path d="M12 17.4h.01" />
    </>
  ),
  option: (
    <>
      <circle cx="6" cy="5.5" r="2.2" />
      <circle cx="6" cy="18.5" r="2.2" />
      <circle cx="18" cy="8.5" r="2.2" />
      <path d="M6 7.7v8.6" />
      <path d="M18 10.7c0 4-6 3.2-11 6.2" />
    </>
  ),
  requirement: (
    <>
      <path d="m3.5 6.5 2 2 3.5-3.5" />
      <path d="m3.5 15.5 2 2 3.5-3.5" />
      <path d="M13 7h7.5" />
      <path d="M13 16h7.5" />
    </>
  ),
  pro: (
    <>
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  con: (
    <>
      <path d="m3 7 6 6 4-4 8 8" />
      <path d="M15 17h6v-6" />
    </>
  ),
  risk: (
    <>
      <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </>
  ),
  action: <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12l1-8Z" />,
  note: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3h8l4.5 4.5v12a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5Z" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
};

export const KindIcon = ({ kind, size }: { kind: Kind; size?: number }) => (
  <Svg size={size}>{KIND_PATHS[kind]}</Svg>
);

export const IconPlus = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconMinus = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M5 12h14" />
  </Svg>
);
export const IconChevron = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="m9 6 6 6-6 6" />
  </Svg>
);
export const IconClose = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconCheck = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const IconSun = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Svg>
);
export const IconMoon = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
  </Svg>
);
export const IconFit = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
  </Svg>
);
export const IconTrash = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
  </Svg>
);
export const IconReset = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
    <path d="M3.5 3.5v5h5" />
  </Svg>
);
export const IconBlank = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="4" y="3" width="16" height="18" rx="3" />
    <path d="M12 9v6M9 12h6" />
  </Svg>
);
export const IconSidebar = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3" y="4.5" width="18" height="15" rx="3" />
    <path d="M9.5 4.5v15" />
  </Svg>
);
export const IconFocus = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="3" />
    <path d="M3.5 8V5.5a2 2 0 0 1 2-2H8M16 3.5h2.5a2 2 0 0 1 2 2V8M20.5 16v2.5a2 2 0 0 1-2 2H16M8 20.5H5.5a2 2 0 0 1-2-2V16" />
  </Svg>
);
export const IconCompact = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3.5" y="5" width="17" height="14" rx="3" />
    <path d="M7.5 14.5h3M12.5 14.5h4M7.5 10h9" />
  </Svg>
);
export const IconExpand = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="2.5" y="9" width="7" height="6" rx="1.5" />
    <rect x="14.5" y="3.5" width="7" height="5" rx="1.5" />
    <rect x="14.5" y="15.5" width="7" height="5" rx="1.5" />
    <path d="M9.5 12h2.5M12 6v12M12 6h2.5M12 18h2.5" />
  </Svg>
);
export const IconSparkle = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 3.5 13.8 9a2 2 0 0 0 1.2 1.2l5.5 1.8-5.5 1.8a2 2 0 0 0-1.2 1.2L12 20.5 10.2 15A2 2 0 0 0 9 13.8L3.5 12 9 10.2A2 2 0 0 0 10.2 9Z" />
  </Svg>
);
export const IconColumns = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16M15 4v16" />
  </Svg>
);
export const IconShare = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 3.5v11M8 7.5l4-4 4 4" />
    <path d="M6.5 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5" />
  </Svg>
);
export const IconImage = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m21 16-5-5-9 9" />
  </Svg>
);
export const IconDoc = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M6 3.5h8l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5Z" />
    <path d="M14 3.5V8h4.5M8 13h8M8 16.5h5" />
  </Svg>
);
export const IconCopy = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
    <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
  </Svg>
);
export const IconUndo = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);
export const IconRedo = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Svg>
);
export const IconArrowUp = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);
export const IconArrowDown = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
);
export const IconDownload = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 3.5v11M8 10.5l4 4 4-4" />
    <path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
  </Svg>
);
export const IconUpload = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M12 14.5v-11M8 7.5l4-4 4 4" />
    <path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
  </Svg>
);
export const IconSearch = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.8-4.8" />
  </Svg>
);
export const IconFaceUneasy = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9.5h.01M15 9.5h.01" />
    <path d="M8.5 16.2a4.5 4.5 0 0 1 7 0" />
  </Svg>
);
export const IconFaceNeutral = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9.5h.01M15 9.5h.01" />
    <path d="M8.8 15h6.4" />
  </Svg>
);
export const IconFaceGood = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9.5h.01M15 9.5h.01" />
    <path d="M8.5 14a4.5 4.5 0 0 0 7 0" />
  </Svg>
);
/** The face for a gut feeling (colored by the caller's `.gut-*` class). */
export const GutIcon = ({ gut, size }: { gut: -1 | 0 | 1; size?: number }) =>
  gut === 1 ? <IconFaceGood size={size} /> : gut === -1 ? <IconFaceUneasy size={size} /> : <IconFaceNeutral size={size} />;
export const IconFlat = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <path d="M3 12h18" />
    <path d="m15 6 6 6-6 6" />
  </Svg>
);
export const IconClock = ({ size }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
/** How a choice turned out: the pro trend, a flat arrow, or the con trend (colored by the caller). */
export const TrendIcon = ({ rating, size }: { rating: OutcomeRating; size?: number }) =>
  rating === 1 ? <KindIcon kind="pro" size={size} /> : rating === -1 ? <KindIcon kind="con" size={size} /> : <IconFlat size={size} />;
