import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.stubGlobal("BroadcastChannel", undefined); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('uses cookies on web and keeps auth data inside the desktop bridge on Mac', async () => {
  const fetch = vi.fn(async () => Response.json({ ok: true, email: 'test@example.invalid' }));
  vi.stubGlobal('fetch', fetch);
  const { cloudRequest } = await import('./sync');
  await cloudRequest('GET', '/api/me');
  expect(fetch.mock.calls[0]).toMatchObject(['/api/me', { credentials: 'same-origin', redirect: 'error' }]);
  const status = vi.fn(async () => ({ status: 200, data: { ok: true } }));
  const request = vi.fn(async () => ({ status: 200, data: { ok: true, entries: [] } }));
  const signIn = vi.fn(async () => ({ status: 200, data: { ok: true } }));
  vi.stubGlobal('window', { desktop: { cloud: { status, request, signIn } } });
  await cloudRequest('GET', '/api/me');
  await cloudRequest('GET', '/api/sync');
  const password = crypto.randomUUID();
  await cloudRequest('POST', '/api/auth/login', { email: 'test@example.invalid', password });
  expect(status).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith('GET', '/api/sync', undefined);
  expect(signIn).toHaveBeenCalledWith('test@example.invalid', password);
  expect(fetch).toHaveBeenCalledOnce();
});

async function setup() {
  const db = await import('./db');
  for (const key of await db.dbKeys()) await db.dbDel(key);
  await db.dbSet('settings', {});
  const sync = await import('./sync');
  const store = await import('./store');
  await (await import('../state/settings')).calmFoundationReady;
  const notes = store.createStore('notes', '');
  const tasks = store.createStore<unknown[]>('tasks', []);
  await Promise.all([notes.ready, tasks.ready]);
  notes.set('local notes'); tasks.set(['local task']);
  await store.flushAll();
  vi.stubGlobal('location', { protocol: 'https:', hostname: 'custom-pomodoro.custom-pomodoro.workers.dev' });
  vi.stubGlobal('document', { addEventListener: vi.fn(), visibilityState: 'visible' });
  const puts: unknown[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url === '/api/me') return Response.json({ ok: false }, { status: 401 });
    if (url === '/api/auth/login') return Response.json({ ok: true, email: 'test@example.invalid' });
    if (url === '/api/sync' && init.method === 'GET') return Response.json({ entries: [{ key: 'notes', value: 'account notes', updatedAt: Date.now() - 1000 }] });
    if (url === '/api/sync' && init.method === 'PUT') puts.push(JSON.parse(init.body as string));
    return Response.json({ ok: true });
  });
  vi.stubGlobal('fetch', fetch);
  vi.useFakeTimers({ toFake: ["setInterval"] });
  await sync.startSync();
  await sync.signIn('test@example.invalid', crypto.randomUUID());
  return { sync, store, db, notes, tasks, fetch, puts };
}
it('waits for an explicit first-device choice and keep uploads the device data', async () => {
  const { sync, notes, fetch, puts } = await setup();
  expect(sync.syncStatus.get().state).toBe('choice');
  expect(fetch.mock.calls.filter(c => c[0] === '/api/sync')).toHaveLength(0);
  await sync.syncNow();
  expect(fetch.mock.calls.filter(c => c[0] === '/api/sync')).toHaveLength(0);
  await sync.chooseInitialData('keep');
  expect(notes.get()).toBe('local notes');
  expect(puts).toMatchObject([{ entries: expect.arrayContaining([{ key: 'notes', value: 'local notes', updatedAt: expect.any(Number) }]) }]);
  expect(sync.syncStatus.get().state).toBe('ok');
  await sync.signOut();
  const count = fetch.mock.calls.length;
  await sync.syncNow();
  expect(fetch.mock.calls).toHaveLength(count);
  expect(notes.get()).toBe('local notes');
});
it('replace takes account data and clears local values absent in the account', async () => {
  const { sync, notes, tasks, puts, db } = await setup();
  await sync.chooseInitialData('replace');
  expect(notes.get()).toBe('account notes');
  expect(tasks.get()).toEqual([]);
  expect(puts).toEqual([]);
  expect(await db.dbGet('sync-account')).toBe('test@example.invalid');
});
it('gives the same readable rate-limit message through either transport', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false }, { status: 429, headers: { 'Retry-After': '120' } })));
  const { cloudRequest } = await import('./sync');
  await expect(cloudRequest('POST', '/api/auth/login', {})).rejects.toThrow('Try again in 2 minutes.');
});

