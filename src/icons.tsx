import type { ReactNode } from 'react';
import type { Kind } from './model';

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
