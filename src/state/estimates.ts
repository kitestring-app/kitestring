import type { Task } from './tasks';
import type { StatsData } from './stats';

const words = (title: string) => new Set(title.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
interface HistoryIndex {
  totals: Map<string, number>;
  completed: { task: Task; tokens: Set<string> }[];
}
// Stores replace task/history snapshots. Weak keys let old snapshots leave memory.
const snapshots = new WeakMap<Task[], WeakMap<StatsData, HistoryIndex>>();
function historyIndex(all: Task[], data: StatsData): HistoryIndex {
  let histories = snapshots.get(all);
  if (!histories) { histories = new WeakMap(); snapshots.set(all, histories); }
  const saved = histories.get(data);
  if (saved) return saved;
  const own = new Map<string, number>();
  for (const chunk of data.chunks) {
    if (chunk.kind === 'focus' && chunk.taskId) own.set(chunk.taskId, (own.get(chunk.taskId) ?? 0) + chunk.ms);
  }
  const totals = new Map(own);
  for (const task of all) {
    if (task.parentId && task.parentId !== task.id) {
      totals.set(task.parentId, (totals.get(task.parentId) ?? 0) + (own.get(task.id) ?? 0));
    }
  }
  const index = { totals, completed: all.filter(task => task.done && (totals.get(task.id) ?? 0) > 0)
    .map(task => ({ task, tokens: words(task.title) })) };
  histories.set(data, index);
  return index;
}

/** Saved active focus only. Pauses, breaks and wall-clock gaps never count. */
export function recordedTaskMs(task: Task, all: Task[], data: StatsData): number {
  return historyIndex(all, data).totals.get(task.id) ?? 0;
}

/** Local title overlap is a planning aid, not a prediction or grade. */
export function similarTasks(task: Task, all: Task[], data: StatsData): Task[] {
  const target = words(task.title);
  if (!target.size) return [];
  return historyIndex(all, data).completed
    .filter(item => item.task.id !== task.id && item.task.parentId !== task.id && task.parentId !== item.task.id)
    .map(item => {
      const overlap = [...target].filter(word => item.tokens.has(word)).length;
      return { task: item.task, overlap: overlap / (target.size + item.tokens.size - overlap) };
    }).filter(item => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || b.task.createdAt - a.task.createdAt)
    .slice(0, 3).map(item => item.task);
}

export function activeMinutes(ms: number): string {
  return ms < 60000 ? 'less than 1 min' : `${Math.round(ms / 60000)} min`;
}
