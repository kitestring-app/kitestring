import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ disk: new Map<string, unknown>(), writes: [] as [string, unknown][][],
  writeGate: undefined as Promise<void> | undefined, writeStarted: undefined as (() => void) | undefined,
  memory: false, failRead: false, failSettingsWrite: false, failSnapshot: false, gate: undefined as Promise<void> | undefined }));
vi.mock("../lib/db", () => ({
  dbGet: async (key: string) => {
    const saved = structuredClone(fixture.disk.get(key));
    if (key === "settings") { if (fixture.failRead) throw new Error("UnknownError"); await fixture.gate; }
    return saved;
  },
  dbKeys: vi.fn(async () => [...fixture.disk.keys()]),
  dbSetMany: async (entries: [string, unknown][]) => {
    if (entries.some(([key]) => key === "settings")) { fixture.writeStarted?.(); await fixture.writeGate; }
    if ((fixture.failSettingsWrite && entries.some(([key]) => key === "settings")) ||
      (fixture.failSnapshot && entries.some(([key, value]) => key === "deviceCalmPreset" && (value as { snapshot?: unknown }).snapshot))) throw new Error("QuotaExceededError");
    fixture.writes.push(structuredClone(entries));
    for (const [key, value] of entries) fixture.disk.set(key, structuredClone(value));
  },
  storageMode: () => fixture.memory ? "memory" : "indexeddb",
}));
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.stubGlobal("BroadcastChannel", undefined);
  vi.clearAllMocks(); fixture.memory = false; fixture.disk.clear(); fixture.writes = []; fixture.writeGate = undefined; fixture.writeStarted = undefined; fixture.failRead = false; fixture.failSettingsWrite = false; fixture.failSnapshot = false; fixture.gate = undefined; });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function launch() { const s = await import("./settings"); await s.calmFoundationReady; return s; }

