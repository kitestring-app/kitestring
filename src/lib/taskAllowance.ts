/** Null is an explicit clear for upgraded writers; omission by old writers preserves a leaf's value. */
export interface TaskAllowance { id: string; parentId?: string; transitionAllowanceMin?: number | null }
export function validAllowance(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 240;
}
/** Validate only this extension. Older opaque task payloads without it remain compatible. */
export function validTaskAllowances(value: unknown, legacyParents = false): boolean {
  if (!Array.isArray(value)) return !value || typeof value !== 'object' || !('transitionAllowanceMin' in value);
  const parents = new Set(value.map(t => t?.parentId).filter(Boolean));
  return value.every(t => !t || typeof t !== 'object' ||
    validAllowance(t.transitionAllowanceMin) && (legacyParents || t.transitionAllowanceMin == null || !parents.has(t.id)));
}
export function preserveTaskAllowances<T extends TaskAllowance>(next: T[], previous: T[]): T[] {
  const old = new Map(previous.map(t => [t.id, t]));
  const parents = new Set(next.map(t => t.parentId).filter(Boolean));
  return next.map(t => {
    if (parents.has(t.id)) return { ...t, transitionAllowanceMin: null };
    const saved = old.get(t.id)?.transitionAllowanceMin;
    return t.transitionAllowanceMin === undefined && saved !== undefined && validAllowance(saved)
      ? { ...t, transitionAllowanceMin: parents.has(t.id) ? null : saved } : t;
  });
}