it('C2: all nine dirty keys upload together, including the whole intent document', async () => {
  const { sync, store, puts } = await setup();
  const { intent, updateIntent } = await import('../state/intent');
  for (const key of sync.SYNC_KEYS) {
    if (['notes', 'tasks', 'intent'].includes(key)) continue;
    const state = store.createStore(key, {}); await state.ready; state.set({ changed: true });
  }
  updateIntent({ action: 'Open the document', why: 'Share an outline', cue: 'After lunch, open the draft', reward: 'Tea outside' });
  await store.flushAll();
  await sync.chooseInitialData('keep');
  expect(puts).toHaveLength(1);
  const sent = puts[0] as { entries: { key: string; value: unknown }[] };
  expect(sent.entries.map(e => e.key).sort()).toEqual([...sync.SYNC_KEYS].sort());
  expect(sent.entries.find(e => e.key === 'intent')?.value).toEqual(intent.get());
  await sync.signOut();
});
it.each([401, 413])('C2: %s keeps the local intent and never reports a successful sync', async code => {
  const { sync, store, fetch } = await setup();
  await sync.chooseInitialData('keep');
  const { intent, updateIntent } = await import('../state/intent');
  updateIntent({ action: 'Keep this offline', why: 'Local work matters' }); await store.flushAll();
  const original = structuredClone(intent.get());
  const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (url, init) => url === '/api/sync' && init.method === 'PUT'
    ? Response.json({ error: 'Upload unavailable' }, { status: code }) : fallback(url, init));
  await sync.syncNow();
  expect(intent.get()).toEqual(original);
  expect(sync.syncStatus.get().state).toBe(code === 401 ? 'signedOut' : 'error');
  expect(sync.syncStatus.get().state).not.toBe('ok');
  await sync.signOut();
});
it('C2: invalid remote shape cannot replace the local document', async () => {
  const { sync, store, fetch } = await setup(); await sync.chooseInitialData('keep');
  const { intent, updateIntent } = await import('../state/intent');
  updateIntent({ action: 'Saved action', why: '' }); await store.flushAll();
  const original = structuredClone(intent.get()); const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (url, init) => url === '/api/sync' && init.method === 'GET'
    ? Response.json({ entries: [{ key: 'intent', value: { action: 'incomplete' }, updatedAt: Date.now() + 1000 }, { key: 'notes', value: 'still sync notes', updatedAt: Date.now() + 1000 }] }) : fallback(url, init));
  await sync.syncNow();
  expect(intent.get()).toEqual(original); expect(sync.syncStatus.get().state).toBe('ok');
  expect(sync.syncStatus.get().warnings).toEqual({ intent: expect.stringContaining('local next action is kept') });
  expect(store.storeValue('notes')).toBe('still sync notes');
  await sync.signOut();
});

