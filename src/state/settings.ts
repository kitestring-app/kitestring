import { commitStoreEntries, createStore, flushAll, mergeDefaults, storeSource, storeRevision, storeReadFailed } from "../lib/store";
import { dbGet, dbKeys, storageMode } from "../lib/db";

export type TimerMode = "pomodoro" | "countdown" | "stopwatch" | "animedoro" | "5217";
export type TimerStyle = "default" | "flip" | "bar" | "gauge" | "dots" | "pie";
export type Size = "small" | "regular" | "huge";
export type DashMode = "home" | "focus" | "ambient";
export type SettingsTab = "themes" | "clock" | "timer" | "stats" | "quotes" | "extras" | "data" | "about";
export type FontId = "look" | "sans" | "rounded" | "mono" | "serif" | "heavy" | "digital";
export type TallyId = "dots" | "tomato" | "check" | "star" | "tree" | "tokyo" | "stem";

export interface ThemeRef {
  kind: "library" | "custom" | "color";
  id: string; // library id, custom upload id, or a CSS colour
}

export interface Settings {
  timer: {
    mode: TimerMode;
    lengths: { pomodoro: number; short: number; long: number; countdown: number }; // minutes
    longEvery: number; // focus sessions per round
    autoRun: "off" | "cycle" | "always";
    countdownRepeat: boolean; // restart completed countdowns without a break
    interruptionPrompt: boolean;
    hardMode: boolean;
    flipPalette: "midnight" | "porcelain" | "mulberry" | "lagoon" | "fern" | "slate" | "ember" | "sandstone";
    taskEta: boolean; // timer follows the current task's estimate
    style: TimerStyle;
    display: "remaining" | "elapsed" | "hidden";
    showNumbers: boolean;
    progressBar: boolean;
    alertSound: "signature" | "bell" | "chime" | "digital" | "wood" | "none";
    focusDoneSound: Settings["timer"]["alertSound"];
    breakOverSound: Settings["timer"]["alertSound"];
    ticking: "off" | "breaks" | "focus" | "both";
    tickStyle: "soft" | "wood" | "digital";
    tickVolume: number;
    alertVolume: number; // 0..1
    notify: boolean;
    takeover: boolean;
    speak: boolean;
    bringToFront: boolean;
    tally: TallyId;
  };
  clock: {
    format: "12" | "24";
    seconds: boolean;
    flip: boolean;
    size: Size;
    font: FontId;
    showStreak: boolean;
    greetings: boolean;
    dynamicGreetings: boolean;
  };
  themes: Record<DashMode, ThemeRef>;
  quotes: { category: string; randomCategory: boolean; inFocus: boolean; inHome: boolean };
  extras: {
    hideStats: boolean;
    displayName: string;
    disableAnimated: boolean;
    clearMode: boolean;
    preventSleep: boolean;
    defaultTab: SettingsTab | "recent";
    randomizer: "off" | "load" | "daily";
    reduceMotion: boolean;
  };
  sounds: { master: number };
  /** The whole look of the app, and an optional effect drawn over any wallpaper. */
  appearance: { look: LookId; fx: WallpaperFx; fxStrength: number; reminderGlass: "clear" | "frosted" };
  dash: DashMode;
  lastTab: SettingsTab;
}

export const LOOKS = ["classic", "glass", "sketch", "companion", "sunrise"] as const;
export type LookId = (typeof LOOKS)[number];
export const WALLPAPER_FX = ["none", "frost", "frosted-blur", "fog-window", "rain-glass", "grain", "vignette", "dim"] as const;
export type WallpaperFx = (typeof WALLPAPER_FX)[number];

export const DEFAULT_SETTINGS: Settings = {
  timer: {
    mode: "pomodoro",
    lengths: { pomodoro: 25, short: 5, long: 15, countdown: 60 },
    longEvery: 4,
    autoRun: "off",
    countdownRepeat: false,
    interruptionPrompt: true,
    hardMode: false,
    flipPalette: "midnight",
    taskEta: false,
    style: "default",
    display: "remaining",
    showNumbers: true,
    progressBar: false,
    alertSound: "signature",
    focusDoneSound: "signature",
    breakOverSound: "signature",
    ticking: "off",
    tickStyle: "soft",
    tickVolume: 0.25,
    alertVolume: 0.85,
    notify: true,
    takeover: true,
    speak: true,
    bringToFront: true,
    tally: "dots",
  },
  clock: { showStreak: false, format: "12", seconds: false, flip: false, size: "regular", font: "look", greetings: true, dynamicGreetings: true },
  themes: {
    home: { kind: "library", id: "dusk-glass" },
    focus: { kind: "library", id: "dusk-glass" },
    ambient: { kind: "library", id: "aurora" },
  },
  quotes: { randomCategory: false, category: "all", inFocus: true, inHome: true },
  extras: {
    hideStats: false,
    displayName: "",
    disableAnimated: false,
    clearMode: false,
    preventSleep: false,
    defaultTab: "recent",
    randomizer: "off",
    reduceMotion: false,
  },
  sounds: { master: 0.7 },
  appearance: { look: "glass", fx: "none", fxStrength: 0.5, reminderGlass: "frosted" },
  dash: "focus",
  lastTab: "timer",
};

