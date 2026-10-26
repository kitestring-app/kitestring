import { afterEach, expect, it, vi } from "vitest";
import { installFullscreenTransition } from "./fullscreenTransition";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function fixture({ setting = false, system = false } = {}) {
  vi.useFakeTimers();
  const classes = new Set(setting ? ["reduce-motion"] : []);
  const classList = {
    contains: (name: string) => classes.has(name),
    add: (...names: string[]) => names.forEach(name => classes.add(name)),
    remove: (...names: string[]) => names.forEach(name => classes.delete(name)),
    toggle: (name: string, on: boolean) => { if (on) classes.add(name); else classes.delete(name); },
  };
  const events = new EventTarget();
  vi.stubGlobal("document", { documentElement: { classList } });
  vi.stubGlobal("window", { innerWidth: 1000, innerHeight: 800, matchMedia: () => ({ matches: system }), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) });
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  const raf = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); };
  let phase!: (value: "start" | "end") => void;
  const off = vi.fn();
  const cleanup = installFullscreenTransition(callback => { phase = callback; return off; });
  return { classes, phase, raf, events, cleanup, off };
}

it("waits for two settled frames after end while the viewport changes", () => {
  const h = fixture();
  h.phase("start");
  expect(h.classes).toEqual(new Set(["fs-transition", "fs-content-out"]));
  h.phase("end"); h.raf();
  expect(h.classes.has("fs-content-out")).toBe(true);
  window.innerWidth = 1440; h.raf();
  expect(h.classes.has("fs-content-out")).toBe(true);
  h.raf(); h.raf();
  expect(h.classes).toEqual(new Set(["fs-content-in"]));
  vi.advanceTimersByTime(180);
  expect(h.classes.size).toBe(0);
  h.cleanup();
});

it("reveals a cancelled transition after end and two unchanged frames", () => {
  const h = fixture(); h.phase("start"); h.phase("end"); h.raf();
  expect(h.classes.has("fs-content-out")).toBe(true);
  h.raf();
  expect(h.classes).toEqual(new Set(["fs-content-in"]));
  window.innerWidth++; h.events.dispatchEvent(new Event("resize"));
  expect(h.classes.has("fs-content-out")).toBe(false);
  h.cleanup();
});

it.each(["no events", "cancelled", "stalled frames", "continuous resizing"])("restores by 700ms with %s", scenario => {
  const h = fixture(); h.phase("start");
  if (scenario === "cancelled") { h.phase("end"); h.raf(); h.raf(); }
  if (scenario === "stalled frames") h.phase("end");
  for (let i = 0; i < 7; i++) {
    if (scenario === "continuous resizing") {
      window.innerWidth++; h.events.dispatchEvent(new Event("resize")); h.raf();
    }
    vi.advanceTimersByTime(100);
  }
  expect(h.classes.has("fs-content-out")).toBe(false);
  expect(h.classes.has("fs-transition")).toBe(false);
  h.raf(); h.raf(); vi.advanceTimersByTime(180);
  expect(h.classes.size).toBe(0);
  h.cleanup();
});

it.each(["early end", "ceiling"])("never re-hides after %s until a new explicit start", route => {
  const h = fixture(); h.phase("start");
  if (route === "early end") { window.innerWidth = 1440; h.phase("end"); h.raf(); h.raf(); }
  else vi.advanceTimersByTime(700);
  for (const ms of [0, 100, 1000, 10000]) {
    vi.advanceTimersByTime(ms); window.innerWidth++;
    h.events.dispatchEvent(new Event("resize")); h.phase("end"); h.raf(); h.raf();
    expect(h.classes.has("fs-content-out")).toBe(false);
    expect(h.classes.has("fs-transition")).toBe(false);
  }
  h.phase("start"); expect(h.classes.has("fs-content-out")).toBe(true);
  h.cleanup();
});

it("a double toggle replaces pending frames and gives the new start its own ceiling", () => {
  const h = fixture(); h.phase("start"); h.phase("end"); h.raf();
  vi.advanceTimersByTime(600); h.phase("start"); h.raf(); h.raf();
  vi.advanceTimersByTime(100);
  expect(h.classes.has("fs-content-out")).toBe(true);
  vi.advanceTimersByTime(599);
  expect(h.classes.has("fs-content-out")).toBe(true);
  vi.advanceTimersByTime(1);
  expect(h.classes.has("fs-content-out")).toBe(false);
  h.cleanup();
});

it.each([{ setting: true }, { system: true }])("keeps content visible throughout reduced motion: %j", options => {
  const h = fixture(options); h.phase("start");
  expect(h.classes.has("fs-content-out")).toBe(false);
  vi.advanceTimersByTime(700);
  expect(h.classes.has("fs-transition")).toBe(false);
  h.phase("end"); h.raf(); h.raf();
  expect(h.classes.has("fs-content-in")).toBe(false);
  h.cleanup();
});

it("cleanup cancels pending frames and timers and unsubscribes", () => {
  const h = fixture(); h.phase("start"); h.phase("end"); h.raf(); h.cleanup();
  vi.runAllTimers(); h.raf(); h.raf();
  expect(h.classes.size).toBe(0);
  expect(h.off).toHaveBeenCalledOnce();
});
