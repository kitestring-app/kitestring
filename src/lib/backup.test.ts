import { describe, expect, it } from "vitest";
import { BACKUP_FORMAT, parseBackup } from "./backup";
import { createStore, mergeDefaults } from "./store";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../state/settings";

const wrap = (data: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ format: BACKUP_FORMAT, version: 1, data, ...extra });
const task = { id: "a", title: "Write", done: false, createdAt: Date.UTC(2026, 9, 24) };

describe("backup validation", () => {
  it("accepts a well-formed backup", () => {
    const { data } = parseBackup(wrap({ tasks: [task], notes: "hi", focusPick: null }));
    expect(Object.keys(data).sort()).toEqual(["focusPick", "notes", "tasks"]);
  });
  it("rejects wrong format, version, or JSON", () => {
    expect(() => parseBackup("{")).toThrow(/JSON/);
    expect(() => parseBackup(JSON.stringify({ format: "x", version: 1, data: {} }))).toThrow(/Not a Kitestring/);
    expect(() => parseBackup(wrap({ notes: "a" }, { version: 99 }))).toThrow(/version/);
  });
  it("rejects malformed collections before anything is written", () => {
    expect(() => parseBackup(wrap({ stats: { chunks: null, tasksDone: [] } }))).toThrow(/stats/);
    expect(() => parseBackup(wrap({ tasks: [{ ...task, color: "url(https://x.invalid/p)" }] }))).toThrow(/colour/);
    expect(() => parseBackup(wrap({ tasks: [{ ...task, etaMin: 1e9 }] }))).toThrow(/estimate/);
    expect(() => parseBackup(wrap({ timer: null }))).toThrow(/timer/);
  });
});

describe("settings sanitizing", () => {
  it("clamps ranges and rejects unknown values and CSS injection", () => {
    // JSON.parse turns "__proto__" into an own key, exactly like an imported backup would
    const s = sanitizeSettings(JSON.parse(`{
      "timer": { "lengths": { "pomodoro": -5, "short": 9999 }, "mode": "evil", "alertVolume": 7 },
      "themes": { "focus": { "kind": "color", "id": "url(https://x.invalid/p)" } },
      "__proto__": { "polluted": true }
    }`));
    expect(s.timer.lengths.pomodoro).toBe(1);
    expect(s.timer.lengths.short).toBe(600);
    expect(s.timer.mode).toBe("pomodoro");
    expect(s.timer.alertVolume).toBe(1);
    expect(s.themes.focus).toEqual(DEFAULT_SETTINGS.themes.focus);
    expect((s as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("an object with a swapped prototype is rejected outright", () => {
    const weird = Object.create({ polluted: true });
    weird.timer = { mode: "5217" };
    expect(sanitizeSettings(weird).timer.mode).toBe("pomodoro");
  });
  it("mergeDefaults keeps defaults on type mismatch and drops unknown keys", () => {
    expect(mergeDefaults({ a: 1, b: { c: "x" } }, { a: "no", b: { c: "y", z: 1 }, extra: 2 })).toEqual({ a: 1, b: { c: "y" } });
  });
});

describe("store hydration", () => {
  it("replays edits made before the saved value loads", async () => {
    const s = createStore<string[]>("test-replay", []);
    s.set((v) => [...v, "early"]);
    await s.ready;
    expect(s.get()).toEqual(["early"]);
  });
});

describe("parking lot backups", () => {
  const thought = { id: "p", text: "Read later", at: Date.now(), segment: "focus", segId: "s", taskId: "t", status: "open" };
  it("restores parked items and accepts older backups without parked data", () => {
    expect(parseBackup(wrap({ parked: [thought] })).data.parked).toEqual([thought]);
    expect(parseBackup(wrap({ notes: "older" })).data.parked).toBeUndefined();
  });
  it("rejects malformed, untrimmed, oversized and duplicate parked items", () => {
    for (const patch of [{ text: "" }, { text: " untrimmed " }, { text: "x".repeat(501) }, { text: "a\nb" }, { at: -1 }, { status: "evil" }, { segment: "bad" }, { segId: 1 }]) {
      expect(() => parseBackup(wrap({ parked: [{ ...thought, ...patch }] }))).toThrow(/parked/);
    }
    expect(() => parseBackup(wrap({ parked: [thought, thought] }))).toThrow(/parked/);
    expect(() => parseBackup(wrap({ parked: Array.from({ length: 501 }, (_, i) => ({ ...thought, id: String(i) })) }))).toThrow(/parked/);
  });
});
