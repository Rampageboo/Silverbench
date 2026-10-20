import type { ReactNode, SVGProps } from "react";

/**
 * One stroke icon set for the whole app: 24-unit grid, 1.6 stroke, currentColor.
 * Render size defaults to 16px; pass `size` to change it.
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function make(name: string, body: ReactNode) {
  function Icon({ size = 16, ...rest }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {body}
      </svg>
    );
  }
  Icon.displayName = `Icon${name}`;
  return Icon;
}

export const IconOverview = make(
  "Overview",
  <>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5" />
    <rect x="13.5" y="11" width="7" height="9.5" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
  </>
);

export const IconImages = make(
  "Images",
  <>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M20.5 15.5l-4.5-4.5-8.5 8" />
  </>
);

export const IconVideo = make(
  "Video",
  <>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="M16 10.5l5-3v9l-5-3" />
  </>
);

export const IconTag = make(
  "Tag",
  <>
    <path d="M3.5 12.2V4.5a1 1 0 011-1h7.7l8.3 8.3a1.5 1.5 0 010 2.1l-6.1 6.1a1.5 1.5 0 01-2.1 0z" />
    <circle cx="8" cy="8" r="1.4" />
  </>
);

export const IconBox = make(
  "Box",
  <>
    <path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" />
    <rect x="8.5" y="8.5" width="7" height="7" rx="1" />
  </>
);

export const IconSparkle = make(
  "Sparkle",
  <>
    <path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z" />
    <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </>
);

export const IconReview = make(
  "Review",
  <>
    <path d="M9 11.5l2.5 2.5L20 5.5" />
    <path d="M20 12v6.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18.5v-13A1.5 1.5 0 015.5 4H15" />
  </>
);

export const IconCrop = make(
  "Crop",
  <>
    <path d="M6.5 2.5v14a1 1 0 001 1h14" />
    <path d="M2.5 6.5h14a1 1 0 011 1v14" />
  </>
);

export const IconMask = make(
  "Mask",
  <>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
    <path d="M3.5 14l5-5 5 5 2.5-2.5 4.5 4.5" />
    <path d="M14 7.5h3" />
  </>
);

export const IconPackage = make(
  "Package",
  <>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
  </>
);

export const IconMerge = make(
  "Merge",
  <>
    <circle cx="6" cy="5.5" r="2" />
    <circle cx="6" cy="18.5" r="2" />
    <circle cx="18" cy="12" r="2" />
    <path d="M6 7.5v9M6 9.5c0 2.5 3 2.5 6 2.5h4" />
  </>
);

export const IconFlow = make(
  "Flow",
  <>
    <rect x="3" y="3.5" width="7" height="5.5" rx="1.2" />
    <rect x="14" y="15" width="7" height="5.5" rx="1.2" />
    <path d="M10 6.25h4a3 3 0 013 3V15M14 17.75h-4a3 3 0 01-3-3V9" />
  </>
);

export const IconSettings = make(
  "Settings",
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
  </>
);

export const IconSearch = make(
  "Search",
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </>
);

export const IconChevronDown = make("ChevronDown", <path d="M6 9l6 6 6-6" />);
export const IconChevronRight = make("ChevronRight", <path d="M9 6l6 6-6 6" />);
export const IconFolder = make(
  "Folder",
  <path d="M3.5 7a1.5 1.5 0 011.5-1.5h4.4l2 2H19a1.5 1.5 0 011.5 1.5v8.5A1.5 1.5 0 0119 19H5a1.5 1.5 0 01-1.5-1.5z" />
);

export const IconFolderPlus = make(
  "FolderPlus",
  <>
    <path d="M3.5 7a1.5 1.5 0 011.5-1.5h4.4l2 2H19a1.5 1.5 0 011.5 1.5v8.5A1.5 1.5 0 0119 19H5a1.5 1.5 0 01-1.5-1.5z" />
    <path d="M12 10.5v5M9.5 13h5" />
  </>
);

export const IconPlus = make("Plus", <path d="M12 5v14M5 12h14" />);
export const IconClose = make("Close", <path d="M6 6l12 12M18 6L6 18" />);
export const IconCheck = make("Check", <path d="M5 12.5l4.5 4.5L19 7.5" />);

export const IconSidebar = make(
  "Sidebar",
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M9.5 4.5v15" />
  </>
);

export const IconMic = make(
  "Mic",
  <>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v2.5" />
  </>
);

export const IconLayers = make(
  "Layers",
  <>
    <path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z" />
    <path d="M3.5 12l8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" />
  </>
);

export const IconRefresh = make(
  "Refresh",
  <>
    <path d="M20 11.5A8 8 0 006 6.3L4 8.5" />
    <path d="M4 4v4.5h4.5" />
    <path d="M4 12.5a8 8 0 0014 5.2l2-2.2" />
    <path d="M20 20v-4.5h-4.5" />
  </>
);

export const IconInbox = make(
  "Inbox",
  <>
    <path d="M3.5 13.5l2.6-7.2A1.5 1.5 0 017.5 5.3h9a1.5 1.5 0 011.4 1l2.6 7.2" />
    <path d="M3.5 13.5V18a1.5 1.5 0 001.5 1.5h14a1.5 1.5 0 001.5-1.5v-4.5H15l-1.5 2h-3l-1.5-2z" />
  </>
);

export const IconHistory = make(
  "History",
  <>
    <path d="M4 12a8 8 0 102.4-5.7L4 8.5" />
    <path d="M4 4v4.5h4.5M12 8v4.5l3 2" />
  </>
);

export const IconAlert = make(
  "Alert",
  <>
    <path d="M10.3 4.2L2.8 17.5A2 2 0 004.5 20.5h15a2 2 0 001.7-3L13.7 4.2a2 2 0 00-3.4 0z" />
    <path d="M12 9.5v4M12 17h.01" />
  </>
);

export const IconArchive = make(
  "Archive",
  <>
    <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
    <path d="M5 8.5v10a1.5 1.5 0 001.5 1.5h11a1.5 1.5 0 001.5-1.5v-10M10 12.5h4" />
  </>
);

export const IconPencil = make(
  "Pencil",
  <>
    <path d="M14.5 5.5l4 4L8 20H4v-4z" />
    <path d="M12.5 7.5l4 4" />
  </>
);

export const IconStar = make(
  "Star",
  <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
);

export const IconEye = make(
  "Eye",
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </>
);

export const IconEyeOff = make(
  "EyeOff",
  <>
    <path d="M10.6 5.6A9.7 9.7 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-2.7 3.4M6.6 6.6A16.6 16.6 0 002.5 12S6 18.5 12 18.5a9.6 9.6 0 005.4-1.7" />
    <path d="M9.9 9.9a3 3 0 004.2 4.2M3.5 3.5l17 17" />
  </>
);

export const IconCopy = make(
  "Copy",
  <>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
    <path d="M15.5 8.5V5a1.5 1.5 0 00-1.5-1.5H5A1.5 1.5 0 003.5 5v9A1.5 1.5 0 005 15.5h3.5" />
  </>
);

export const IconDownload = make(
  "Download",
  <>
    <path d="M12 4v11M7 10.5l5 5 5-5" />
    <path d="M4.5 16v2.5A1.5 1.5 0 006 20h12a1.5 1.5 0 001.5-1.5V16" />
  </>
);

export const IconPause = make("Pause", <path d="M8.5 5v14M15.5 5v14" />);
export const IconPlay = make("Play", <path d="M7.5 5l11 7-11 7z" />);

export const IconSliders = make(
  "Sliders",
  <>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </>
);

export const IconGallery = make(
  "Gallery",
  <>
    <rect x="6.5" y="6.5" width="14" height="13" rx="2" />
    <path d="M3.5 15.5V5a1.5 1.5 0 011.5-1.5h11.5" />
    <circle cx="11" cy="11" r="1.5" />
    <path d="M20.5 16l-4-4-7 7.5" />
  </>
);
