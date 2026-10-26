import { localPreferences, localPreferencesReady, localPreferencesUpdate } from "../state/settings";

/** Settings own persistence; the main process only projects them into native UI. */
export async function connectFloatingSettings() {
  const bridge = window.desktop;
  if (!bridge?.setFloatingPreferences || bridge.mini) return () => {};
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
  return () => { off?.(); unsubscribe(); };
}