it('C6: an in-flight pull cannot replace imported intent, including an equal-time import', async () => {
  const { sync, store, fetch, db } = await setup(); await sync.chooseInitialData('keep');
  const { intent, updateIntent } = await import('../state/intent');
  updateIntent({ action: 'Before import', why: '' }); await store.flushAll();
  const originalTime = (await db.dbGet<Record<string, number>>('sync-meta'))!.intent;
  const stamp = await sync.metaAfterImport(['intent'], originalTime); expect(stamp[1].intent).toBeGreaterThan(originalTime);
  const fallback = fetch.getMockImplementation()!;
  let finish!: (response: Response) => void; let started!: () => void;
  const fetching = new Promise<void>(resolve => { started = resolve; });
  fetch.mockImplementation(async (url, init) => {
    if (url === '/api/sync' && init.method === 'GET') { started(); return new Promise<Response>(resolve => { finish = resolve; }); }
    return fallback(url, init);
  });
  const pulling = sync.syncNow(); await fetching;
  const { restoreBackup } = await import('./backup');
  const imported = { action: 'Imported action', why: 'Keep together', rev: 12, updatedAt: Date.now() };
  const restoring = restoreBackup({ data: { intent: imported } }, sync.metaAfterImport);
  finish(Response.json({ entries: [{ key: 'intent', value: { ...imported, action: 'Stale remote' }, updatedAt: Date.now() + 1000 }] }));
  await Promise.all([pulling, restoring]); expect(intent.get()).toEqual(imported);
  expect(await db.dbGet('intent')).toEqual(imported);
  fetch.mockImplementation(fallback); await sync.syncNow(); expect(intent.get()).toEqual(imported);
  await sync.signOut();
});

it('1: fresh sign-in syncs without a choice, pulls remote settings and rederives the preset', async () => {
  const db = await import('./db'); for (const key of await db.dbKeys()) await db.dbDel(key);
  const s = await import('../state/settings'); await s.calmFoundationReady;
  expect(s.presetState.get().provisional).toBe(true);
  vi.stubGlobal('location', { protocol: 'https:', hostname: 'custom-pomodoro.custom-pomodoro.workers.dev' });
  vi.stubGlobal('document', { addEventListener: vi.fn(), visibilityState: 'visible' });
  const puts: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url === '/api/me') return Response.json({}, { status: 401 });
    if (url === '/api/auth/login') return Response.json({ email: 'test@example.invalid' });
    if (init.method === 'GET') return Response.json({ entries: [{ key: 'settings', value: { timer: { ...s.STRONG_PATCH, display: "hidden", lengths: { pomodoro: 47 } } }, updatedAt: 100 }] });
    if (url === '/api/sync' && init.method === 'PUT') puts.push(JSON.parse(init.body as string)); return Response.json({ ok: true });
  }));
  vi.useFakeTimers({ toFake: ['setInterval'] });
  const sync = await import('./sync'); const states: string[] = [];
  const off = sync.syncStatus.subscribe(() => states.push(sync.syncStatus.get().state));
  await sync.startSync(); await sync.signIn('test@example.invalid', crypto.randomUUID());
  expect(states).toContain('syncing'); expect(states).not.toContain('choice');
  expect(s.settings.get().timer).toMatchObject({ ...s.STRONG_PATCH, display: "hidden", lengths: { pomodoro: 47 } });
  expect(s.supportPresetLabel()).toBe('Strong'); expect(s.presetState.get().provisional).toBe(false);
  expect(puts).toEqual([]); off(); await sync.signOut();
});
it('4: client pulls known intent fields from a future document and strips unknown fields', async () => {
  const { sync, store, fetch } = await setup(); await sync.chooseInitialData('keep');
  const known = { action: 'New draft', why: 'Share it', cue: 'After lunch, open the draft', reward: 'Tea outside', rev: 9, updatedAt: 100 };
  const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (url, init) => url === '/api/sync' && init.method === 'GET'
    ? Response.json({ entries: [{ key: 'intent', value: { ...known, future: { enabled: true } }, updatedAt: Date.now() + 1000 }] }) : fallback(url, init));
  await sync.syncNow(); expect(store.storeValue('intent')).toEqual(known);
  expect(sync.syncStatus.get()).toMatchObject({ state: 'ok', warnings: {} }); await sync.signOut();
});

