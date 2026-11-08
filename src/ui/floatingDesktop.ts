import { localPreferences, localPreferencesReady, localPreferencesUpdate } from "../state/settings";

let liveOpen: boolean | null = null;
/** Whether the Mac floating timer window is open right now, or null before the app has said.
 * It can differ from the saved setting: a focus block can open it for itself (Settings > Extras). */
export function floatingWindowOpen() { return liveOpen; }

/** Settings own persistence; the main process only projects them into native UI. */
export async function connectFloatingSettings() {
  const bridge = window.desktop;
  if (!bridge?.setFloatingPreferences || bridge.mini) return () => {};
  const offLive = bridge.onFloatTimer?.(open => { liveOpen = open; });
  await localPreferencesReady;
  const off = bridge.onFloatingPreferences?.(value => localPreferencesUpdate(value));
  const publish = () => {
    const { floatingTimer, floatingOnTop, menuBarTime, showMenuBar } = localPreferences.get();
    void bridge.setFloatingPreferences!({ floatingTimer, floatingOnTop, menuBarTime, showMenuBar });
  };
  let previous = "";
  const sync = () => {
    const { floatingTimer, floatingOnTop, menuBarTime, showMenuBar } = localPreferences.get();
    const key = `${floatingTimer}:${floatingOnTop}:${menuBarTime}:${showMenuBar}`;
    if (key !== previous) { previous = key; publish(); }
  };
  const unsubscribe = localPreferences.subscribe(sync);
  sync();
  return () => { off?.(); offLive?.(); unsubscribe(); liveOpen = null; };
}
