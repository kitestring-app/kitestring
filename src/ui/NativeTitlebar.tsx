import { useEffect, useLayoutEffect, useState } from "react";
import "./NativeTitlebar.css";

/** Only the Mac main window draws under native traffic lights. */
export function NativeTitlebar() {
  const desktop = typeof window === "undefined" ? undefined : window.desktop;
  const mac = desktop?.platform === "darwin" && !desktop.mini;
  const [windowed, setWindowed] = useState(false);
  useEffect(() => {
    if (!mac) return;
    let live = true, changed = false;
    const off = desktop.onFullScreenChange?.(full => {
      changed = true;
      if (live) setWindowed(!full);
    });
    void desktop.getFullScreen?.().then(full => {
      // A native event can arrive while the initial IPC read is in flight.
      if (live && !changed && typeof full === "boolean") setWindowed(!full);
    }).catch(() => {});
    return () => { live = false; off?.(); };
  }, [desktop, mac]);
  const inset = mac && windowed;
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("mac-titlebar", inset);
    return () => document.documentElement.classList.remove("mac-titlebar");
  }, [inset]);
  return inset ? <div className="native-titlebar" aria-hidden="true" /> : null;
}
