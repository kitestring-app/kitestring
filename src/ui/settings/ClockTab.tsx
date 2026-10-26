import { useStore } from "../../lib/store";
import { settings, settingsUpdate, type FontId, type Settings, type Size } from "../../state/settings";
import { FlipPalettePicker } from "../timer/FlipPalettePicker";
import { Choices, Toggle } from "./SettingsDrawer";

export const FONTS: Record<FontId, { label: string; family: string; weight: number }> = {
  look: { label: "Match the look", family: "var(--timer-font)", weight: 0 },
  heavy: { label: "Heavy", family: '"SF Pro Display", "Inter", system-ui, sans-serif', weight: 800 },
  sans: { label: "Clean", family: '"SF Pro Display", "Inter", system-ui, sans-serif', weight: 300 },
  rounded: { label: "Soft", family: '"Nunito App", "SF Pro Rounded", ui-rounded, system-ui, sans-serif', weight: 700 },
  mono: { label: "Mono", family: '"Maple Mono NF", "SF Mono", ui-monospace, monospace', weight: 400 },
  serif: { label: "Serif", family: '"New York", "Iowan Old Style", Georgia, serif', weight: 500 },
  digital: { label: "Digital", family: '"DSEG7 Classic", "SF Mono", ui-monospace, monospace', weight: 700 },
};

/** A chosen timer font overrides the look's own. "Match the look" clears the override. */
export function applyFont(id: FontId) {
  const root = document.documentElement.style;
  if (id === "look") {
    root.removeProperty("--user-timer-font");
    root.removeProperty("--user-timer-weight");
    return;
  }
  const f = FONTS[id];
  root.setProperty("--user-timer-font", f.family);
  root.setProperty("--user-timer-weight", String(f.weight));
}

export function ClockTab() {
  const c = useStore(settings, (s) => s.clock);
  const name = useStore(settings, (s) => s.extras.displayName);
  const set = (p: Partial<Settings["clock"]>) => settingsUpdate("clock", p);
  const swatch = (txt: string, size = 26, font?: FontId) => (
    <div style={{ height: 70, display: "grid", placeItems: "center", borderRadius: 12, background: "var(--accent-soft)", color: "var(--fg)", fontFamily: font ? FONTS[font].family : "var(--timer-font)", fontWeight: font && font !== "look" ? FONTS[font].weight : "var(--timer-weight)", fontSize: size }}>{txt}</div>
  );
  return (
    <>
      <h1>Clock</h1>
      <p className="lede">Customize your clock and greetings.</p>
      <div className="card">
        <h3>Clock format</h3>
        <Choices value={c.format} onChange={(v) => set({ format: v })} options={[{ id: "12", label: "12-hour", preview: swatch("2:24") }, { id: "24", label: "24-hour", preview: swatch("14:24") }]} />
      </div>
      <div className="card">
        <h3>Clock & timer size</h3>
        <Choices<Size> value={c.size} onChange={(v) => set({ size: v })} options={[{ id: "small", label: "Small", preview: swatch("2:24", 18) }, { id: "regular", label: "Regular", preview: swatch("2:24", 28) }, { id: "huge", label: "Huge", preview: swatch("2:24", 40) }]} />
      </div>
      <div className="card">
        <h3>Clock & timer style</h3>
        <Choices<FontId> value={c.font} onChange={(v) => { set({ font: v }); applyFont(v); }} options={(Object.keys(FONTS) as FontId[]).map((id) => ({ id, label: FONTS[id].label, preview: swatch("25:00", 26, id) }))} />
      </div>
      <div className="card">
        <Toggle title="Use flip clock" help="Display the clock with a flip animation." checked={c.flip} onChange={(v) => set({ flip: v })} />
        {c.flip && <FlipPalettePicker />}
        <Toggle title="Show clock seconds" help="A detailed time view." checked={c.seconds} onChange={(v) => set({ seconds: v })} />
        <Toggle title="Show greetings" help="Greeting under the Home clock." checked={c.greetings} onChange={(v) => set({ greetings: v })} />
        <Toggle title="Dynamic greetings" help="Varies the greeting through the day. Off: plain good morning/afternoon/evening." checked={c.dynamicGreetings} onChange={(v) => set({ dynamicGreetings: v })} />
        <label className="opt" style={{ display: "grid", gap: 8 }}>
          <b>Display name</b>
          <input className="input" style={{ maxWidth: 320 }} placeholder="Your name" value={name} maxLength={40} onChange={(e) => settingsUpdate("extras", { displayName: e.target.value })} />
        </label>
      </div>
    </>
  );
}
