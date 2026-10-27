import { useEffect, useState } from "react";
import { useStore } from "../../lib/store";
import { effectiveDefaultTab, floatingGlass, localPreferences, localPreferencesUpdate, settings, settingsUpdate, type Settings, type SettingsTab } from "../../state/settings";
import { Toggle } from "./SettingsDrawer";

export function ExtrasTab() {
  const [parking, setParking] = useState<boolean | null>(null);
  useEffect(() => { void window.desktop?.parkingStatus?.().then(status => setParking(status?.registered ?? false)).catch(() => setParking(false)); }, []);
  const x = useStore(settings, (s) => s.extras);
  const local = useStore(localPreferences);
  const glass = useStore(floatingGlass);
  const set = (p: Partial<Settings["extras"]>) => settingsUpdate("extras", p);
  return (
    <>
      <h1>Extras</h1>
      <p className="lede">Fine-tune how the dashboard behaves.</p>
      {parking !== null && <div className="card"><h3>Park a thought · ⌥⌘P</h3><p className="help" role={parking ? undefined : "status"}>{parking ? "The global shortcut is ready. Park a thought from any app without interrupting your timer." : "Couldn’t register ⌥⌘P. Another app may be using it. You can still use P in the dashboard or the Park a thought button."}</p></div>}
      {window.desktop?.floatTimer && <div className="card">
        <h3>Floating timer & menu bar</h3>
        <Toggle title="Floating timer" help="Keep a small timer on every desktop." checked={local.floatingTimer} onChange={v => localPreferencesUpdate({ floatingTimer: v })} />
        <Toggle title="Keep floating timer on top" help="Keep the timer above other windows." checked={local.floatingOnTop} onChange={v => localPreferencesUpdate({ floatingOnTop: v })} />
        <label className="opt floating-glass">
          <span><b>Floating timer glass</b><span>From clear frosted glass to solid. Follows your look.</span></span>
          <input id="floating-glass" className="range" type="range" min={0} max={1} step={0.05} value={glass.opacity} aria-valuetext={`${Math.round(glass.opacity * 100)} percent solid`} onChange={e => floatingGlass.set({ opacity: Number(e.target.value) })} />
        </label>
        <Toggle title="Show in menu bar" help="When hidden, open the app from the Dock." checked={local.showMenuBar} onChange={v => localPreferencesUpdate({ showMenuBar: v })} />
        <Toggle disabled={!local.showMenuBar} title="Show time in menu bar" help="The tooltip always shows the current time." checked={local.menuBarTime} onChange={v => localPreferencesUpdate({ menuBarTime: v })} />
      </div>}
      {window.desktop?.getSecureDns && window.desktop?.setSecureDns && <SecureDnsSettings />}
      <div className="card">
        <h3>Performance & display</h3>
        <Toggle title="Hide stats" help="Hide record views. Your timer and saved history stay available." checked={x.hideStats} onChange={v => set({ hideStats: v })} />
        <Toggle title="Disable animated themes" help="Saves battery and CPU." checked={x.disableAnimated} onChange={(v) => set({ disableAnimated: v })} />
        <Toggle title="Reduce motion" help="Turns off UI transitions and animations." checked={x.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />
        <Toggle title="Clear mode" help="While a session runs, hide controls after 3 seconds without mouse movement, or when the mouse leaves the window." checked={x.clearMode} onChange={(v) => set({ clearMode: v })} />
        <Toggle title="Prevent sleep" help={window.desktop?.preventSleep ? "Keep the Mac screen awake, including while the window is closed." : `Keep the screen on while this tab is visible. ${"wakeLock" in navigator ? "" : "Not supported in this browser."}`} checked={x.preventSleep} onChange={(v) => set({ preventSleep: v })} />
      </div>
      <div className="card">
        <h3>Default settings tab</h3>
        <p className="help">Which tab opens when you open settings.</p>
        <select className="input" style={{ maxWidth: 320 }} value={effectiveDefaultTab(x)} onChange={(e) => set({ defaultTab: e.target.value as SettingsTab | "recent" })}>
          <option value="recent">Recently opened</option>
          {(["themes", "clock", "timer", "stats", "quotes", "extras", "data"] as SettingsTab[]).filter(t => !x.hideStats || t !== "stats").map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
        </select>
      </div>
      <div className="card">
        <h3>Theme randomizer</h3>
        <p className="help">Show a random library theme.</p>
        <select className="input" style={{ maxWidth: 320 }} value={x.randomizer} onChange={(e) => set({ randomizer: e.target.value as Settings["extras"]["randomizer"] })}>
          <option value="off">Disabled</option>
          <option value="load">Every time the page loads</option>
          <option value="daily">Once a day</option>
        </select>
      </div>
    </>
  );
}


function SecureDnsSettings() {
  const [url, setUrl] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    void window.desktop!.getSecureDns!().then(value => {
      if (live && value !== null) { setUrl(value); setReady(true); }
    }).catch(() => { if (live) setMessage("Could not read the DNS option. Reopen Settings to try again."); });
    return () => { live = false; };
  }, []);
  return <div className="card">
    <h3>DNS on this Mac</h3>
    <p className="help">Uses system DNS by default. You can enter your own HTTPS DNS profile URL here. This option stays on this Mac and is excluded from sync and settings exports. Leave it empty to use system DNS.</p>
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setMessage("");
      try {
        const saved = await window.desktop!.setSecureDns!(url.trim());
        setMessage(saved ? "Saved on this Mac." : "Could not save. Enter a valid HTTPS DNS URL or leave it empty.");
      } catch { setMessage("Could not save. Try again."); }
      finally { setBusy(false); }
    }}>
      <label className="opt"><span>DNS-over-HTTPS URL</span><input className="input" type="url" value={url} disabled={!ready || busy} onChange={event => setUrl(event.target.value)} autoComplete="off" spellCheck={false} /></label>
      <button className="btn small" disabled={!ready || busy}>Save DNS option</button>
      <p className="help" role="status">{message}</p>
    </form>
  </div>;
}