it("V1: true fresh disk starts Calm, with silent ambient mixer defaults", async () => {
  const s = await launch();
  expect(s.settings.get().timer).toMatchObject(s.CALM_PATCH);
  expect(s.supportPresetLabel()).toBe("Calm");
  expect(s.settings.get().timer.hardMode).toBe(false);
  const { mixerStore } = await import("../audio/mixer"); await mixerStore.ready;
  expect(mixerStore.get().layers).toEqual([]);
  expect(fixture.disk.get("settings")).toMatchObject({ timer: s.CALM_PATCH });
});
it.each(["stats", "tasks", "settings"])("V1: an existing %s key, even empty, is not fresh", async key => {
  fixture.disk.set(key, key === "settings" ? {} : []);
  const s = await launch(); expect(s.settings.get()).toEqual({ ...s.DEFAULT_SETTINGS,
    appearance: { ...s.DEFAULT_SETTINGS.appearance, look: key === "settings" ? "classic" : "glass" } });
  expect(s.supportPresetLabel()).toBe("Strong");
  expect(fixture.writes.flat().some(([key]) => key === "settings")).toBe(false);
});
it("keeps pre-look settings Classic, fresh profiles Glass, and a saved Sunrise choice", async () => {
  for (const [stored, look] of [[{ timer: { notify: false } }, "classic"], [undefined, "glass"], [{ appearance: { look: "sunrise" } }, "sunrise"]] as const) {
    vi.resetModules(); fixture.disk.clear();
    if (stored !== undefined) fixture.disk.set("settings", stored);
    const s = await launch();
    expect(s.settings.get().appearance.look).toBe(look);
  }
});
it("V1/V2: existing custom lengths, explicit false, appearance and Hard mode survive; Restore is exact after relaunch", async () => {
  fixture.disk.set("settings", { timer: { lengths: { pomodoro: 47, short: 9, long: 21, countdown: 33 },
    takeover: false, speak: false, notify: false, bringToFront: false, interruptionPrompt: false,
    focusDoneSound: "bell", breakOverSound: "wood", alertSound: "bell", ticking: "both", hardMode: true, autoRun: "always" },
    extras: { reduceMotion: true }, sounds: { master: 0.34 } });
  let s = await launch(); const original = structuredClone(s.settings.get());
  expect(s.settings.get().timer.lengths.pomodoro).toBe(47);
  await s.applySupportPreset("Calm");
  expect(s.settings.get()).toEqual({ ...original, timer: { ...original.timer, ...s.CALM_PATCH } });
  const saved = s.presetState.get().snapshot;
  s.settingsUpdate("timer", { speak: true, lengths: { ...original.timer.lengths, pomodoro: 51 } });
  expect(s.supportPresetLabel()).toBe("Calm, customised");
  await s.applySupportPreset("Calm"); expect(s.presetState.get().snapshot).toEqual(saved);
  vi.resetModules(); s = await launch();
  await s.applySupportPreset("Restore");
  expect(s.presetFields(s.settings.get().timer)).toEqual(s.presetFields(original.timer));
  expect(s.settings.get().timer.lengths.pomodoro).toBe(51);
  expect(s.settings.get().timer.hardMode).toBe(true);
  await s.applySupportPreset("Strong"); s.settingsUpdate("timer", { speak: false });
  expect(s.supportPresetLabel()).toBe("Strong, customised");
  expect(s.settings.get().timer.hardMode).toBe(true);
});
it("V1: delayed hydration and remote legacy settings are never classified fresh or overwritten by the old read", async () => {
  let release!: () => void; fixture.gate = new Promise<void>(resolve => { release = resolve; });
  const s = await import("./settings");
  const { applyRemote } = await import("../lib/store");
  await applyRemote("settings", { timer: { lengths: { pomodoro: 43 }, notify: false, autoStart: true } });
  release(); await s.calmFoundationReady;
  expect(s.settings.get().timer).toMatchObject({ lengths: { pomodoro: 43 }, notify: false, autoRun: "always", takeover: true });
  expect(s.supportPresetLabel()).toBe("Your setup");
});
it("V1: a user edit during delayed hydration is preserved and prevents fresh initialization", async () => {
  let release!: () => void; fixture.gate = new Promise<void>(resolve => { release = resolve; });
  const s = await import("./settings"); s.settingsUpdate("timer", { speak: false }); release(); await s.calmFoundationReady;
  expect(s.settings.get().timer).toMatchObject({ speak: false, takeover: true });
});
it("R1: a failed settings read never writes Calm or permits a destructive preset snapshot", async () => {
  fixture.failRead = true; const s = await launch();
  expect(s.settings.get()).toEqual(s.DEFAULT_SETTINGS);
  await expect(s.applySupportPreset("Calm")).rejects.toThrow("current setup is kept");
  expect(fixture.writes.flat().some(([key]) => key === "settings")).toBe(false);
});
it("R2: snapshot failure leaves settings untouched", async () => {
  fixture.disk.set("settings", {}); const s = await launch(); fixture.failSnapshot = true;
  await expect(s.applySupportPreset("Calm")).rejects.toThrow();
  expect(s.settings.get()).toEqual({ ...s.DEFAULT_SETTINGS, appearance: { ...s.DEFAULT_SETTINGS.appearance, look: "classic" } });
  expect(s.presetState.get().snapshot).toBeNull();
});
it("V2: crash after durable snapshot but before applying Calm retains the first restore point", async () => {
  fixture.disk.set("settings", { timer: { autoRun: "cycle", ticking: "focus", focusDoneSound: "wood", notify: false } });
  let s = await launch(); const original = s.presetFields(s.settings.get().timer); fixture.failSettingsWrite = true;
  await expect(s.applySupportPreset("Calm")).rejects.toThrow();
  expect(s.presetFields(s.settings.get().timer)).toEqual(original);
  expect(fixture.disk.get("deviceCalmPreset")).toMatchObject({ snapshot: original });
  vi.resetModules(); fixture.failSettingsWrite = false; s = await launch();
  await s.applySupportPreset("Calm"); await s.applySupportPreset("Restore");
  expect(s.presetFields(s.settings.get().timer)).toEqual(original);
});
it("V2: remote edits and repeated Calm never replace the device restore point", async () => {
  fixture.disk.set("settings", { timer: { speak: false, focusDoneSound: "digital" } });
  const s = await launch(); await s.applySupportPreset("Calm"); const snapshot = s.presetState.get().snapshot;
  const { applyRemote } = await import("../lib/store");
  await applyRemote("settings", { timer: { takeover: true, ticking: "both" } });
  expect(s.supportPresetLabel()).toBe("Your setup");
  await s.applySupportPreset("Calm"); await s.applySupportPreset("Restore");
  expect(s.presetFields(s.settings.get().timer)).toEqual(snapshot);
  const { SYNC_KEYS } = await import("../lib/sync"); expect(SYNC_KEYS).not.toContain(s.presetState.key);
});

