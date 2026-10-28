import { expect, it } from 'vitest';
import { recordedTaskMs, similarTasks } from './estimates';
import type { Task } from './tasks';
import type { StatsData } from './stats';
const task = (id: string, title: string, patch: Partial<Task> = {}): Task => ({ id, title, done: true, createdAt: 0, etaMin: 20, ...patch });
const data: StatsData = { tasksDone: [{ taskId: 'a', at: 100 }], chunks: [
  { id: '1', taskId: 'a', kind: 'focus', segment: 'focus', start: 0, ms: 60000, completed: false },
  { id: '2', taskId: 'b', kind: 'focus', segment: 'focus', start: 0, ms: 30000, completed: true },
  { id: 'no-guess', taskId: 'c', kind: 'focus', segment: 'focus', start: 0, ms: 900000, completed: true },
  { id: '3', taskId: 'a', kind: 'break', segment: 'short', start: 0, ms: 50000, completed: true },
] };
it('totals only recorded focus, including partial work and descendants once', () => {
  const all = [task('a', 'Draft'), task('b', 'Outline', { parentId: 'a' })];
  expect(recordedTaskMs(all[0], all, data)).toBe(90000);
  expect(recordedTaskMs(all[1], all, data)).toBe(30000);
  expect(recordedTaskMs(task('missing', ''), all, data)).toBe(0);
});
it('offers up to three comparable completed titles with recorded work, even without a guess, excluding self and relatives', () => {
  const current = task('now', 'Write project outline', { done: false });
  const all = [current, task('a', 'Write project outline'), task('b', 'Project notes'),
    task('c', 'Write project outline', { etaMin: undefined }), task('d', 'Write project outline', { done: false }),
    task('e', 'Buy groceries'), task('child', 'Project outline', { parentId: 'now' })];
  expect(similarTasks(current, all, data).map(t => t.id)).toEqual(['a', 'c', 'b']);
  expect(similarTasks(task('empty', ''), all, data)).toEqual([]);
});
