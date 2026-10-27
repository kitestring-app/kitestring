import { afterEach, describe, expect, it, vi } from "vitest";
import { installTooltips, tooltipPosition } from "./tooltips";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../App";
import { DEFAULT_SETTINGS, settings } from "../state/settings";
import { tasks } from "../state/tasks";
import { TasksPanel } from "./panels/TasksPanel";
import { NotepadPanel } from "./panels/NotepadPanel";
import { SoundsPanel } from "./panels/SoundsPanel";
import { SettingsDrawer } from "./settings/SettingsDrawer";
import { StatsTab } from "./settings/StatsTab";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
}));
vi.mock("react-dom", async (original) => ({ ...await original<typeof import("react-dom")>(), createPortal: () => null }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** A small DOM boundary double: production event/observer/timer code still runs. */
export function tooltipFixture(labels: string[] = ["Start · Space"]) {
  let mutation: MutationCallback = () => {};
  class Events {
    listeners = new Map<string, Set<(event: Event) => void>>();
    addEventListener(type: string, listener: (event: Event) => void) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(listener);
    }
    removeEventListener(type: string, listener: (event: Event) => void) { this.listeners.get(type)?.delete(listener); }
    dispatchEvent(event: Event) { this.listeners.get(event.type)?.forEach(listener => listener(event)); }
  }
  const win = Object.assign(new Events(), { innerWidth: 320, innerHeight: 240 });
  const doc = Object.assign(new Events(), { defaultView: win, activeElement: null as ElementDouble | null });
  class ElementDouble {
    attributes = new Map<string, string>();
    dataset: { tip?: string } = {};
    style: Record<string, string> = {};
    hidden = false; hiddenAncestor = false; isConnected = true; focusVisible = true; open = false;
    className = ""; textContent = ""; tagName = "BUTTON"; offsetWidth = 100; offsetHeight = 32;
    children: ElementDouble[] = [];
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    removeAttribute(name: string) { this.attributes.delete(name); if (name === "data-tip") delete this.dataset.tip; }
    hasAttribute(name: string) { return this.attributes.has(name); }
    matches(selector: string): boolean {
      if (selector === ":popover-open") return this.open;
      if (selector === ":focus-visible") return this.focusVisible;
      return ["BUTTON", "A"].includes(this.tagName) && (!selector.includes("[aria-label]") || this.hasAttribute("aria-label"));
    }
    closest(selector: string) { return selector.includes("[hidden]") ? (this.hiddenAncestor ? this : null) : this.matches(selector) ? this : null; }
    contains(node: unknown) { return this === node || this.children.includes(node as ElementDouble); }
    getClientRects() { return this.isConnected ? [this.getBoundingClientRect()] : []; }
    getBoundingClientRect() { return { left: 100, right: 144, top: 100, bottom: 144 }; }
    querySelectorAll() { return this.children.filter(child => child.hasAttribute("aria-label")); }
    append(child: ElementDouble) { this.children.push(child); }
    showPopover() { this.open = true; }
    hidePopover() { this.open = false; }
    remove() { this.isConnected = false; }
  }
  class HtmlDouble extends ElementDouble {}
  const body = new HtmlDouble();
  const controls = labels.map(label => { const b = new HtmlDouble(); b.setAttribute("aria-label", label); b.setAttribute("title", "Native title"); return b; });
  Object.assign(win, { Element: ElementDouble, HTMLElement: HtmlDouble, Node: ElementDouble });
  Object.assign(doc, { body, querySelectorAll: () => controls.filter(b => b.hasAttribute("aria-label")), createElement: () => new HtmlDouble() });
  const disconnect = vi.fn();
  vi.stubGlobal("MutationObserver", class { constructor(callback: MutationCallback) { mutation = callback; } observe() {} disconnect = disconnect; });
  const emit = (type: string, target = controls[0], values: object = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, "target", { value: target });
    Object.assign(event, values);
    (type === "keydown" || type === "blur" || type === "resize" ? win : doc).dispatchEvent(event);
    return event;
  };
  const stop = installTooltips(doc as unknown as Document);
  const change = (target: ElementDouble, attributeName = "aria-label") => mutation([{ type: "attributes", target, attributeName } as unknown as MutationRecord], {} as MutationObserver);
  const svg = new ElementDouble(); svg.tagName = "SVG"; svg.closest = () => controls[0];
  controls[0]?.children.push(svg);
  return { controls, tip: body.children[0], emit, stop, disconnect, doc, change, ElementDouble: HtmlDouble, svg,
    add(control: ElementDouble) { controls.push(control); mutation([{ type: "childList", addedNodes: [control] } as unknown as MutationRecord], {} as MutationObserver); },
  };
}