const oneOf = <T extends string>(v: string, allowed: readonly T[], fallback: T): T => ((allowed as readonly string[]).includes(v) ? (v as T) : fallback);
const clamp = (v: number, lo: number, hi: number, fallback: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 1000) / 1000)) : fallback);
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const SAFE_ID = /^[a-z0-9-]{1,64}$/i;

function sanitizeTheme(r: ThemeRef, fallback: ThemeRef): ThemeRef {
  if (r.kind === "color") return HEX.test(r.id) ? r : fallback;
  if (r.kind === "library" || r.kind === "custom") return SAFE_ID.test(r.id) ? r : fallback;
  return fallback;
}

/** Shape (via mergeDefaults), ranges and allowed values. Runs on every load and on imported backups. */
export function sanitizeSettings(stored: unknown): Settings {
  // Read the legacy flag before mergeDefaults drops keys outside the current schema.
  const legacy = mergeDefaults({ timer: { autoStart: false, autoRun: "" } }, stored).timer;
  const s = mergeDefaults(DEFAULT_SETTINGS, stored);
  const d = DEFAULT_SETTINGS;
  const t = s.timer;
  const rawTimer = (stored as { timer?: Partial<Settings["timer"]> } | null)?.timer;
  const sounds = ["signature", "bell", "chime", "digital", "wood", "none"] as const;
  const oldSound = oneOf(t.alertSound, sounds, d.timer.alertSound);
  const hasAppearance = !!(stored as { appearance?: unknown } | null)?.appearance;
  return {
    ...s,
    timer: {
      ...t,
      autoRun: oneOf(legacy.autoRun, ["off", "cycle", "always"] as const, legacy.autoStart ? "always" : "off"),
      countdownRepeat: typeof t.countdownRepeat === "boolean" ? t.countdownRepeat : false,
      interruptionPrompt: typeof t.interruptionPrompt === "boolean" ? t.interruptionPrompt : true,
      flipPalette: oneOf(t.flipPalette, ["midnight", "porcelain", "mulberry", "lagoon", "fern", "slate", "ember", "sandstone"] as const, "midnight"),
      mode: oneOf(t.mode, ["pomodoro", "countdown", "stopwatch", "animedoro", "5217"] as const, d.timer.mode),
      lengths: {
        ...t.lengths,
        pomodoro: clamp(t.lengths.pomodoro, 1, 600, d.timer.lengths.pomodoro),
        short: clamp(t.lengths.short, 1, 600, d.timer.lengths.short),
        long: clamp(t.lengths.long, 1, 600, d.timer.lengths.long),
        countdown: clamp(t.lengths.countdown, 1, 600, d.timer.lengths.countdown),
      },
      longEvery: clamp(t.longEvery, 1, 12, d.timer.longEvery),
      display: oneOf(t.display, ["remaining", "elapsed", "hidden"] as const, "remaining"),
      style: oneOf(t.style, ["default", "flip", "bar", "gauge", "dots", "pie"] as const, d.timer.style),
      alertSound: oneOf(t.alertSound, ["signature", "bell", "chime", "digital", "wood", "none"] as const, d.timer.alertSound),
      focusDoneSound: oneOf(rawTimer?.focusDoneSound ?? oldSound, sounds, oldSound),
      breakOverSound: oneOf(rawTimer?.breakOverSound ?? oldSound, sounds, oldSound),
      ticking: oneOf(t.ticking, ["off", "breaks", "focus", "both"] as const, "off"),
      tickStyle: oneOf(t.tickStyle, ["soft", "wood", "digital"] as const, "soft"),
      tickVolume: clamp(t.tickVolume, 0, 1, d.timer.tickVolume),
      alertVolume: clamp(t.alertVolume, 0, 1, d.timer.alertVolume),
      takeover: typeof t.takeover === "boolean" ? t.takeover : d.timer.takeover,
      speak: typeof t.speak === "boolean" ? t.speak : d.timer.speak,
      bringToFront: typeof t.bringToFront === "boolean" ? t.bringToFront : d.timer.bringToFront,
      tally: oneOf(t.tally, ["dots", "tomato", "check", "star", "tree", "tokyo", "stem"] as const, d.timer.tally),
    },
    clock: {
      ...s.clock,
      showStreak: typeof s.clock.showStreak === "boolean" ? s.clock.showStreak : false,
      format: oneOf(s.clock.format, ["12", "24"] as const, d.clock.format),
      size: oneOf(s.clock.size, ["small", "regular", "huge"] as const, d.clock.size),
      font: oneOf(s.clock.font, ["look", "sans", "rounded", "mono", "serif", "heavy", "digital"] as const, d.clock.font),
    },
    themes: {
      ...s.themes,
      home: sanitizeTheme(s.themes.home, d.themes.home),
      focus: sanitizeTheme(s.themes.focus, d.themes.focus),
      ambient: sanitizeTheme(s.themes.ambient, d.themes.ambient),
    },
    quotes: { ...s.quotes, randomCategory: typeof s.quotes.randomCategory === "boolean" ? s.quotes.randomCategory : false, category: SAFE_ID.test(s.quotes.category) ? s.quotes.category : "all" },
    extras: {
      ...s.extras,
      displayName: s.extras.displayName.slice(0, 40),
      defaultTab: oneOf(s.extras.defaultTab, ["recent", "themes", "clock", "timer", "stats", "quotes", "extras", "data", "about"] as const, "recent"),
      randomizer: oneOf(s.extras.randomizer, ["off", "load", "daily"] as const, "off"),
    },
    sounds: { ...s.sounds, master: clamp(s.sounds.master, 0, 1, d.sounds.master) },
    appearance: {
      ...s.appearance,
      // Fresh installs get Glass. A saved setup from before looks existed keeps the Classic look.
      look: hasAppearance ? oneOf(s.appearance.look, LOOKS, d.appearance.look) : stored && typeof stored === "object" ? "classic" : d.appearance.look,
      fx: oneOf(s.appearance.fx, WALLPAPER_FX, "none"),
      fxStrength: clamp(s.appearance.fxStrength, 0, 1, d.appearance.fxStrength),
      reminderGlass: oneOf(s.appearance.reminderGlass, ["clear", "frosted"] as const, "frosted"),
    },
    dash: oneOf(s.dash, ["home", "focus", "ambient"] as const, d.dash),
    lastTab: oneOf(s.lastTab, ["themes", "clock", "timer", "stats", "quotes", "extras", "data", "about"] as const, d.lastTab),
  };
}

