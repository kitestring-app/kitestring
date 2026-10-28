import { useEffect, useRef } from "react";
import "./DashboardFit.css";

/** Measure actual chrome, including optional pin/card content, rather than guessing its height. */
export function useDashboardFit() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const center = ref.current;
    if (!center) return;
    let frame = 0;
    const measure = () => {
      // Phone sheets share the space between the real bars, even after a header wraps.
      const bounds = center.getBoundingClientRect();
      document.documentElement.style.setProperty("--dashboard-space", `${center.clientHeight}px`);
      document.documentElement.style.setProperty("--dashboard-bottom", `${Math.max(0, innerHeight - bounds.bottom)}px`);
      const face = center.querySelector<HTMLElement>(":scope > .time-display .timer.big, :scope > .time-display .timer-face.is-big, :scope > .timer.big, :scope > .timer-face.is-big, .clock-row > .timer.big, .clock-row > .timer-face.is-big");
      const row = face?.closest<HTMLElement>(".clock-row, .time-display") ?? face ?? center.querySelector<HTMLElement>(".time-display");
      if (!row) return;
      const style = getComputedStyle(center);
      const factor = face ? face.getBoundingClientRect().height / parseFloat(getComputedStyle(face).fontSize) : 0;
      let chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      for (const child of center.children) {
        if (!(child instanceof HTMLElement) || child === row) continue;
        const childStyle = getComputedStyle(child);
        if (childStyle.display === "none" || childStyle.position === "absolute" || childStyle.position === "fixed") continue;
        chrome += child.getBoundingClientRect().height + parseFloat(childStyle.marginTop) + parseFloat(childStyle.marginBottom);
      }
      // The grid's middle row is the dvh left after the real top and bottom bars.
      // Keep a readable face when content needs the middle row's last-resort scroll.
      if (factor) {
        const available = Math.max(40, (center.clientHeight - chrome) / factor);
        const next = `${Math.floor(available * 100) / 100}px`;
        if (center.style.getPropertyValue("--fit-height") !== next) center.style.setProperty("--fit-height", next);
      }
      center.dataset.fitScroll = String(chrome + row.getBoundingClientRect().height > center.clientHeight + .5);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    const observe = () => {
      resize.disconnect(); resize.observe(center);
      for (const child of center.children) resize.observe(child);
      schedule();
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(center, { childList: true, subtree: true, characterData: true });
    observe();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); };
  }, []);
  return ref;
}