it('review2 P1: timer-only atomic saves never stamp or upload stale stats over a remote session', async () => {
  const { sync, store, fetch, puts, db } = await setup();
  const stats = store.createStore('stats', { chunks: [] as { segId: string; ms: number }[] });
  const timer = store.createStore('timer', { reentry: 'paused' });
  await Promise.all([stats.ready, timer.ready]);
  store.registerPersistenceGroup(['timer', 'stats']);
  await sync.chooseInitialData('keep'); puts.length = 0;
  const oldMeta = (await db.dbGet<Record<string, number>>('sync-meta'))?.stats ?? 0;
  const remote = { chunks: [{ segId: 'other-device-session', ms: 60_000 }] };
  const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (url, init) => url === '/api/sync' && init.method === 'GET'
    ? Response.json({ entries: [{ key: 'stats', value: remote, updatedAt: oldMeta + 1000 }] }) : fallback(url, init));
  const notified: string[][] = []; const off = store.onPersisted(keys => notified.push(keys));
  timer.set({ reentry: '' }); await store.flushReadyStores();
  expect(notified).toContainEqual(['timer']);
  expect((await db.dbGet<Record<string, number>>('sync-meta'))?.stats ?? 0).toBe(oldMeta);
  await sync.syncNow();
  expect(stats.get()).toEqual(remote);
  expect(puts.flatMap(p => (p as { entries: { key: string }[] }).entries).filter(e => e.key === 'stats')).toEqual([]);
  off(); await sync.signOut();
});

it('round-trips Hide stats within the whole settings document through sync upload and pull', async () => {
  const { sync, store, fetch, puts } = await setup();
  const s = await import('../state/settings');
  s.settingsUpdate('extras', { hideStats: true }); await store.flushAll();
  await sync.chooseInitialData('keep');
  const sent = (puts[0] as { entries: { key: string; value: typeof s.DEFAULT_SETTINGS }[] }).entries.find(e => e.key === 'settings')!.value;
  expect(sent.extras.hideStats).toBe(true); expect(sent).toEqual(s.settings.get());
  s.settings.set(s.DEFAULT_SETTINGS); await store.flushAll();
  const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (url, init) => url === '/api/sync' && init.method === 'GET'
    ? Response.json({ entries: [{ key: 'settings', value: sent, updatedAt: Date.now() + 1000 }] }) : fallback(url, init));
  await sync.syncNow();
  expect(s.settings.get()).toEqual(sent); expect((await (await import('./db')).dbGet<typeof sent>('settings'))?.extras.hideStats).toBe(true);
  await sync.signOut();
});

it('round-trips the wallpaper override through settings sync', async () => {
  const { sync, store, fetch, puts } = await setup();
  const s = await import('../state/settings');
  s.settingsUpdate('appearance', { look: 'sketch', lookBackdrop: false }); await store.flushAll();
  await sync.chooseInitialData('keep');
  const sent = (puts[0] as { entries: { key: string; value: typeof s.DEFAULT_SETTINGS }[] }).entries.find(e => e.key === 'settings')!.value;
  expect(sent.appearance.lookBackdrop).toBe(false);
  s.settings.set(s.DEFAULT_SETTINGS); await store.flushAll();
  const fallback = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (url, init) => url === '/api/sync' && init.method === 'GET'
    ? Response.json({ entries: [{ key: 'settings', value: sent, updatedAt: Date.now() + 1000 }] }) : fallback(url, init));
  await sync.syncNow();
  expect(s.settings.get().appearance).toEqual(sent.appearance);
  expect((await (await import('./db')).dbGet<typeof sent>('settings'))?.appearance.lookBackdrop).toBe(false);
  await sync.signOut();
});

it('mixed-version task estimates survive pull, unrelated edits and push without a new sync key', async () => {
  const { sync, tasks, fetch, store, puts } = await setup();
  const value = [{ id: 'estimated', title: 'Draft', etaMin: 20, done: false, createdAt: Date.now() },
    { id: 'legacy', title: 'Old task', done: false, createdAt: Date.now() }];
  fetch.mockImplementation(async (url, init) => {
    if (url === '/api/sync' && init.method === 'GET') return Response.json({ entries: [{ key: 'tasks', value, updatedAt: 1 }] });
    if (url === '/api/sync' && init.method === 'PUT') puts.push(JSON.parse(init.body as string));
    return Response.json({ ok: true });
  });
  await sync.chooseInitialData('replace'); expect(tasks.get()).toEqual(value);
  tasks.set(value.map(t => ({ ...t, title: t.title + ' edited' })));
  await store.flushAll(); await sync.syncNow();
  expect(puts).toMatchObject([{ entries: expect.arrayContaining([{ key: 'tasks', value: value.map(t => ({ ...t, title: t.title + ' edited' })), updatedAt: expect.any(Number) }]) }]);
});

