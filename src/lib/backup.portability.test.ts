import "fake-indexeddb/auto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubGlobal("navigator", {}); vi.stubGlobal("BroadcastChannel", undefined); });

beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal("BroadcastChannel", undefined);
  const db = await import("./db"); await db.dbSetMany([["settings", {}]], await db.dbKeys());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const metadata = async () => ["sync-meta", {}] as [string, unknown];

it("classifies every production createStore key, including generic calls, and nothing stale", async () => {
  const { STORE_CLASS } = await import("./backup");
  const keys: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = resolve(path, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (!/\.tsx?$/.test(file) || /\.(?:test|browser-fixture)\./.test(file)) continue;
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "createStore") {
          const key = node.arguments[0];
          // Computed store keys must get an explicit portability decision too.
          expect(key && ts.isStringLiteral(key), file).toBe(true);
          if (key && ts.isStringLiteral(key)) keys.push(key.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  walk(resolve("src"));
  expect([...new Set(keys)].sort()).toEqual(Object.keys(STORE_CLASS).sort());
  for (const value of Object.values(STORE_CLASS)) {
    expect(["shared", "device", "content", "internal"]).toContain(value.class);
    expect(value.class === "internal").toBe(value.section === null);
  }
});

// Traverse the defaults, rather than hand-selecting settings to exercise. Strings
// with constrained valid values need explicit alternatives; a new enum fails here
// until a valid alternate is provided. Every other new leaf is exercised directly.
const alternateStrings: Record<string, string> = {
  "timer.startChimeSound": "bell",
  "timer.display": "hidden", "timer.mode": "countdown", "timer.autoRun": "cycle", "timer.flipPalette": "fern",
  "timer.style": "flip", "timer.alertSound": "bell", "timer.focusDoneSound": "chime",
  "timer.breakOverSound": "wood", "timer.ticking": "both", "timer.tickStyle": "digital", "timer.tally": "stem",
  "clock.format": "24", "clock.size": "small", "clock.font": "mono",
  "themes.home.kind": "color", "themes.focus.kind": "color", "themes.ambient.kind": "color",
  "themes.home.id": "#123abc", "themes.focus.id": "#345abc", "themes.ambient.id": "#567abc",
  "quotes.category": "focus", "extras.defaultTab": "data", "extras.randomizer": "daily",
  "appearance.look": "companion", "appearance.fx": "grain", "appearance.reminderGlass": "clear",
  "dash": "home", "lastTab": "about",
};
function changedLeaves(value: unknown, path = ""): unknown {
  if (typeof value === "boolean") return !value;
  if (typeof value === "number") return value <= 1 ? (value === 0 ? 0.1 : value / 2) : value + 1;
  if (typeof value === "string") return alternateStrings[path] ?? "Portable setup";
  if (value && typeof value === "object" && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).map(([key, leaf]) => [key, changedLeaves(leaf, path ? `${path}.${key}` : key)]));
  throw new Error(`Add a valid alternate for ${path}`);
}
function assertEveryLeafChanged(defaults: unknown, candidate: unknown, path = "") {
  if (defaults && typeof defaults === "object") {
    for (const [key, value] of Object.entries(defaults)) assertEveryLeafChanged(value, (candidate as Record<string, unknown>)[key], `${path}.${key}`);
  } else expect(candidate, path).not.toEqual(defaults);
}

it("round-trips every settings leaf through export, parse, restore, disk and reload sanitization", async () => {
  const b = await import("./backup"); const s = await import("../state/settings");
  const { dbGet } = await import("./db"); await s.calmFoundationReady;
  const different = changedLeaves(s.DEFAULT_SETTINGS) as typeof s.DEFAULT_SETTINGS;
  assertEveryLeafChanged(s.DEFAULT_SETTINGS, different);
  expect(s.sanitizeSettings(different)).toEqual(different); // all generated values must be valid
  s.settings.set(different);
  const file = await b.createBackup({ sections: ["settings"], includeName: true });
  const parsed = b.parseBackup(file);
  expect(parsed.data.settings).toEqual(different);
  s.settings.set(s.DEFAULT_SETTINGS);
  await b.restoreBackup(parsed, metadata);
  expect(s.settings.get()).toEqual(different);
  expect(await dbGet("settings")).toEqual(different);
  expect(s.sanitizeSettings(await dbGet("settings"))).toEqual(different);
});

it("anonymizes the name by default, includes it only on request and always includes settings", async () => {
  const b = await import("./backup"); const s = await import("../state/settings"); await s.calmFoundationReady;
  s.settingsUpdate("extras", { displayName: "Sample person" });
  for (const options of [false, true, { sections: [] }]) {
    const file = JSON.parse(await b.createBackup(options));
    expect(file.sections).toContain("settings"); expect(file.data.settings.extras.displayName).toBe(s.DEFAULT_SETTINGS.extras.displayName);
  }
  expect(JSON.parse(await b.createBackup({ includeName: true })).data.settings.extras.displayName).toBe("Sample person");
  expect(s.settings.get().extras.displayName).toBe("Sample person");
});

it("uses sections to export and import device and sound preferences, excluding all internal/account data", async () => {
  const b = await import("./backup"); const s = await import("../state/settings"); await s.calmFoundationReady;
  const { dbSetMany, dbGet } = await import("./db");
  await s.localPreferencesReady;
  const privateKeys = [...Object.entries(b.STORE_CLASS).filter(([, value]) => value.class === "internal").map(([key]) => key), "sync-account", "sync-meta"];
  await dbSetMany([...privateKeys.map(key => [key, { secret: "Must stay local" }] as [string, unknown]), ["mixer", { layers: [], mixes: [], favourites: [] }]]);
  s.localPreferences.set({ ...s.DEFAULT_LOCAL_PREFERENCES, floatingOnTop: false, muted: true, migrated: true });
  s.floatingGlass.set({ opacity: 0.8 });
  const parsed = b.parseBackup(await b.createBackup({ sections: ["sounds", "device"] }));
  expect(parsed.version).toBe(2); expect(parsed.exportedAt).toBeDefined();
  expect(parsed.sections).toEqual(["settings", "sounds", "device"]);
  expect(parsed.data.devicePreferences).toEqual(s.localPreferences.get()); expect(parsed.data.floatingGlass).toEqual({ opacity: 0.8 });
  for (const key of privateKeys) expect(parsed.data).not.toHaveProperty(key);
  expect(parsed.data).not.toHaveProperty("timer");
  s.floatingGlass.set({ opacity: 0.1 });
  await b.restoreBackup(parsed, metadata, ["device"]);
  expect(s.floatingGlass.get()).toEqual({ opacity: 0.8 }); expect(await dbGet("floatingGlass")).toEqual({ opacity: 0.8 });
});

it("applying only settings keeps tasks, stats and intent intact in memory and on disk", async () => {
  const b = await import("./backup"); const s = await import("../state/settings");
  const { tasks } = await import("../state/tasks"); const { stats } = await import("../state/stats"); const { intent, updateIntent } = await import("../state/intent");
  const { flushReadyStores } = await import("./store"); const { dbGet } = await import("./db");
  await s.calmFoundationReady; await Promise.all([tasks.ready, stats.ready, intent.ready]);
  tasks.set([{ id: "current", title: "Keep this task", done: false, createdAt: Date.now() }]);
  stats.set({ chunks: [], tasksDone: [{ taskId: "current", at: Date.now() }] }); updateIntent({ action: "Keep this next action" });
  await flushReadyStores();
  const before = { tasks: structuredClone(tasks.get()), stats: structuredClone(stats.get()), intent: structuredClone(intent.get()) };
  const parsed = b.parseBackup(JSON.stringify({ format: b.BACKUP_FORMAT, version: 2, sections: ["settings", "focus"], data: {
    settings: { ...s.DEFAULT_SETTINGS, sounds: { master: 0.2 } }, tasks: [], stats: { chunks: [], tasksDone: [] },
    intent: { action: "Replace", why: "", rev: 1, updatedAt: 0 }, notes: "Other notes",
  } }));
  const stamp = vi.fn(metadata);
  await b.restoreBackup(parsed, stamp, ["settings"]);
  expect(stamp).toHaveBeenCalledWith(["settings"]);
  expect(s.settings.get().sounds.master).toBe(0.2);
  expect({ tasks: tasks.get(), stats: stats.get(), intent: intent.get() }).toEqual(before);
  for (const [key, value] of Object.entries(before)) expect(await dbGet(key)).toEqual(value);
});

it("v1 device keys remain ignored, while v2 rejects invalid manifests and validates even unselected content", async () => {
  const b = await import("./backup");
  const wrap = (extra: object) => JSON.stringify({ format: b.BACKUP_FORMAT, version: 2, sections: ["settings"], data: { settings: {} }, ...extra });
  for (const sections of [undefined, [], ["focus"], ["settings", "settings"], ["settings", "future"]]) expect(() => b.parseBackup(wrap({ sections }))).toThrow(/sections/);
  expect(() => b.parseBackup(wrap({ data: { settings: {}, tasks: [] } }))).toThrow(/sections/);
  expect(() => b.parseBackup(wrap({ images: [] }))).toThrow(/sections/);
  expect(() => b.parseBackup(wrap({ sections: ["settings", "device"], data: { settings: {}, floatingGlass: { opacity: 5 } } }))).toThrow(/opacity/);
  expect(() => b.parseBackup(wrap({ sections: ["settings", "focus"], data: { settings: {}, tasks: "bad" } }))).toThrow(/tasks/);
  const old = b.parseBackup(wrap({ version: 1, data: { notes: "old", devicePreferences: { muted: true }, tinyStarts: {} } }));
  expect(old.sections).toEqual(["focus"]); expect(old.data).toEqual({ notes: "old" });
});

it("a failed selective import rolls live stores and disk back, and an empty selection writes nothing", async () => {
  const b = await import("./backup"); const s = await import("../state/settings"); const db = await import("./db");
  await s.calmFoundationReady; const { flushReadyStores } = await import("./store"); await flushReadyStores();
  const before = structuredClone(s.settings.get()); const diskBefore = await db.dbGet("settings");
  const parsed = b.parseBackup(await b.createBackup({ sections: ["settings"] }));
  (parsed.data.settings as typeof s.DEFAULT_SETTINGS).sounds.master = 0.123;
  const stamp = vi.fn(metadata);
  await expect(b.restoreBackup(parsed, stamp, [])).rejects.toThrow(/Choose/); expect(stamp).not.toHaveBeenCalled();
  vi.spyOn(db, "dbSetMany").mockRejectedValueOnce(new Error("Storage is full"));
  await expect(b.restoreBackup(parsed, metadata, ["settings"])).rejects.toThrow("Storage is full");
  expect(s.settings.get()).toEqual(before); expect(await db.dbGet("settings")).toEqual(diskBefore);
});

it('round-trips every task leaf and its recorded work with Focus data, including legacy v1', async () => {
  const b = await import('./backup'); const { tasks } = await import('../state/tasks');
  const { stats } = await import('../state/stats'); const db = await import('./db');
  await Promise.all([tasks.ready, stats.ready]);
  await (await import('../state/timer')).timerHydrationReady;
  const at = Date.now();
  const value = [{ id: 'estimated', title: 'Write project outline', emoji: 'pen-line', color: '#abcdef', etaMin: 20,
    done: true, parentId: 'parent', createdAt: at }];
  const recorded = { chunks: [{ id: 'work', taskId: 'estimated', kind: 'focus' as const, segment: 'focus' as const,
    start: at, ms: 900000, completed: false }], tasksDone: [{ taskId: 'estimated', at }] };
  expect(b.STORE_CLASS.tasks).toEqual({ class: 'content', section: 'focus' });
  expect(b.STORE_CLASS.stats).toEqual({ class: 'content', section: 'focus' });
  tasks.set(value); stats.set(recorded);
  for (const version of [1, 2]) {
    const file = JSON.parse(await b.createBackup({ sections: ['focus'] })); file.version = version;
    const parsed = b.parseBackup(JSON.stringify(file));
    tasks.set([]); stats.set({ chunks: [], tasksDone: [] });
    await b.restoreBackup(parsed, metadata, ['focus']);
    expect(tasks.get()).toEqual(value); expect(await db.dbGet('tasks')).toEqual(value);
    expect(stats.get()).toEqual(recorded); expect(await db.dbGet('stats')).toEqual(recorded);
  }
  const legacy = b.parseBackup(JSON.stringify({ format: b.BACKUP_FORMAT, version: 1, data: {
    tasks: [{ id: 'old', title: 'No guess', done: false, createdAt: at }],
  } }));
  expect(legacy.data.tasks).toEqual([{ id: 'old', title: 'No guess', done: false, createdAt: at }]);
});

it.each([1, 2])("preserves every away chunk field in v%s backups, including multi-day gaps", async version => {
  const b = await import("./backup"); const { stats } = await import("../state/stats"); const { dbGet } = await import("./db");
  await stats.ready;
  const chunk = { id: "away", kind: "break", segment: "short", start: Date.now(), ms: 3 * 86_400_000, completed: false, away: true, futureField: { kept: true } };
  const file = { format: b.BACKUP_FORMAT, version, ...(version === 2 ? { sections: ["settings", "focus"] } : {}), data: { settings: {}, stats: { chunks: [chunk], tasksDone: [] } } };
  await b.restoreBackup(b.parseBackup(JSON.stringify(file)), metadata);
  expect((await dbGet<any>("stats")).chunks).toEqual([chunk]);
  expect(b.parseBackup(await b.createBackup({ sections: ["focus"] })).data.stats).toEqual({ chunks: [chunk], tasksDone: [] });
  expect(b.STORE_CLASS).toHaveProperty("clockPresence", { class: "internal", section: null });
  expect(JSON.parse(await b.createBackup({ sections: ["focus", "device"] })).data).not.toHaveProperty("clockPresence");
});
