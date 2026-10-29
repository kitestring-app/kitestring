import { describe, expect, it } from 'vitest';
import { validTaskAllowances, preserveTaskAllowances } from './taskAllowance';
import type { TaskAllowance } from './taskAllowance';
const task = (id: string, patch = {}): TaskAllowance & { title: string; done: boolean; createdAt: number } => ({ id, title: id, done: false, createdAt: 1, ...patch });
describe('leaf-only transition allowance contract', () => {
  it.each([undefined, null, 0, 10, 240])('accepts absent, explicit clear and bounded integer %j', value => {
    expect(validTaskAllowances([task('a', { transitionAllowanceMin: value })])).toBe(true);
  });
  it.each([-1, 241, 1.5, NaN, Infinity, '10', false, {}])('rejects malformed allowance %j', value => {
    expect(validTaskAllowances([task('a', { transitionAllowanceMin: value })])).toBe(false);
  });
  it('rejects a parent allowance without rejecting a leaf subtask', () => {
    expect(validTaskAllowances([task('a', { transitionAllowanceMin: 10 }), task('b', { parentId: 'a' })])).toBe(false);
    expect(validTaskAllowances([task('a'), task('b', { parentId: 'a', transitionAllowanceMin: 0 })])).toBe(true);
  });
  it('preserves legacy omissions by stable task id, without resurrecting deleted tasks', () => {
    const previous = [task('a', { transitionAllowanceMin: 10 }), task('deleted', { transitionAllowanceMin: 5 })];
    expect(preserveTaskAllowances([task('a', { title: 'Renamed' }), task('new')], previous)).toEqual([
      task('a', { title: 'Renamed', transitionAllowanceMin: 10 }), task('new'),
    ]);
    expect(preserveTaskAllowances([task('a', { transitionAllowanceMin: null })], previous)[0].transitionAllowanceMin).toBeNull();
  });
  it('does not carry an allowance onto a parent or a replacement task', () => {
    const previous = [task('a', { transitionAllowanceMin: 10 })];
    const next = [task('a'), task('b', { parentId: 'a' }), task('replacement')];
    expect(preserveTaskAllowances(next, previous)).toEqual([{ ...next[0], transitionAllowanceMin: null }, ...next.slice(1)]);
  });
});

it('S1: promotion and later child deletion cannot resurrect another device’s stale allowance', () => {
  const previous = [task('a', { transitionAllowanceMin: 10 })];
  const parent = preserveTaskAllowances([task('a'), task('child', { parentId: 'a' })], previous);
  expect(parent[0].transitionAllowanceMin).toBeNull();
  const leaf = preserveTaskAllowances([task('a')], parent);
  expect(preserveTaskAllowances(leaf, previous)[0].transitionAllowanceMin).toBeNull();
});
it('S1: even a copy without an allowance records every observed parent as explicitly cleared', () => {
  const parent = preserveTaskAllowances([task('a'), task('child', { parentId: 'a' })], []);
  expect(parent[0].transitionAllowanceMin).toBeNull();
  const leaf = preserveTaskAllowances([task('a')], parent);
  expect(preserveTaskAllowances(leaf, [task('a', { transitionAllowanceMin: 10 })])[0].transitionAllowanceMin).toBeNull();
});

it('accepts valid carried parent fields only on the legacy sync path, then clears them', () => {
  const rows = [task('a', { transitionAllowanceMin: 10 }), task('child', { parentId: 'a' })];
  expect(validTaskAllowances(rows)).toBe(false);
  expect(validTaskAllowances(rows, true)).toBe(true);
  expect(preserveTaskAllowances(rows, [])[0].transitionAllowanceMin).toBeNull();
  expect(validTaskAllowances([task('a', { transitionAllowanceMin: -1 }), rows[1]], true)).toBe(false);
});