describe("tooltip placement", () => {
  const viewport = { width: 320, height: 240 };
  it("flips below a control at the top and above one at the bottom", () => {
    expect(tooltipPosition({ left: 100, right: 144, top: 4, bottom: 48 }, 100, 32, viewport)).toEqual({ left: 72, top: 56 });
    expect(tooltipPosition({ left: 100, right: 144, top: 192, bottom: 236 }, 100, 32, viewport)).toEqual({ left: 72, top: 152 });
  });
  it("clamps both horizontal edges and long, tall tooltips", () => {
    expect(tooltipPosition({ left: 0, right: 44, top: 50, bottom: 94 }, 180, 32, viewport).left).toBe(8);
    expect(tooltipPosition({ left: 280, right: 324, top: 50, bottom: 94 }, 180, 32, viewport).left).toBe(132);
    expect(tooltipPosition({ left: 0, right: 44, top: 10, bottom: 54 }, 304, 224, viewport)).toEqual({ left: 8, top: 8 });
  });
});

describe("shared tooltip controller", () => {
  it("uses the accessible name, removes native titles and waits 300ms for hover", () => {
    vi.useFakeTimers();
    const f = tooltipFixture();
    expect(f.controls[0].dataset.tip).toBe("Start · Space");
    expect(f.controls[0].hasAttribute("title")).toBe(false);
    f.emit("pointerover");
    vi.advanceTimersByTime(299); expect(f.tip.hidden).toBe(true);
    vi.advanceTimersByTime(1); expect(f.tip.hidden).toBe(false);
    expect(f.tip.textContent).toBe("Start · Space");
    f.stop();
  });
  it("finds the parent control when the pointer enters an SVG icon", () => {
    vi.useFakeTimers();
    const f = tooltipFixture();
    f.emit("pointerover", f.svg); vi.advanceTimersByTime(300);
    expect(f.tip.hidden).toBe(false); expect(f.tip.textContent).toBe("Start · Space");
    f.emit("pointerout", f.svg); expect(f.tip.hidden).toBe(true);
    f.stop();
  });
  it("shows focus-visible immediately, including during the hover delay, and hides on blur", () => {
    vi.useFakeTimers();
    const f = tooltipFixture();
    f.emit("pointerover"); f.emit("focusin");
    expect(f.tip.hidden).toBe(false);
    f.emit("focusout"); expect(f.tip.hidden).toBe(true);
    vi.advanceTimersByTime(400); expect(f.tip.hidden).toBe(true);
    f.controls[0].focusVisible = false;
    f.emit("focusin"); expect(f.tip.hidden).toBe(true);
    f.stop();
  });
  it("Escape dismisses visible or pending tips before panel handlers, without reopening", () => {
    vi.useFakeTimers();
    const f = tooltipFixture();
    f.emit("pointerover");
    expect(f.emit("keydown", f.controls[0], { key: "Escape" }).defaultPrevented).toBe(true);
    vi.advanceTimersByTime(400); expect(f.tip.hidden).toBe(true);
    f.emit("focusin"); expect(f.tip.hidden).toBe(false);
    f.emit("keydown", f.controls[0], { key: "Escape" }); expect(f.tip.hidden).toBe(true);
    f.stop();
  });
  it("updates dynamic labels and new controls, and clears stale names", () => {
    const f = tooltipFixture();
    f.emit("focusin");
    f.controls[0].setAttribute("aria-label", "Pause · Space"); f.change(f.controls[0]);
    expect(f.tip.textContent).toBe("Pause · Space");
    expect(f.controls[0].dataset.tip).toBe("Pause · Space");
    const next = new f.ElementDouble(); next.setAttribute("aria-label", "Next radio station");
    f.add(next); expect(next.dataset.tip).toBe("Next radio station");
    f.controls[0].removeAttribute("aria-label"); f.change(f.controls[0]);
    expect(f.controls[0].dataset.tip).toBeUndefined(); expect(f.tip.hidden).toBe(true);
    f.stop();
  });
  it("hides on scroll, resize, window blur, pointerdown and hidden/removed controls; cleans up", () => {
    const f = tooltipFixture();
    for (const event of ["scroll", "resize", "blur", "pointerdown", "pointerout"]) {
      f.emit("focusin"); expect(f.tip.hidden).toBe(false);
      f.emit(event); expect(f.tip.hidden).toBe(true);
    }
    f.emit("focusin"); f.controls[0].hiddenAncestor = true; f.change(f.controls[0], "inert");
    expect(f.tip.hidden).toBe(true);
    f.controls[0].hiddenAncestor = false; f.emit("focusin");
    f.controls[0].isConnected = false; f.change(f.controls[0]); expect(f.tip.hidden).toBe(true);
    f.stop(); expect(f.disconnect).toHaveBeenCalledOnce(); expect(f.tip.isConnected).toBe(false);
    f.controls[0].isConnected = true; f.emit("focusin"); expect(f.tip.hidden).toBe(true);
  });
});

