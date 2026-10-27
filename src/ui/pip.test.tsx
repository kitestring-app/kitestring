import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roots = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn(), createRoot: vi.fn() }));
vi.mock("react-dom/client", () => ({ createRoot: roots.createRoot }));
vi.mock("../state/timer", () => ({ useTimerView: vi.fn(), timerActions: {} }));
const preferences = vi.hoisted(() => ({ floatingTimer: false }));
const look = vi.hoisted(() => {
  const subs = new Set<() => void>();
  return { value: "classic", reduceMotion: false, subs, set(v: string) { this.value = v; subs.forEach(fn => fn()); } };
});
vi.mock("../state/settings", () => ({
  localPreferencesReady: Promise.resolve(),
  localPreferences: { get: () => preferences },
  localPreferencesUpdate: (patch: object) => Object.assign(preferences, patch),
  settings: {
    get: () => ({ appearance: { look: look.value }, extras: { reduceMotion: look.reduceMotion } }),
    subscribe: (fn: () => void) => { look.subs.add(fn); return () => void look.subs.delete(fn); },
  },
}));
vi.mock("./MiniTimer", () => ({ MiniTimer: () => null }));
vi.mock("./icons", () => ({ Icon: {} }));

function floatingWindow() {
  return {
    focus: vi.fn(),
    document: {
      documentElement: { dataset: {} as { look?: string }, classList: { toggle: vi.fn() } },
      createElement: vi.fn((tagName: string) => ({ tagName, textContent: "" })),
      head: { appendChild: vi.fn() },
      body: { appendChild: vi.fn() },
    },
    addEventListener: vi.fn(),
  };
}

beforeEach(() => {
  vi.resetModules();
  preferences.floatingTimer = false;
  look.subs.clear(); look.reduceMotion = false;
  vi.clearAllMocks();
  roots.createRoot.mockReturnValue({ render: roots.render, unmount: roots.unmount });
  vi.stubGlobal("document", { styleSheets: [], documentElement: { dataset: {} } });
});

afterEach(() => vi.unstubAllGlobals());

