import { expect, it, vi } from 'vitest';
const gate = vi.hoisted(() => ({ loading: false }));
const hooks = vi.hoisted(() => ({ reads: [] as { subscribe: (listener: () => void) => () => void; get: () => unknown }[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useSyncExternalStore: (subscribe: (listener: () => void) => () => void, get: () => unknown) => {
    hooks.reads.push({ subscribe, get }); return get();
  },
}));
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


it.each([null, { segId: 'loaded', lastAliveAt: 1, ownerId: 'previous' }])('reveals a paused recovery when presence hydration emits %s without a timer update', async presence => {
  const t = await import('./timer');
  await t.timerHydrationReady;
  t.clockPresence.set(null);
  t.timer.set({ ...t.timer.get(), startedAt: null, boundary: { id: 'loaded', ended: 'focus', at: 1, missed: true } });
  const { useRecoveryOffer } = await import('../ui/RecoveryCard');
  gate.loading = true; hooks.reads = [];
  let visible = useRecoveryOffer();
  expect(visible).toBeNull();
  const off = hooks.reads.map(({ subscribe, get }) => {
    let previous = get();
    return subscribe(() => {
      const next = get();
      // React rerenders only when the subscribed snapshot actually changes.
      if (!Object.is(previous, next)) { previous = next; visible = useRecoveryOffer(); }
    });
  });
  try {
    gate.loading = false;
    t.clockPresence.set(presence);
    expect(visible).toBe('missed-end');
  } finally { off.forEach(unsubscribe => unsubscribe()); gate.loading = false; }
});
