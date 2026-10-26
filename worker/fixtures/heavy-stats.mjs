// Synthetic heavy use, shaped like StatsData; no personal history is read.
// A year of daily work: eight focus runs (each paused once), eight breaks and
// eight completed tasks per day. IDs have the same lengths as the app's IDs.
export function heavyStats() {
  const chunks = [], tasksDone = [];
  const origin = Date.UTC(2025, 0, 1);
  const id = n => n.toString(36).padStart(12, '0');
  for (let day = 0; day < 365; day++) {
    for (let run = 0; run < 8; run++) {
      const n = day * 8 + run;
      const start = origin + day * 86400_000 + run * 3600_000;
      const taskId = id(n);
      for (let part = 0; part < 2; part++) chunks.push({ kind: 'focus', segment: 'focus', start: start + part * 750_000, ms: 750_000, completed: part === 1, segId: n.toString(36).padStart(8, '0'), id: id(n * 3 + part), taskId });
      chunks.push({ kind: 'break', segment: 'short', start: start + 1500_000, ms: 300_000, completed: true, segId: (n + 10000).toString(36).padStart(8, '0'), id: id(n * 3 + 2) });
      tasksDone.push({ at: start + 1500_000, taskId });
    }
  }
  return { chunks, tasksDone };
}
