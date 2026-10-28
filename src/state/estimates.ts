import type { Task } from './tasks';
import type { StatsData } from './stats';

/** Saved active focus only. Pauses, breaks and wall-clock gaps never count. */
export function recordedTaskMs(task: Task, all: Task[], data: StatsData): number {
  const ids = new Set([task.id, ...all.filter(t => t.parentId === task.id).map(t => t.id)]);
  return data.chunks.reduce((total, chunk) => total +
    (chunk.kind === 'focus' && chunk.taskId && ids.has(chunk.taskId) ? chunk.ms : 0), 0);
}

/** Local title overlap is a planning aid, not a prediction or grade. */
export function similarTasks(task: Task, all: Task[], data: StatsData): Task[] {
  const words = (title: string) => new Set(title.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const target = words(task.title);
  if (!target.size) return [];
  return all.filter(t => t.done && t.id !== task.id && t.parentId !== task.id && task.parentId !== t.id &&
    recordedTaskMs(t, all, data) > 0)
    .map(t => {
      const tokens = words(t.title);
      const overlap = [...target].filter(word => tokens.has(word)).length;
      return { task: t, overlap: overlap / new Set([...target, ...tokens]).size };
    }).filter(item => item.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || b.task.createdAt - a.task.createdAt)
    .slice(0, 3).map(item => item.task);
}

export function activeMinutes(ms: number): string {
  return ms < 60000 ? 'less than 1 min' : `${Math.round(ms / 60000)} min`;
}