it("11: unrelated concurrent edits survive and do not abort Try Calm", async () => {
  fixture.disk.set("settings", {}); const s = await launch(); const store = await import("../lib/store");
  let release!: () => void; let started!: () => void;
  fixture.writeGate = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { started = resolve; }); fixture.writeStarted = started;
  const applying = s.applySupportPreset("Calm"); await writing;
  s.settingsUpdate("timer", { lengths: { ...s.settings.get().timer.lengths, pomodoro: 57 } });
  const flushing = store.flushAll(); release();
  await applying; await flushing;
  expect(s.settings.get().timer).toMatchObject(s.CALM_PATCH);
  expect(s.settings.get().timer.lengths.pomodoro).toBe(57);
  expect(fixture.disk.get("settings")).toMatchObject({ timer: { lengths: { pomodoro: 57 } } });
  await s.applySupportPreset("Calm"); expect(s.settings.get().timer).toMatchObject({ ...s.CALM_PATCH, lengths: { pomodoro: 57 } });
});

it("V2: restoring a snapshot made in fresh Calm also restores its Calm label", async () => {
  const s = await launch(); await s.applySupportPreset("Calm");
  expect(s.presetState.get().snapshot).toBeNull();
  await s.applySupportPreset("Strong"); await s.applySupportPreset("Restore");
  expect(s.supportPresetLabel()).toBe("Calm"); expect(s.settings.get().timer).toMatchObject(s.CALM_PATCH);
});


it("1: startup Calm is provisional until the first user settings edit, including across relaunch", async () => {
  let s = await launch(); expect(s.presetState.get().provisional).toBe(true);
  vi.resetModules(); s = await launch(); expect(s.presetState.get().provisional).toBe(true);
  s.settingsUpdate("clock", { seconds: true }); expect(s.presetState.get().provisional).toBe(false);
});
it("2: Strong preserves an existing custom setup before resetting reminders", async () => {
  fixture.disk.set("settings", { timer: { speak: false, alertSound: "wood", focusDoneSound: "wood" } });
  const s = await launch(); const original = s.presetFields(s.settings.get().timer);
  expect(s.supportPresetLabel()).toBe("Your setup");
  await s.applySupportPreset("Strong");
  expect(s.settings.get().timer).toMatchObject(s.STRONG_PATCH);
  expect(s.presetState.get().snapshot).toEqual(original);
  await s.applySupportPreset("Restore"); expect(s.presetFields(s.settings.get().timer)).toEqual(original);
  expect(s.supportPresetLabel()).toBe("Your setup");
});
it("3: already Calm skips the snapshot; successful Restore consumes it and a later switch takes a new one", async () => {
  const s = await launch(); await s.applySupportPreset("Calm"); expect(s.presetState.get().snapshot).toBeNull();
  await s.applySupportPreset("Strong"); await s.applySupportPreset("Restore");
  expect(s.presetState.get()).toMatchObject({ snapshot: null, snapshotMode: null });
  s.settingsUpdate("timer", { speak: true }); const custom = s.presetFields(s.settings.get().timer);
  await s.applySupportPreset("Calm"); expect(s.presetState.get().snapshot).toEqual(custom);
});
it("5: received settings rederive canonical Calm, Strong and Your setup without losing a restore point", async () => {
  const s = await launch(); await s.applySupportPreset("Strong"); const saved = s.presetState.get().snapshot;
  const { applyRemote, restoreStoreEntries } = await import("../lib/store");
  await applyRemote("settings", { timer: s.CALM_PATCH }); expect(s.supportPresetLabel()).toBe("Calm");
  await restoreStoreEntries([["settings", { timer: s.STRONG_PATCH }]]); expect(s.supportPresetLabel()).toBe("Strong");
  await applyRemote("settings", { timer: { ...s.STRONG_PATCH, speak: false } }); expect(s.supportPresetLabel()).toBe("Your setup");
  expect(s.presetState.get().snapshot).toEqual(saved); expect(s.presetState.get().provisional).toBe(false);
});
it.each(["mini", "pip"])("7: %s renderer never inventories or classifies the profile", async kind => {
  const win = { desktop: { mini: kind === "mini" }, documentPictureInPicture: {} as { window?: unknown } };
  if (kind === "pip") win.documentPictureInPicture.window = win;
  vi.stubGlobal("window", { ...win, addEventListener: vi.fn() });
  if (kind === "pip") window.documentPictureInPicture!.window = window;
  vi.stubGlobal("document", { addEventListener: vi.fn() });
  const s = await launch(); expect(s.settings.get()).toEqual(s.DEFAULT_SETTINGS);
  expect((await import("../lib/db")).dbKeys).not.toHaveBeenCalled();
  expect(s.presetState.get().classified).toBe(false);
  expect(fixture.writes.flat().some(([key]) => key === "settings" || key === "deviceCalmPreset")).toBe(false);
});
it("11: concurrent reminder changes abort Try Calm and preserve the latest fields", async () => {
  fixture.disk.set("settings", {}); const s = await launch();
  let release!: () => void; let started!: () => void;
  fixture.writeGate = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { started = resolve; }); fixture.writeStarted = started;
  const applying = s.applySupportPreset("Calm"); await writing;
  s.settingsUpdate("timer", { focusDoneSound: "wood" }); release();
  await expect(applying).rejects.toThrow("latest choices are kept");
  await (await import("../lib/store")).flushAll();
  expect(s.settings.get().timer.focusDoneSound).toBe("wood");
  expect(fixture.disk.get("settings")).toMatchObject({ timer: { focusDoneSound: "wood" } });
});
it("12: memory storage skips classification and leaves defaults", async () => {
  fixture.memory = true; const s = await launch();
  expect(s.settings.get()).toEqual(s.DEFAULT_SETTINGS); expect(s.presetState.get().classified).toBe(false);
  expect(fixture.writes.flat().some(([key]) => key === "settings" || key === "deviceCalmPreset")).toBe(false);
});

