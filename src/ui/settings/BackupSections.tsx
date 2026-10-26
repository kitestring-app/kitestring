import { STORE_CLASS } from "../../lib/backup";
import type { BackupSection, ParsedBackup } from "../../lib/backup";
import { Toggle } from "./SettingsControls";

const descriptions: Record<BackupSection, [string, string]> = {
  settings: ["Settings", "Themes, clock, timer and reminders"],
  sounds: ["Sounds and mixes", "Mixer, saved mixes and radio pins"],
  device: ["This device’s options", "Floating timer, menu bar, mute and opacity"],
  focus: ["Focus data", "Tasks, history, next action, parked thoughts and notes. Timer restored only when idle."],
  images: ["Images", "Saved background images"],
};
const count = (value: number, noun: string, plural = `${noun}s`) => `${value} ${value === 1 ? noun : plural}`;
function leaves(value: unknown): number {
  return value && typeof value === "object" ? Object.values(value).reduce<number>((total, child) => total + leaves(child), 0) : 1;
}
function details(section: BackupSection, backup?: ParsedBackup): string {
  if (!backup) return descriptions[section][1];
  const { data } = backup;
  if (section === "focus") {
    const stats = data.stats as { chunks?: unknown[] } | undefined;
    return [count(Array.isArray(data.tasks) ? data.tasks.length : 0, "task"), count(stats?.chunks?.length ?? 0, "session"), count(Array.isArray(data.parked) ? data.parked.length : 0, "parked thought"), "Notes"].join(" · ");
  }
  if (section === "images") return count(backup.images?.length ?? 0, "image");
  if (section === "settings") return count(data.settings ? leaves(data.settings) : 0, "preference");
  if (section === "sounds") {
    const mixer = data.mixer as { layers?: unknown[]; mixes?: unknown[] } | undefined;
    const radio = data.radio as { pinned?: unknown[] } | undefined;
    return [count(mixer?.layers?.length ?? 0, "sound layer"), count(mixer?.mixes?.length ?? 0, "saved mix", "saved mixes"), count(radio?.pinned?.length ?? 0, "radio pin")].join(" · ");
  }
  return count((data.devicePreferences ? Object.keys(data.devicePreferences).filter(key => key !== "migrated").length : 0) + (data.floatingGlass ? 1 : 0), "device option");
}

/** A declared section can be empty in a partial or older file. Only offer stored content. */
export function availableImportSections(backup: ParsedBackup): BackupSection[] {
  return (backup.sections ?? []).filter(section => section === "images"
    ? !!backup.images?.length
    : Object.entries(STORE_CLASS).some(([key, value]) => value.section === section && key in backup.data));
}

export function BackupSections({ available, selected, onChange, busy, exporting = false, backup }: {
  available: readonly BackupSection[]; selected: readonly BackupSection[];
  onChange: (sections: BackupSection[]) => void; busy: boolean; exporting?: boolean; backup?: ParsedBackup;
}) {
  return <fieldset className="data-file-sections" disabled={busy}>
    <legend className="small muted">{exporting ? "Sections to include" : "Sections to apply"}</legend>
    {(backup ? availableImportSections(backup).filter(section => available.includes(section)) : available).map(section => <Toggle key={section}
      title={descriptions[section][0] + (exporting && section === "settings" ? " (always included)" : "")}
      help={details(section, backup)} checked={selected.includes(section)} disabled={busy || (exporting && section === "settings")}
      onChange={checked => onChange(available.filter(value => value === section ? checked : selected.includes(value)))} />)}
  </fieldset>;
}