let interruptionPreferenceKnown = false;
export const settings = createStore<Settings>("settings", DEFAULT_SETTINGS, stored => {
  const timer = (stored as { timer?: { interruptionPrompt?: unknown } } | null)?.timer;
  interruptionPreferenceKnown ||= typeof timer?.interruptionPrompt === "boolean";
  return sanitizeSettings(stored);
});

/** The unreleased notes object carried this flag. An explicit setting always wins. */
export async function migrateInterruptionPreference(enabled: boolean | undefined) {
  if (enabled === undefined) return;
  await settings.ready;
  if (interruptionPreferenceKnown) return;
  settingsUpdate("timer", { interruptionPrompt: enabled });
}

// Deep-ish updater: settingsUpdate("timer", { mode: "5217" })
export function settingsUpdate<K extends keyof Settings>(key: K, patch: Partial<Settings[K]> | Settings[K]) {
  if (key === "timer" && typeof (patch as Partial<Settings["timer"]>).interruptionPrompt === "boolean") interruptionPreferenceKnown = true;
  settings.set((s) => ({
    ...s,
    [key]: typeof patch === "object" && patch !== null && !Array.isArray(patch) ? { ...(s[key] as object), ...patch } : patch,
  }));
}

/** Device preferences never enter SYNC_KEYS or received settings; backups include them only in the device section. */
export const DEFAULT_LOCAL_PREFERENCES = {
  floatingTimer: false, floatingOnTop: true, menuBarTime: true, showMenuBar: true,
  muted: false, migrated: false,
};
export const localPreferences = createStore("devicePreferences", DEFAULT_LOCAL_PREFERENCES);
/** How see-through the floating timer's glass is on this device (0 clear, 1 solid). Never synced. */
export const floatingGlass = createStore("floatingGlass", { opacity: 0.12 }, (stored) => {
  const v = Number((stored as { opacity?: unknown } | null)?.opacity);
  return { opacity: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.12 };
});
type LocalPreference = Exclude<keyof typeof DEFAULT_LOCAL_PREFERENCES, "migrated">;
const locallyChanged = new Set<LocalPreference>();
export function localPreferencesUpdate(patch: Partial<Record<LocalPreference, boolean>>) {
  for (const key of Object.keys(patch) as LocalPreference[]) locallyChanged.add(key);
  localPreferences.set(s => ({ ...s, ...patch }));
}
// Read the original local disk value once, before cloud sync can receive settings.
const legacyLocalSettings = dbGet<{ extras?: Partial<FloatingPreferences> }>("settings").catch(() => undefined);
export const localPreferencesReady = Promise.all([localPreferences.ready, settings.ready, legacyLocalSettings]).then(async ([, , legacy]) => {
  if (localPreferences.get().migrated) return;
  const extras = legacy?.extras;
  localPreferences.set(current => {
    const next = { ...current, migrated: true };
    for (const key of ["floatingTimer", "floatingOnTop", "menuBarTime", "showMenuBar"] as const) {
      if (!locallyChanged.has(key) && typeof extras?.[key] === "boolean") next[key] = extras[key];
    }
    return next;
  });
  // Persist the schema without legacy keys. Subsequent receives only sanitize.
  if (extras && ["floatingTimer", "floatingOnTop", "menuBarTime", "showMenuBar"].some(key => key in extras)) settings.set(s => sanitizeSettings(s));
  await flushAll(); // Commit migration before opening a second renderer or receiving cloud data.
});


