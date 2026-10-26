import { describe, expect, it, vi } from "vitest";
import { createAlertTypingGuard } from "./alertTypingGuard";

function setup() {
  let time = 0;
  const guard = createAlertTypingGuard(() => time);
  const key = (value = " ", metaKey = false) => ({ key: value, metaKey, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
  return { guard, key, advance: (ms: number) => { time += ms; } };
}

describe("alert typing guard", () => {
  it("leaves normal use and bursts without alerts unchanged", () => {
    const { guard, key, advance } = setup();
    for (const value of [" ", "r", "n", "Enter", "Escape", "Tab"]) {
      const event = key(value);
      expect(guard.keydown(event)).toBe(false);
      guard.keyup(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
      advance(100);
    }
    expect(guard.pending()).toBe(false);
  });
  it("blocks a burst crossing the alert boundary and waits for 1.5 seconds of quiet", () => {
    const { guard, key, advance } = setup();
    expect(guard.keydown(key("r"))).toBe(false);
    advance(100); guard.begin();
    for (let i = 0; i < 24; i++) {
      advance(100);
      const event = key([" ", "r", "n", "Enter"][i % 4]);
      expect(guard.keydown(event)).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    }
    advance(1499); expect(guard.pending()).toBe(true);
    advance(1); expect(guard.pending()).toBe(false);
    expect(guard.keydown(key())).toBe(false);
    advance(100); expect(guard.keydown(key("r"))).toBe(false);
  });
  it("restarts the quiet window for every key including modifiers and Cmd+.", () => {
    const { guard, key, advance } = setup();
    guard.begin(); advance(1499);
    expect(guard.keydown(key("Shift"))).toBe(true);
    advance(1499);
    const mute = key(".", true);
    expect(guard.keydown(mute)).toBe(false);
    expect(mute.preventDefault).not.toHaveBeenCalled();
    advance(1499); expect(guard.keydown(key("Enter"))).toBe(true);
    advance(1500); expect(guard.keydown(key("Enter"))).toBe(false);
  });
  it("handles the same event once across capture and shortcut handlers", () => {
    const { guard, key, advance } = setup();
    guard.begin(); const event = key();
    expect(guard.keydown(event)).toBe(true);
    advance(1000); expect(guard.keydown(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    advance(500); expect(guard.pending()).toBe(false);
  });
  it("blocks release activation even when a swallowed Space is held past the guard", () => {
    const { guard, key, advance } = setup();
    guard.begin(); guard.keydown(key()); advance(1600);
    const release = key(); guard.keyup(release);
    expect(release.preventDefault).toHaveBeenCalledOnce();
    const next = key(); guard.keyup(next);
    expect(next.preventDefault).not.toHaveBeenCalled();
  });
  it("blocks release of activation keys already held when the alert appears", () => {
    const { guard, key } = setup();
    guard.keydown(key()); guard.begin();
    const release = key(); guard.keyup(release);
    expect(release.preventDefault).toHaveBeenCalledOnce();
  });
  it.each([" ", "Enter"])("allows the first deliberate %j press after a lost blocked keyup", value => {
    const { guard, key, advance } = setup();
    guard.begin(); expect(guard.keydown(key(value))).toBe(true);
    // The blocked press was released in another app, so its keyup never arrived.
    advance(1500);
    const press = key(value), release = key(value);
    expect(guard.keydown(press)).toBe(false);
    guard.keyup(release);
    expect(press.preventDefault).not.toHaveBeenCalled();
    expect(release.preventDefault).not.toHaveBeenCalled();
    expect(release.stopImmediatePropagation).not.toHaveBeenCalled();
  });
  it("starts a new quiet window for each alert, independently of pointer actions", () => {
    const { guard, key, advance } = setup();
    guard.begin();
    const click = vi.fn(); click();
    expect(click).toHaveBeenCalledOnce();
    advance(1600); expect(guard.pending()).toBe(false);
    guard.begin(); expect(guard.keydown(key())).toBe(true);
  });
});
