import { createRoot, type Root } from "react-dom/client";
import { localPreferences, localPreferencesReady, localPreferencesUpdate, settings } from "../state/settings";
import { MiniTimer } from "./MiniTimer";

declare global {
  interface Window {
    documentPictureInPicture?: { requestWindow(o?: { width?: number; height?: number }): Promise<Window>; window: Window | null };
  }
}

let opening = false;
let nativeOpen = false;
let nativeEvents: Window["desktop"];

/** Opens the floating timer. Resolves to an error message when it can't. */
export async function openPip(): Promise<string | null> {
  if (window.desktop?.floatTimer) {
    if (nativeEvents !== window.desktop) {
      nativeEvents = window.desktop;
      window.desktop.onFloatTimer?.((open) => { nativeOpen = open; });
    }
    if (opening) return null;
    opening = true;
    try {
      if (window.desktop.setFloatingPreferences) {
        await localPreferencesReady;
        nativeOpen = localPreferences.get().floatingTimer;
      }
      nativeOpen = await window.desktop.floatTimer(!nativeOpen);
      if (window.desktop.setFloatingPreferences) localPreferencesUpdate({ floatingTimer: nativeOpen });
      return null;
    } catch {
      return "Couldn't open the Mac floating timer. Try again.";
    } finally { opening = false; }
  }
  const api = window.documentPictureInPicture;
  if (!api) return "Picture-in-Picture needs Chrome or Edge 116 or newer.";
  if (api.window) {
    api.window.focus();
    return null;
  }
  if (opening) return null; // a second click while the first window is still opening
  opening = true;
  let w: Window;
  try {
    w = await api.requestWindow({ width: 300, height: 220 });
  } catch {
    return "The browser didn't allow the floating timer.";
  } finally {
    opening = false;
  }
  // carry the app's styles into the floating window
  for (const sheet of [...document.styleSheets]) {
    try {
      const css = [...sheet.cssRules].map((r) => r.cssText).join("\n");
      const el = w.document.createElement("style");
      el.textContent = css;
      w.document.head.appendChild(el);
    } catch {
      if (sheet.href) {
        const link = w.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        w.document.head.appendChild(link);
      }
    }
  }
  const extra = w.document.createElement("style");
  // The PiP window gets the same look as the app it came from.
  // ...and follows it when the look changes while the window is open.
  const syncLook = () => { w.document.documentElement.dataset.look = settings.get().appearance.look; };
  syncLook();
  const offLook = settings.subscribe(syncLook);
  extra.textContent = `body{overflow:hidden;background:var(--bg);color:var(--fg);display:grid;place-items:center;height:100vh}
  .mini-timer{text-align:center}.pip-seg{color:var(--fg-dim);font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.06em}
  .pip-time{font-size:64px}.pip-bar{height:4px;width:220px;margin:8px auto 0;background:var(--track);border-radius:9px;overflow:hidden}
  .pip-bar i{display:block;height:100%;background:var(--accent)}`;
  w.document.head.appendChild(extra);
  const mount = w.document.createElement("div");
  w.document.body.appendChild(mount);
  const root: Root = createRoot(mount); // one root per window, unmounted with that window
  root.render(<MiniTimer />);
  w.addEventListener("pagehide", () => { offLook(); root.unmount(); }, { once: true });
  return null;
}
