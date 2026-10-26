/** Shared switch, also re-exported by SettingsDrawer for existing callers. */
export function Toggle({ title, help, checked, onChange, disabled = false }: { title: string; help?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="opt">
      <input type="checkbox" className="switch" style={disabled ? { opacity: 0.5 } : undefined} disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div>
        <b>{title}</b>
        {help && <span>{help}</span>}
      </div>
    </label>
  );
}

