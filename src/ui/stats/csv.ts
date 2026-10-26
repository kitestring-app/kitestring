import type { SessionLogDay } from "../../state/stats";

/** RFC 4180: quote every field, double embedded quotes, and use CRLF records. */
export function csvCell(value: string | number): string {
  const text = String(value);
  // Also guard formulas after leading whitespace/control characters.
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function sessionLogCsv(days: SessionLogDay[]): string {
  const rows: (string | number)[][] = [["Date", "Start", "End", "Length (seconds)", "Session", "Task", "Status", "Interruptions"]];
  for (const day of days) for (const session of day.sessions) rows.push([
    day.day, new Date(session.start).toISOString(), new Date(session.end).toISOString(),
    session.ms / 1000, session.segment === "focus" ? "Focus" : session.segment === "short" ? "Short break" : "Long break",
    session.taskTitles.join("; "), session.earlyEndReason ? `Hard mode: ended early: ${session.earlyEndReason}` : session.completed ? "Completed" : "Cut short", session.interruptions,
  ]);
  return rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** A normal download link works in the browser and Electron's shared renderer. */
export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the download manager time to consume the URL, including on Electron.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
