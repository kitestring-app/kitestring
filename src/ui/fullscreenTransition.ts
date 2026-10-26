type Subscribe = (callback: (phase: "start" | "end") => void) => () => void;

/** Foreground fades fail open after 700ms, or sooner after end and settled layout. */
export function installFullscreenTransition(subscribe: Subscribe) {
  const root = document.documentElement;
  let reveal: ReturnType<typeof setTimeout> | undefined;
  let ceiling: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let active = false, ending = false;
  const reduced = () => root.classList.contains("reduce-motion") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const restore = () => {
    clearTimeout(reveal); clearTimeout(ceiling); cancelAnimationFrame(frame);
    active = ending = false;
    root.classList.remove("fs-transition", "fs-content-out", "fs-content-in");
  };
  const laidOut = () => {
    cancelAnimationFrame(frame);
    const width = window.innerWidth, height = window.innerHeight;
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (!active) return;
        if (width !== window.innerWidth || height !== window.innerHeight) { laidOut(); return; }
        restore();
        if (!reduced()) {
          root.classList.add("fs-content-in");
          reveal = setTimeout(() => root.classList.remove("fs-content-in"), 180);
        }
      });
    });
  };
  const resize = () => { if (active && ending) laidOut(); };
  window.addEventListener("resize", resize);
  const off = subscribe(phase => {
    if (phase === "start") {
      restore(); active = true;
      root.classList.add("fs-transition");
      root.classList.toggle("fs-content-out", !reduced());
      ceiling = setTimeout(restore, 700);
    } else if (active) {
      ending = true;
      laidOut();
    }
  });
  return () => {
    off(); restore();
    window.removeEventListener("resize", resize);
  };
}
