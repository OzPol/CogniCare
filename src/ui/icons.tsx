import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  audio: <><path d="M3 9v6h4l5 4V5L7 9H3Z"/><path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  today: <><rect x="3" y="6" width="18" height="15" rx="3"/><path d="M7 3v6m10-6v6M3 11h18m-12 5h2"/></>,
  home: <><path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9Z"/><path d="M9 21v-7h6v7"/></>,
  games: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  care: <path d="M12 20S3 15 3 9.5a4.5 4.5 0 0 1 9-1 4.5 4.5 0 0 1 9 1C21 15 12 20 12 20Z"/>,
  water: <path d="M12 3C7 9 5 12 5 15a7 7 0 1 0 14 0c0-3-2-6-7-12Z"/>,
  med: <><path d="M9 4h6a5 5 0 0 1 5 5v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5Z"/><path d="M12 8v8m-4-4h8"/></>,
  activity: <><path d="M4 18c7 1 13-5 15-13-8 0-14 4-14 10"/><path d="M4 20c3-4 6-7 11-11"/></>,
};
export function Icon({ name, size = 22 }: { name: keyof typeof paths; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