// Presets, restore points and classification are device-local, like devicePreferences.
export const CALM_PATCH = {
  takeover: false, speak: false, bringToFront: false, notify: false,
  interruptionPrompt: false, alertSound: "none", focusDoneSound: "none",
  breakOverSound: "none", ticking: "off", autoRun: "off", countdownRepeat: false,
} as const satisfies Partial<Settings["timer"]>;
export type PresetFields = Pick<Settings["timer"], keyof typeof CALM_PATCH>;
export function presetFields(timer: Settings["timer"]): PresetFields {
  return Object.fromEntries(Object.keys(CALM_PATCH).map(key => [key, timer[key as keyof PresetFields]])) as PresetFields;
}
export const STRONG_PATCH = presetFields(DEFAULT_SETTINGS.timer);
export const quietTimer = (t: Settings["timer"]) => !t.takeover && !t.speak && !t.bringToFront && !t.notify &&
  !t.interruptionPrompt && t.focusDoneSound === "none" && t.breakOverSound === "none" && t.ticking === "off";
interface PresetState {
  mode: "Calm" | "Strong" | "Your setup";
  baseline: PresetFields | null;
  snapshot: PresetFields | null;
  snapshotMode: PresetState["mode"] | null;
  classified: boolean;
  provisional: boolean;
}
// Nullable fields need a validator, rather than schema merging against null.
const validPresetFields = (v: unknown): v is PresetFields => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const raw = v as Record<string, unknown>;
  const parsed = presetFields(sanitizeSettings({ timer: raw }).timer);
  return Object.keys(CALM_PATCH).every(key => raw[key] === parsed[key as keyof PresetFields]);
};
const samePreset = (a: PresetFields, b: PresetFields) => Object.keys(CALM_PATCH).every(key => a[key as keyof PresetFields] === b[key as keyof PresetFields]);
const modeFor = (fields: PresetFields): PresetState["mode"] => samePreset(fields, CALM_PATCH) ? "Calm" : samePreset(fields, STRONG_PATCH) ? "Strong" : "Your setup";
export const presetState = createStore<PresetState>("deviceCalmPreset", { mode: "Your setup", baseline: null, snapshot: null, snapshotMode: null, classified: false, provisional: false }, value => {
  const raw = value as Partial<PresetState> | null;
  return { mode: raw?.mode === "Calm" ? "Calm" : raw?.mode === "Strong" ? "Strong" : "Your setup", classified: raw?.classified === true, provisional: raw?.provisional === true,
    baseline: validPresetFields(raw?.baseline) ? raw.baseline : null,
    snapshot: validPresetFields(raw?.snapshot) ? raw.snapshot : null,
    snapshotMode: raw?.snapshotMode === "Calm" || raw?.snapshotMode === "Strong" || raw?.snapshotMode === "Your setup" ? raw.snapshotMode : null };
});
function deriveReceivedPreset() {
  const baseline = presetFields(settings.get().timer);
  presetState.set(state => ({ ...state, mode: modeFor(baseline), baseline, provisional: false }));
}
// PiP shares the dashboard's module realm. Native auxiliary renderers must never classify.
const mainRenderer = typeof window === "undefined" || (!window.desktop?.mini && window.documentPictureInPicture?.window !== window);
settings.subscribe(() => {
  if (!mainRenderer) return;
  if (storeSource("settings") === "received") deriveReceivedPreset();
  else if (storeSource("settings") === "edited" && presetState.get().provisional) presetState.set(state => ({ ...state, provisional: false }));
});
// Start the inventory read before lazy stores or migrations can create any keys.
const profileKeys = mainRenderer ? (async () => { try { return await dbKeys(); } catch { return undefined; } })() : Promise.resolve(undefined);
export const calmFoundationReady = Promise.all([settings.ready, presetState.ready, profileKeys]).then(async ([, , keys]) => {
  if (!mainRenderer) return;
  if (storeSource("settings") === "received") deriveReceivedPreset();
  if (presetState.get().classified) return;
  const source = storeSource("settings");
  if (!keys || storageMode() !== "indexeddb" || storeReadFailed("settings") || storeReadFailed(presetState.key)) return;
  const fresh = source === "missing" && keys.length === 0;
  const revision = storeRevision("settings");
  const committed = await commitStoreEntries(() => {
    if (storeRevision("settings") !== revision) return [];
    const current = settings.get();
    const baseline = fresh ? { ...CALM_PATCH } : presetFields(current.timer);
    const state: PresetState = { ...presetState.get(), mode: modeFor(baseline), baseline, classified: true, provisional: fresh };
    return fresh ? [["settings", { ...current, timer: { ...current.timer, ...CALM_PATCH } }], [presetState.key, state]] : [[presetState.key, state]];
  });
  if (!committed || !presetState.get().classified) await commitStoreEntries(() => {
    const baseline = presetFields(settings.get().timer);
    return [[presetState.key, { ...presetState.get(), mode: modeFor(baseline), baseline, classified: true, provisional: false }]];
  });
}).catch(() => undefined); // Uncertain storage never authorizes a Calm write.
let presetQueue: Promise<unknown> = Promise.resolve();
export function applySupportPreset(mode: "Calm" | "Strong" | "Restore"): Promise<void> {
  const change = presetQueue.catch(() => undefined).then(async () => {
    await calmFoundationReady;
    if (storageMode() !== "indexeddb" || storeReadFailed("settings") || storeReadFailed(presetState.key)) throw new Error("Could not save a restore point. Your current setup is kept. Check storage and try again.");
    const before = presetFields(settings.get().timer);
    const target = mode === "Restore" ? presetState.get().snapshot : mode === "Calm" ? CALM_PATCH : STRONG_PATCH;
    if (!target) throw new Error("There is no saved setup to restore on this device.");
    if (mode !== "Restore" && !samePreset(before, target) && !presetState.get().snapshot) {
      const saved = await commitStoreEntries([[presetState.key, { ...presetState.get(), snapshot: before, snapshotMode: presetState.get().mode }]]);
      if (!saved || !presetState.get().snapshot) throw new Error("Restore choices changed while saving. Your current setup is kept. Try again.");
    }
    // Unrelated writes can land during either transaction. Rebase on their latest fields.
    // A change to any reminder field wins and aborts the preset operation.
    for (;;) {
      if (!samePreset(presetFields(settings.get().timer), before)) throw new Error("Reminder choices changed while saving. Your latest choices are kept. Try again.");
      const committed = await commitStoreEntries(() => {
        if (!samePreset(presetFields(settings.get().timer), before)) return [];
        const state = presetState.get();
        return [["settings", { ...settings.get(), timer: { ...settings.get().timer, ...target } }],
          [presetState.key, { ...state, mode: mode === "Restore" ? state.snapshotMode ?? modeFor(target) : mode, baseline: target, classified: true, provisional: false,
            ...(mode === "Restore" ? { snapshot: null, snapshotMode: null } : {}) }]];
      });
      if (committed && samePreset(presetFields(settings.get().timer), target)) break;
    }
  });
  presetQueue = change;
  return change;
}
export function supportPresetLabel() {
  const { mode, baseline } = presetState.get();
  const current = presetFields(settings.get().timer);
  const canonical = modeFor(current);
  if (canonical !== "Your setup") return canonical;
  if (baseline && ((mode === "Calm" && samePreset(baseline, CALM_PATCH)) || (mode === "Strong" && samePreset(baseline, STRONG_PATCH)))) return `${mode}, customised`;
  return "Your setup";
}