it('away chunks and future fields survive upload and remote application while presence stays local', async () => {
  const { sync, store, puts } = await setup();
  const value = { chunks: [{ id: 'away', kind: 'break', segment: 'short', start: Date.now(), ms: 3 * 86_400_000, completed: false, away: true, futureField: { kept: true } }], tasksDone: [] };
  const stats = store.createStore('stats', { chunks: [] as unknown[], tasksDone: [] }); await stats.ready; stats.set(value);
  const presence = store.createStore('clockPresence', null); await presence.ready;
  await store.flushAll(); await sync.chooseInitialData('keep');
  const entries = (puts[0] as { entries: { key: string; value: unknown }[] }).entries;
  expect(entries.find(e => e.key === 'stats')?.value).toEqual(value);
  expect(entries.some(e => e.key === 'clockPresence')).toBe(false);
  const remote = { ...value, chunks: [{ ...value.chunks[0], id: 'remote' }] };
  await store.applySyncedValue('stats', remote); expect(stats.get()).toEqual(remote);
  expect(await (await import('./db')).dbGet('stats')).toEqual(remote); await sync.signOut();
});

it("N1: sync preserves enough from legacy same-action pulls and accepts explicit clear", async () => {
  const { sync, fetch, store } = await setup();
  const { intent, updateIntent } = await import("../state/intent"); await intent.ready;
  updateIntent({ action: "Draft", sufficientFinish: "Three paragraphs" }); await store.flushAll();
  let value: { action: string; why: string; rev: number; updatedAt: number; sufficientFinish?: string } = { action: "Draft", why: "Old client", rev: 2, updatedAt: 100 };
  let stamp = Date.now() + 1000;
  fetch.mockImplementation(async (url, init) => Response.json(url === '/api/sync' && init.method === 'GET'
    ? { entries: [{ key: 'intent', value, updatedAt: stamp++ }] } : { ok: true }));
  await sync.chooseInitialData("replace");
  expect(intent.get().sufficientFinish).toBe("Three paragraphs");
  expect((await (await import("./db")).dbGet<any>("intent")).sufficientFinish).toBe("Three paragraphs");
  value = { ...value, sufficientFinish: "" } as typeof value;
  await sync.syncNow(); expect(intent.get().sufficientFinish).toBe("");
  await sync.signOut();
});

it('N2: a legacy task pull preserves the allowance, explicit null clears and invalid values keep local data', async () => {
  const { sync, store, tasks, fetch, db } = await setup();
  const task = { id: 'a', title: 'Draft', etaMin: 20, done: false, createdAt: Date.now() };
  tasks.set([{ ...task, transitionAllowanceMin: 10 }]); await store.flushAll();
  let rows: unknown[] = [task], stamp = Date.now() + 1000;
  fetch.mockImplementation(async (url, init) => Response.json(url === '/api/sync' && init.method === 'GET'
    ? { entries: [{ key: 'tasks', value: rows, updatedAt: stamp++ }] } : { ok: true }));
  await sync.chooseInitialData('replace');
  expect(tasks.get()).toEqual([{ ...task, transitionAllowanceMin: 10 }]);
  expect(await db.dbGet('tasks')).toEqual(tasks.get());
  rows = [{ ...task, transitionAllowanceMin: null }]; await sync.syncNow();
  expect(tasks.get()).toEqual(rows);
  rows = [{ ...task, transitionAllowanceMin: -1 }]; await sync.syncNow();
  expect(sync.syncStatus.get().warnings?.tasks).toMatch(/invalid/);
  expect(tasks.get()).toEqual([{ ...task, transitionAllowanceMin: null }]);
  await sync.signOut();
});