it("gives every textless button in the rendered dashboard and panels an accessible name and matching tooltip", async () => {
  vi.stubGlobal("document", { body: {} }); // createPortal is suppressed during static rendering
  await Promise.all([settings.ready, tasks.ready]);
  const previous = settings.get(), previousTasks = tasks.get();
  try {
    tasks.set([{ id: "tooltip-task", title: "Review chapter", done: false, createdAt: 0 }]);
    let checked = 0;
    for (const look of ["classic", "glass", "sketch", "companion", "sunrise"] as const) for (const hideStats of [false, true]) for (const dash of ["home", "focus", "ambient"] as const) {
      settings.set({ ...DEFAULT_SETTINGS, dash, appearance: { ...DEFAULT_SETTINGS.appearance, look }, extras: { ...DEFAULT_SETTINGS.extras, hideStats } });
      const views = [createElement(App), createElement(TasksPanel, { onClose() {} }), createElement(NotepadPanel, { onClose() {} }), createElement(SoundsPanel, { open: true, onClose() {} }), createElement(SettingsDrawer, { onClose() {} }), createElement(StatsTab)];
      for (const view of views) {
        const html = renderToStaticMarkup(view);
        const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].filter(match => !match[2].replace(/<[^>]*>/g, "").trim());
        const labels = buttons.map(match => {
          const label = match[1].match(/aria-label="([^"]+)"/)?.[1];
          expect(label, `Missing accessible name: ${match[0]}`).toBeTruthy();
          return label!;
        });
        // Feed the rendered controls through the same installer used after React mounts.
        const f = tooltipFixture(labels);
        for (const control of f.controls) {
          expect(control.dataset.tip).toBe(control.getAttribute("aria-label"));
          expect(control.hasAttribute("title")).toBe(false);
          checked++;
        }
        f.stop();
      }
    }
    expect(checked).toBeGreaterThan(500); // covers all looks, dashboards and both stats visibility choices
  } finally { settings.set(previous); tasks.set(previousTasks); }
});