describe("native floating timer", () => {
  it("opens and closes through the native bridge without requiring Document PiP", async () => {
    const floatTimer = vi.fn(async (open: boolean) => open);
    vi.stubGlobal("window", { desktop: { floatTimer } });
    const { openPip } = await import("./pip");

    await expect(openPip()).resolves.toBeNull();
    await expect(openPip()).resolves.toBeNull();

    expect(floatTimer.mock.calls).toEqual([[true], [false]]);
    expect(roots.createRoot).not.toHaveBeenCalled();
  });

  it("prefers the native bridge when Document PiP is also available", async () => {
    const floatTimer = vi.fn(async (open: boolean) => open);
    const requestWindow = vi.fn();
    const focus = vi.fn();
    vi.stubGlobal("window", {
      desktop: { floatTimer },
      documentPictureInPicture: { requestWindow, window: { focus } },
    });
    const { openPip } = await import("./pip");

    await expect(openPip()).resolves.toBeNull();

    expect(floatTimer).toHaveBeenCalledWith(true);
    expect(requestWindow).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it("uses the native result as the open state for the next invocation", async () => {
    const floatTimer = vi.fn(async (_open: boolean) => false);
    vi.stubGlobal("window", { desktop: { floatTimer } });
    const { openPip } = await import("./pip");

    await openPip();
    await openPip();

    expect(floatTimer.mock.calls).toEqual([[true], [true]]);
  });

  it("returns a native failure message without browser wording or web fallback", async () => {
    const floatTimer = vi.fn().mockRejectedValue(new Error("native window unavailable"));
    const requestWindow = vi.fn().mockResolvedValue(floatingWindow());
    vi.stubGlobal("window", {
      desktop: { floatTimer },
      documentPictureInPicture: { requestWindow, window: null },
    });
    const { openPip } = await import("./pip");

    const error = await openPip();

    expect(floatTimer).toHaveBeenCalledWith(true);
    expect(error).toEqual(expect.stringMatching(/floating timer/i));
    expect(error).not.toMatch(/browser|chrome|edge|document.?pip/i);
    expect(requestWindow).not.toHaveBeenCalled();
  });
});

describe("web Document PiP", () => {
  it.each(["classic", "glass", "sunrise"])("starts on the current look %s and uses its background variable", async id => {
    look.value = id;
    const floating = floatingWindow();
    vi.stubGlobal("window", { documentPictureInPicture: { requestWindow: vi.fn().mockResolvedValue(floating), window: null } });
    const { openPip } = await import("./pip");
    await expect(openPip()).resolves.toBeNull();
    expect(floating.document.documentElement.dataset.look).toBe(id);
    expect(floating.document.head.appendChild.mock.calls[0][0].textContent).toContain("background:var(--bg)");
  });

  it("opens and renders the timer, then unmounts it when the window closes", async () => {
    const floating = floatingWindow();
    const requestWindow = vi.fn().mockResolvedValue(floating);
    vi.stubGlobal("window", { documentPictureInPicture: { requestWindow, window: null } });
    const { openPip } = await import("./pip");

    await expect(openPip()).resolves.toBeNull();

    expect(requestWindow).toHaveBeenCalledWith({ width: 300, height: 220 });
    expect(roots.createRoot).toHaveBeenCalledWith(floating.document.body.appendChild.mock.calls[0][0]);
    expect(roots.render).toHaveBeenCalledOnce();
    expect(floating.addEventListener).toHaveBeenCalledWith("pagehide", expect.any(Function), { once: true });
    const onPageHide = floating.addEventListener.mock.calls[0][1] as () => void;
    onPageHide();
    expect(roots.unmount).toHaveBeenCalledOnce();
  });

  it("follows look changes while open and stops listening when it closes", async () => {
    look.value = "classic";
    const floating = floatingWindow();
    vi.stubGlobal("window", { documentPictureInPicture: { requestWindow: vi.fn().mockResolvedValue(floating), window: null } });
    const { openPip } = await import("./pip");
    await openPip();
    look.set("sketch");
    expect(floating.document.documentElement.dataset.look).toBe("sketch");
    (floating.addEventListener.mock.calls[0][1] as () => void)();
    expect(look.subs.size).toBe(0);
    look.set("glass");
    expect(floating.document.documentElement.dataset.look).toBe("sketch");
  });

  it("focuses an existing web floating window", async () => {
    const floating = floatingWindow();
    const requestWindow = vi.fn();
    vi.stubGlobal("window", { documentPictureInPicture: { requestWindow, window: floating } });
    const { openPip } = await import("./pip");

    await expect(openPip()).resolves.toBeNull();

    expect(floating.focus).toHaveBeenCalledOnce();
    expect(requestWindow).not.toHaveBeenCalled();
    expect(roots.createRoot).not.toHaveBeenCalled();
  });

  it("explains the supported browser requirement when Document PiP is missing", async () => {
    vi.stubGlobal("window", {});
    const { openPip } = await import("./pip");

    await expect(openPip()).resolves.toMatch(/Picture-in-Picture.*Chrome.*Edge/i);
    expect(roots.createRoot).not.toHaveBeenCalled();
  });

  it("handles a denied web request without mounting a timer", async () => {
    const requestWindow = vi.fn().mockRejectedValue(new Error("request denied"));
    vi.stubGlobal("window", { documentPictureInPicture: { requestWindow, window: null } });
    const { openPip } = await import("./pip");

    await expect(openPip()).resolves.toMatch(/browser.*floating timer/i);
    expect(roots.createRoot).not.toHaveBeenCalled();
  });
});

it("reopens after the mini closes itself", async () => {
  let stateChanged: (open: boolean) => void = () => {};
  const floatTimer = vi.fn(async (open: boolean) => open);
  vi.stubGlobal("window", { desktop: { floatTimer, onFloatTimer: (fn: typeof stateChanged) => { stateChanged = fn; } } });
  const { openPip } = await import("./pip");
  await openPip();
  stateChanged(false);
  await openPip();
  expect(floatTimer.mock.calls).toEqual([[true], [true]]);
});


it("toggles from the persisted preference after a tray or Settings change", async () => {
  const floatTimer = vi.fn(async (open: boolean) => open);
  vi.stubGlobal("window", { desktop: { floatTimer, setFloatingPreferences: vi.fn() } });
  const { openPip } = await import("./pip");
  preferences.floatingTimer = true;
  await openPip();
  expect(floatTimer).toHaveBeenLastCalledWith(false);
  expect(preferences.floatingTimer).toBe(false);
  await openPip();
  expect(floatTimer).toHaveBeenLastCalledWith(true);
  expect(preferences.floatingTimer).toBe(true);
});

it("mirrors app reduced motion into an open Document PiP root and cleans up", async () => {
  const floating = floatingWindow(); look.reduceMotion = true;
  vi.stubGlobal("window", { documentPictureInPicture: { requestWindow: vi.fn().mockResolvedValue(floating), window: null } });
  await (await import("./pip")).openPip();
  expect(floating.document.documentElement.classList.toggle).toHaveBeenLastCalledWith("reduce-motion", true);
  look.reduceMotion = false; look.set("glass");
  expect(floating.document.documentElement.classList.toggle).toHaveBeenLastCalledWith("reduce-motion", false);
  (floating.addEventListener.mock.calls[0][1] as () => void)();
  expect(look.subs.size).toBe(0);
});
