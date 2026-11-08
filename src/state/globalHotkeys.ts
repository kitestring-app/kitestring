import { createStore } from "../lib/store";

/** Mac-only, opt-in shortcuts that work while another app is in front. Device-local, never synced. */
export const HOTKEY_ACTIONS = ["showApp", "toggle", "stop", "skip"] as const;
export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number];
export type GlobalHotkeys = Record<HotkeyAction, string | null>;
export type HotkeyState = "off" | "ok" | "invalid" | "reserved" | "duplicate" | "taken";
export type GlobalHotkeyStatus = Record<HotkeyAction, HotkeyState>;

export const HOTKEY_LABELS: Record<HotkeyAction, string> = {
  showApp: "Show Kitestring", toggle: "Start or pause", stop: "Stop", skip: "Skip",
};
export const DEFAULT_GLOBAL_HOTKEYS: GlobalHotkeys = { showApp: null, toggle: null, stop: null, skip: null };

const MODIFIERS = ["Control", "Alt", "Shift", "Command"] as const;
type Modifier = (typeof MODIFIERS)[number];
const NAMED_KEYS = new Set(["Space", "Up", "Down", "Left", "Right", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/", "`"]);
const isKey = (key: string) => /^[A-Z0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || NAMED_KEYS.has(key);
export const RESERVED_HOTKEYS = new Set(["Alt+Command+P", "Command+.", "Shift+Command+3", "Shift+Command+4", "Shift+Command+5", "Shift+Command+6"]);

/** Mirrors desktop/global-hotkeys.cjs: two modifiers (one of ⌃⌥⌘), or one with an F key. */
export function normalizeHotkey(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return null;
  const parts = value.split("+");
  const key = parts.pop()!;
  if (!isKey(key) || parts.length === 0) return null;
  const mods = new Set<Modifier>();
  for (const part of parts) {
    if (!(MODIFIERS as readonly string[]).includes(part) || mods.has(part as Modifier)) return null;
    mods.add(part as Modifier);
  }
  const strong = mods.has("Control") || mods.has("Alt") || mods.has("Command");
  if (!strong || (mods.size < 2 && !/^F\d+$/.test(key))) return null;
  return [...MODIFIERS.filter(mod => mods.has(mod)), key].join("+");
}

export function sanitizeHotkeys(value: unknown): GlobalHotkeys {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(HOTKEY_ACTIONS.map(action => [action, normalizeHotkey(raw[action])])) as GlobalHotkeys;
}
export const validHotkeys = (value: unknown) => !!value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).every(key => (HOTKEY_ACTIONS as readonly string[]).includes(key)) &&
  HOTKEY_ACTIONS.every(action => { const v = (value as Record<string, unknown>)[action]; return v === undefined || v === null || normalizeHotkey(v) === v; });

export const globalHotkeys = createStore<GlobalHotkeys>("globalHotkeys", DEFAULT_GLOBAL_HOTKEYS, sanitizeHotkeys);

const SYMBOLS: Record<string, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Command: "⌘", Space: "Space", Up: "↑", Down: "↓", Left: "←", Right: "→" };
/** "Control+Alt+K" → "⌃⌥K". */
export const formatHotkey = (accelerator: string) => accelerator.split("+").map(part => SYMBOLS[part] ?? part).join("");

const CODE_KEYS: Record<string, string> = {
  Space: "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Minus: "-", Equal: "=",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
};
type KeyInput = Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;
/**
 * Physical key → accelerator. Uses `code`, since ⌥ changes `key` on a Mac (⌥P is "π").
 * Returns "" while only modifiers are held, null for a key we can't use.
 */
export function hotkeyFromEvent(event: KeyInput): string | null {
  const { code } = event;
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else key = CODE_KEYS[code];
  if (!key) return /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(code) ? "" : null;
  const mods = [event.ctrlKey && "Control", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Command"].filter(Boolean);
  return normalizeHotkey([...mods, key].join("+"));
}

type RecordResult = { kind: "wait" } | { kind: "cancel" } | { kind: "hint"; hint: string } | { kind: "set"; accelerator: string };
/** What one keydown means while recording a shortcut for `action`. */
export function recordHotkey(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">, action: HotkeyAction, saved: GlobalHotkeys): RecordResult {
  if (event.code === "Escape" && !event.metaKey && !event.ctrlKey && !event.altKey) return { kind: "cancel" };
  const accelerator = hotkeyFromEvent(event);
  if (accelerator === "") return { kind: "wait" }; // still holding modifiers
  if (accelerator === null) return { kind: "hint", hint: "Use two modifier keys, such as ⌃⌥ or ⇧⌘, plus a letter, number or key. An F key needs only one." };
  if (RESERVED_HOTKEYS.has(accelerator)) return { kind: "hint", hint: `${formatHotkey(accelerator)} is already in use. Pick another.` };
  const other = HOTKEY_ACTIONS.find(other => other !== action && saved[other] === accelerator);
  if (other) return { kind: "hint", hint: `${formatHotkey(accelerator)} already runs ${HOTKEY_LABELS[other]}.` };
  return { kind: "set", accelerator };
}

type StatusListener = (status: GlobalHotkeyStatus | null) => void;
let lastStatus: GlobalHotkeyStatus | null = null;
const statusListeners = new Set<StatusListener>();
export const hotkeyStatus = {
  get: () => lastStatus,
  subscribe(fn: StatusListener) { statusListeners.add(fn); return () => { statusListeners.delete(fn); }; },
};
function setStatus(next: GlobalHotkeyStatus | null) { lastStatus = next; statusListeners.forEach(fn => fn(next)); }

/** Sends saved shortcuts to the Mac app now and on every change. No-op on the web. */
export async function connectGlobalHotkeys() {
  const bridge = typeof window === "undefined" ? undefined : window.desktop;
  if (!bridge?.setGlobalHotkeys || bridge.mini) return () => {};
  await globalHotkeys.ready;
  let previous = "";
  let serial = 0;
  const sync = () => {
    const value = globalHotkeys.get();
    const key = JSON.stringify(value);
    if (key === previous) return;
    previous = key;
    const id = ++serial;
    void bridge.setGlobalHotkeys!({ ...value }).then(status => { if (id === serial) setStatus(status); }, () => { if (id === serial) setStatus(null); });
  };
  const off = globalHotkeys.subscribe(sync);
  sync();
  return off;
}
