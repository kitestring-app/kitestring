// Small inline icon set (stroke icons, 24px grid). No icon library dependency.
import type { SVGProps } from "react";

const P = (d: string) => (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="var(--icon-stroke, 1.8)" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d={d} />
  </svg>
);

export const Icon = {
  play: P("M7 4.5v15l12-7.5z"),
  pause: P("M8 5v14M16 5v14"),
  reset: P("M4 4v6h6M20 20v-6h-6M5.6 15a7 7 0 0 0 12.5 2M18.4 9A7 7 0 0 0 5.9 7"),
  skip: P("M5 5l10 7-10 7zM19 5v14"),
  pip: P("M3 5h18v14H3zM12 12h7v5h-7z"),
  tasks: P("M4 6l1.5 1.5L8 5M11 6.5h9M4 13h4v4H4zM11 15h9"),
  music: P("M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"),
  note: P("M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"),
  gear: P("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"),
  full: P("M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"),
  close: P("M6 6l12 12M18 6L6 18"),
  palette: P("M12 3a9 9 0 1 0 0 18c1 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7.9-9-7.9zM7.5 11.5h.01M10.5 7.5h.01M15 7.5h.01"),
  clock: P("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2"),
  timer: P("M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2 2M9 2h6M19 5l1.5-1.5"),
  stats: P("M5 20v-4M12 20V10M19 20V4"),
  quote: P("M7 11H4V7h4v4l-2 5M17 11h-3V7h4v4l-2 5"),
  sparkle: P("M4 20l6-10 4 4zM14 6l1-2M18 9l2-1M17 4l.5.5M20 13h1"),
  data: P("M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"),
  info: P("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01"),
  home: P("M3 11l9-7 9 7v9h-6v-6H9v6H3z"),
  plus: P("M12 5v14M5 12h14"),
  more: P("M5 12h.01M12 12h.01M19 12h.01"),
  check: P("M5 12l5 5 9-10"),
  trash: P("M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"),
  up: P("M12 19V5M6 11l6-6 6 6"),
  chevronDown: P("M6 9l6 6 6-6"),
  down: P("M12 5v14M6 13l6 6 6-6"),
  copy: P("M8 8h12v12H8zM4 16V4h12"),
  heart: P("M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"),
  shuffle: P("M3 7h4l10 10h4M17 7h4M3 17h4l3-3M14 10l3-3M19 5l2 2-2 2M19 15l2 2-2 2"),
  volume: P("M11 4 5 9H2v6h3l6 5zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"),
  muted: P("M11 4 5 9H2v6h3l6 5zM16 9l6 6M22 9l-6 6"),
  stop: P("M6 6h12v12H6z"),
};
