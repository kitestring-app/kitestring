import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { settings, settingsUpdate } from "../state/settings";
import { timer } from "../state/timer";
import { THEMES } from "../data/themes";
import { installTooltips } from "./tooltips";

/** Applies Extras settings. Returns `idle` for clear mode (hide chrome when the mouse is away). */
export function useExtras(): boolean {
  useEffect(() => installTooltips(), []);
  const x = useStore(settings, (s) => s.extras);
  const running = useStore(timer, (t) => t.startedAt !== null);
  const [idle, setIdle] = useState(false);

  // Clear mode: hide UI after 3 s without pointer movement, or when the pointer leaves the window.
  useEffect(() => {
    if (!x.clearMode) return setIdle(false);
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 3000);
    };
    const leave = (event: PointerEvent) => { if (event.pointerType !== "touch") setIdle(true); };
    wake();
    window.addEventListener("pointermove", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("touchstart", wake, { passive: true });
    window.addEventListener("keydown", wake);
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("touchstart", wake);
      window.removeEventListener("keydown", wake);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, [x.clearMode]);

  // Prevent sleep: Screen Wake Lock while the page is visible (re-acquired after tab switches).
  useEffect(() => {
    if (window.desktop?.preventSleep) {
      window.desktop.preventSleep(x.preventSleep);
      return () => window.desktop?.preventSleep?.(false);
    }
    if (!x.preventSleep || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        const l = await navigator.wakeLock.request("screen");
        if (alive) lock = l;
        else void l.release(); // setting turned off while the request was pending
      } catch {
        /* denied, e.g. low battery */
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release();
    };
  }, [x.preventSleep]);

  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", x.reduceMotion);
  }, [x.reduceMotion]);

  // Theme randomizer: on load, or once per day. Waits for saved settings, otherwise it would read the defaults.
  useEffect(() => {
    void settings.ready.then(() => {
      const mode = settings.get().extras.randomizer;
      if (mode === "off") return;
      const today = new Date().toDateString();
      const key = "cp.randomizedOn";
      let last: string | null = null;
      try { last = localStorage.getItem(key); } catch { /* storage blocked */ }
      if (mode === "daily" && last === today) return;
      const pick = () => THEMES[Math.floor(Math.random() * THEMES.length)].id;
      settingsUpdate("themes", { home: { kind: "library", id: pick() }, focus: { kind: "library", id: pick() }, ambient: { kind: "library", id: pick() } });
      try { localStorage.setItem(key, today); } catch { /* storage blocked */ }
    });
  }, []);

  // only hide the UI while a session is running, so a paused dashboard stays usable
  return idle && running;
}
