import { useStore } from "../../lib/store";
import { settings, settingsUpdate } from "../../state/settings";
import { Choices } from "../settings/SettingsDrawer";
import { FLIP_PALETTES } from "./palettes";
import type { FlipPaletteId } from "./palettes";
import { FlipFace } from "./styles";

export function FlipPalettePicker() {
  const palette = useStore(settings, s => s.timer.flipPalette);
  return <div className="flip-palette-picker">
    <h3>Flip colours</h3>
    <p className="help">Used by the flip clock and timer.</p>
    <Choices<FlipPaletteId> value={palette} onChange={flipPalette => settingsUpdate("timer", { flipPalette })}
      options={(Object.entries(FLIP_PALETTES) as [FlipPaletteId, { name: string }][]).map(([id, p]) => ({
        id, label: p.name, preview: <FlipFace display="25:00" progress={0} showNumbers big={false} palette={id} />,
      }))} />
  </div>;
}
