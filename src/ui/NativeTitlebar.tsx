import { useEffect, useLayoutEffect, useState } from "react";
import "./NativeTitlebar.css";

/** Only the Mac main window draws under native traffic lights. */
export function NativeTitlebar() {
  const desktop = typeof window === "undefined" ? undefined : window.desktop;
  const mac = desktop?.platform === "darwin" && !desktop.mini;
  // Reserve native chrome from the first paint until fullscreen is known.
  const [windowed, setWindowed] = useState(mac);
  useEffect(() => {
    if (!mac) return;
    let live = true, changed = false, full = false;
    let early: ReturnType<typeof setTimeout> | undefined;
    const off = desktop.onFullScreenChange?.(next => {
      changed = true; full = next;
      clearTimeout(early);
      if (live) setWindowed(!next);
    });
    // Move the inset while the foreground is faded out (120ms), so the reveal
    // lands on the final layout instead of shifting 28px as it fades back in.
    // A cancelled transition is corrected by the settled state event above.
    const offTransition = desktop.onFullScreenTransition?.(phase => {
      if (phase !== "start") return;
      clearTimeout(early);
      const target = !full;
      early = setTimeout(() => { if (live) setWindowed(!target); }, 120);
    });
    void desktop.getFullScreen?.().then(value => {
      // A native event can arrive while the initial IPC read is in flight.
      if (live && !changed && typeof value === "boolean") { full = value; setWindowed(!value); }
    }).catch(() => {});
    return () => { live = false; clearTimeout(early); off?.(); offTransition?.(); };
  }, [desktop, mac]);
  const inset = mac && windowed;
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("mac-titlebar", inset);
    return () => document.documentElement.classList.remove("mac-titlebar");
  }, [inset]);
  return inset ? <div className="native-titlebar" aria-hidden="true" /> : null;
}
