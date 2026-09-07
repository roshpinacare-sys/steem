/**
 * shell/icons.tsx — a compact, consistent line-icon set for the desktop shell
 * navigation and headers. 1.6px strokes on a 24px grid, currentColor.
 */
import React from "react";

function Svg({ children, size = 18 }: { children: React.ReactNode; size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export type IconName =
  | "overview" | "activity" | "runs" | "pipeline" | "agents"
  | "safety" | "cost" | "sandbox" | "settings" | "command" | "dispatch"
  | "bolt" | "check" | "alert" | "chevron"
  | "studio" | "tasks" | "automations" | "connections"
  | "files" | "releases" | "insights" | "governance" | "docs"
  | "download" | "upload" | "copy" | "refresh" | "folder" | "file" | "image" | "external"
  | "chat" | "send";

export function Icon({ name, size = 18 }: { name: IconName; size?: number }): React.ReactElement {
  switch (name) {
    case "overview":
      return <Svg size={size}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Svg>;
    case "activity":
      return <Svg size={size}><path d="M3 12h4l3 8 4-16 3 8h4" /></Svg>;
    case "runs":
      return <Svg size={size}><path d="M5 4v16M5 4l14 8-14 8" /></Svg>;
    case "pipeline":
      return <Svg size={size}><circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="12" r="2" /><path d="M7 6h6a4 4 0 0 1 4 4M7 18h6a4 4 0 0 0 4-4" /></Svg>;
    case "agents":
      return <Svg size={size}><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="19" cy="6" r="1.4" /><circle cx="5" cy="6" r="1.4" /></Svg>;
    case "safety":
      return <Svg size={size}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></Svg>;
    case "cost":
      return <Svg size={size}><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.2a2.5 2 0 0 1 5 0c0 2.5-5 1.3-5 3.6a2.5 2 0 0 0 5 0" /></Svg>;
    case "sandbox":
      return <Svg size={size}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></Svg>;
    case "settings":
      return <Svg size={size}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1l2.1-2.1M17 7l2.1-2.1" /></Svg>;
    case "command":
      return <Svg size={size}><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" /></Svg>;
    case "dispatch":
      return <Svg size={size}><path d="M4 12l16-8-6 16-3-6-7-2z" /></Svg>;
    case "bolt":
      return <Svg size={size}><path d="M13 3L4 14h6l-1 7 9-11h-6z" /></Svg>;
    case "check":
      return <Svg size={size}><path d="M5 12l4 4L19 6" /></Svg>;
    case "alert":
      return <Svg size={size}><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></Svg>;
    case "chevron":
      return <Svg size={size}><path d="M9 6l6 6-6 6" /></Svg>;
    case "studio":
      return <Svg size={size}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8h18" /><path d="M8 13l2 2-2 2M13 17h3" /></Svg>;
    case "tasks":
      return <Svg size={size}><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="10" rx="1.5" /></Svg>;
    case "automations":
      return <Svg size={size}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /><circle cx="12" cy="12" r="3.2" /></Svg>;
    case "connections":
      return <Svg size={size}><path d="M9 15l6-6M8.5 8.5l-1.8 1.8a3.5 3.5 0 0 0 5 5l1.8-1.8M15.5 15.5l1.8-1.8a3.5 3.5 0 0 0-5-5l-1.8 1.8" /></Svg>;
    case "files":
      return <Svg size={size}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>;
    case "releases":
      return <Svg size={size}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></Svg>;
    case "insights":
      return <Svg size={size}><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></Svg>;
    case "governance":
      return <Svg size={size}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M12 8v5M9.5 10.5h5" /></Svg>;
    case "docs":
      return <Svg size={size}><path d="M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 1-2-2z" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /><path d="M7 8h2M15 8h2M7 12h2M15 12h2" /></Svg>;
    case "download":
      return <Svg size={size}><path d="M12 4v11M7 10l5 5 5-5M4 20h16" /></Svg>;
    case "upload":
      return <Svg size={size}><path d="M12 20V9M7 14l5-5 5 5M4 4h16" /></Svg>;
    case "copy":
      return <Svg size={size}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Svg>;
    case "refresh":
      return <Svg size={size}><path d="M20 12a8 8 0 1 1-2.3-5.6M20 3v4h-4" /></Svg>;
    case "folder":
      return <Svg size={size}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>;
    case "file":
      return <Svg size={size}><path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v4h4" /></Svg>;
    case "image":
      return <Svg size={size}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M4 18l5-5 3 3 4-4 4 4" /></Svg>;
    case "external":
      return <Svg size={size}><path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" /></Svg>;
    case "chat":
      return <Svg size={size}><path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4 4v-4H6a2 2 0 0 1-2-2z" /><path d="M8 8h8M8 11h5" /></Svg>;
    case "send":
      return <Svg size={size}><path d="M4 12l16-8-6 16-3-6-7-2z" /></Svg>;
  }
}
