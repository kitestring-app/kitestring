import { expect, it, vi } from 'vitest';
const gate = vi.hoisted(() => ({ loading: false }));
vi.mock('../lib/store', async original => {
  const store = await original<typeof import('../lib/store')>();
  return { ...store, storeSource: (key: string) => key === 'clockPresence' && gate.loading ? 'loading' : store.storeSource(key) };
});
vi.mock('../audio/core', () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock('../audio/companion', () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
it('waits for clock presence before offering a loaded recovery', async () => {
  const t = await import('./timer');
  await t.timerHydrationReady;
  t.timer.set({ ...t.timer.get(), startedAt: null, boundary: { id: 'loaded', ended: 'focus', at: 1, missed: true } });
  gate.loading = true;
  expect(t.recoveryOffer()).toBeNull();
  gate.loading = false;
  expect(t.recoveryOffer()).toBe('missed-end');
});