it("2: metadata from an earlier classification cannot label custom reminders canonical Strong", async () => {
  fixture.disk.set("settings", { timer: { speak: false } });
  const s = await launch();
  s.presetState.set(state => ({ ...state, mode: "Strong" }));
  expect(s.supportPresetLabel()).toBe("Your setup");
});
it("3: a failed Restore keeps its snapshot and label for retry", async () => {
  fixture.disk.set("settings", {}); const s = await launch(); await s.applySupportPreset("Calm");
  const saved = structuredClone(s.presetState.get()); fixture.failSettingsWrite = true;
  await expect(s.applySupportPreset("Restore")).rejects.toThrow();
  expect(s.presetState.get()).toEqual(saved); expect(s.supportPresetLabel()).toBe("Calm");
});
it("5: cross-tab settings rederive labels through the receive path", async () => {
  let receive!: (event: { data: unknown }) => void;
  vi.stubGlobal("BroadcastChannel", class { addEventListener(_event: string, callback: typeof receive) { receive = callback; } postMessage() {} });
  const s = await launch();
  receive({ data: { type: "write", entries: [["settings", { timer: s.STRONG_PATCH }]] } });
  expect(s.supportPresetLabel()).toBe("Strong"); expect(s.presetState.get().provisional).toBe(false);
  receive({ data: { type: "write", entries: [["settings", { timer: { speak: false } }]] } });
  expect(s.supportPresetLabel()).toBe("Your setup");
});

it("3/11: a concurrent reminder edit during Restore keeps the restore point durable", async () => {
  fixture.disk.set("settings", {}); const s = await launch(); await s.applySupportPreset("Calm");
  const snapshot = s.presetState.get().snapshot;
  let release!: () => void; let started!: () => void;
  fixture.writeGate = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { started = resolve; }); fixture.writeStarted = started;
  const restoring = s.applySupportPreset("Restore"); await writing;
  s.settingsUpdate("timer", { notify: true }); release();
  await expect(restoring).rejects.toThrow("latest choices are kept");
  await (await import("../lib/store")).flushAll();
  expect(s.presetState.get().snapshot).toEqual(snapshot);
  expect(fixture.disk.get("deviceCalmPreset")).toMatchObject({ snapshot });
  expect(fixture.disk.get("settings")).toMatchObject({ timer: { notify: true, speak: false } });
});
