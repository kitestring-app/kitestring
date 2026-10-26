import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { customBgs, findTheme, saveCustomBackground, removeCustomBackground, THEMES, THEME_CATEGORIES } from "../../data/themes";
import type { CustomBackground, ThemeCategory } from "../../data/themes";
import { dbGet } from "../../lib/db";
import { useStore } from "../../lib/store";
import { settings, settingsUpdate } from "../../state/settings";
import type { DashMode, ThemeRef } from "../../state/settings";
import { themeStyle } from "../Background";
import { formatClock, useClock } from "../ClockView";
import { Toggle } from "./SettingsDrawer";
import "./ThemesTab.css";
import { LookSection } from "./LookSection";

const MODES: { id: DashMode; label: string }[] = [
  { id: "home", label: "Home" }, { id: "focus", label: "Focus" }, { id: "ambient", label: "Ambient" },
];

function useBackgroundUrl(id: string | null) {
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    let url: string | null = null;
    void dbGet<Blob>(`custom-bg:${id}`).then((blob) => {
      if (!alive || !(blob instanceof Blob)) return;
      url = URL.createObjectURL(blob);
      setLoaded({ id, url });
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  return loaded?.id === id ? loaded.url : null;
}

function SavedBackground({ bg, selected, disabled, onPick, onDelete }: {
  bg: CustomBackground; selected: boolean; disabled: boolean; onPick: () => void; onDelete: () => void;
}) {
  const url = useBackgroundUrl(bg.id);
  return (
    <div className="theme-saved">
      <button className="theme-tile" aria-pressed={selected} disabled={disabled} onClick={onPick}>
        <span className="theme-thumb" style={{ backgroundImage: url ? `url(${url})` : undefined }} />
        <span className="theme-name">{bg.name}</span>
      </button>
      <button className="btn small theme-delete" disabled={disabled} aria-label={`Delete ${bg.name}`} onClick={onDelete}>Delete</button>
    </div>
  );
}

export function ThemesTab() {
  const s = useStore(settings);
  const saved = useStore(customBgs);
  const [mode, setMode] = useState<DashMode>(s.dash);
  const [category, setCategory] = useState<ThemeCategory | "all">("all");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { void Promise.all([settings.ready, customBgs.ready]).then(() => setReady(true)); }, []);
  const ref = s.themes[mode];
  const customUrl = useBackgroundUrl(ref.kind === "custom" ? ref.id : null);
  const { style, cls } = themeStyle(ref, customUrl, s.extras.disableAnimated || s.extras.reduceMotion);
  const now = useClock(s.clock.seconds);
  const name = ref.kind === "library" ? findTheme(ref.id)?.name ?? "Dusk Glass"
    : ref.kind === "color" ? ref.id : saved.find((bg) => bg.id === ref.id)?.name ?? "Custom background";
  const selected = (kind: ThemeRef["kind"], id: string) => ref.kind === kind && ref.id === id;
  const pick = (next: ThemeRef) => {
    settingsUpdate("themes", { [mode]: next });
    setMessage(`Applied to ${mode}.`);
  };

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setMessage(""); setBusy(true);
    try {
      const { id } = await saveCustomBackground(file);
      pick({ kind: "custom", id });
      setMessage(`Saved ${file.name} and applied to ${mode}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read this image. Try another file.");
    } finally { setBusy(false); }
  }

  async function remove(bg: CustomBackground) {
    setBusy(true); setError("");
    try {
      await removeCustomBackground(bg.id);
      setMessage(`Deleted ${bg.name}. Modes using it now use Dusk Glass.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete this image."); }
    finally { setBusy(false); }
  }

  return (
    <div className="themes-settings">
      <h1>Themes</h1>
      <p className="lede muted">A little atmosphere for your time here.</p>
      <LookSection />
      <div className="seg theme-modes" aria-label="Dashboard theme mode">
        {MODES.map((m) => <button key={m.id} aria-pressed={mode === m.id} disabled={busy} onClick={() => { setMode(m.id); setMessage(""); }}>{m.label}</button>)}
      </div>
      <div key={`${ref.kind}:${ref.id}`} className={`theme-preview ${cls}`} style={style} aria-label={`${mode} theme preview: ${name}`}>
        <div className="theme-preview-content">
          <span className="theme-preview-mode">{mode} preview</span>
          <time className="theme-preview-clock">{formatClock(now, s.clock.format, s.clock.seconds)}</time>
          <span className="theme-preview-name">{name}</span>
        </div>
      </div>
      <div className="theme-actions">
        <button className="btn primary" disabled={!ready || busy} onClick={() => {
          settingsUpdate("themes", { home: ref, focus: ref, ambient: ref }); setMessage("Applied to all modes.");
        }}>Apply to all modes</button>
        <button className="btn" disabled={!ready || busy} onClick={() => {
          const pool = THEMES.filter((t) => (!s.extras.disableAnimated || !t.animated) && !(ref.kind === "library" && ref.id === t.id));
          pick({ kind: "library", id: pool[Math.floor(Math.random() * pool.length)].id });
        }}>Random theme</button>
      </div>
      <p className="small muted theme-feedback" role="status">{busy ? "Processing image…" : message}</p>
      {error && <p className="theme-error" role="alert">{error}</p>}
      <section className="card" aria-labelledby="custom-background-heading">
        <h2 id="custom-background-heading">Custom background</h2>
        <p className="help">Your images stay on this device. Save up to 12 images (60 MB total). GIFs are saved as still images.</p>
        <div className="theme-upload-row">
          <label className={`btn theme-upload ${!ready || busy ? "is-disabled" : ""}`}>
            Upload image
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={!ready || busy} onChange={(e) => void upload(e)} />
          </label>
          <span className="small muted">JPG, PNG, WebP, GIF · up to 15 MB · at most 12000 px per side / 50 MP · resized to 2560 px</span>
        </div>
        <label className="theme-color-row">
          <input type="color" aria-label="Solid background colour" value={ref.kind === "color" ? ref.id : "#182036"} disabled={!ready || busy} onInput={(e) => pick({ kind: "color", id: e.currentTarget.value })} />
          <span>Solid colour{ref.kind === "color" && <span className="small muted"> · {ref.id}</span>}</span>
        </label>
        {saved.length ? <div className="theme-grid theme-custom-grid">
          {saved.map((bg) => <SavedBackground key={bg.id} bg={bg} selected={selected("custom", bg.id)} disabled={!ready || busy} onPick={() => pick({ kind: "custom", id: bg.id })} onDelete={() => void remove(bg)} />)}
        </div> : <p className="small muted">No saved images yet. Upload one to get started.</p>}
      </section>
      <section aria-labelledby="theme-library-heading">
        <h2 id="theme-library-heading">Theme library</h2>
        <div className="theme-categories" aria-label="Theme categories">
          {[{ id: "all" as const, label: "All" }, ...THEME_CATEGORIES].map((c) => <button className="btn small" key={c.id} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</button>)}
        </div>
        <Toggle title="Animate themes" help="Turn off to keep animated backgrounds still." checked={!s.extras.disableAnimated} onChange={(v) => settingsUpdate("extras", { disableAnimated: !v })} />
        {(s.extras.reduceMotion || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)) && <p className="small muted">Reduced motion keeps theme animations still.</p>}
        {THEME_CATEGORIES.filter((c) => category === "all" || c.id === category).map((c) => {
          const items = THEMES.filter((t) => t.category === c.id);
          const isExpanded = category !== "all";
          return <section className="theme-section" key={c.id} aria-labelledby={`theme-heading-${c.id}`}>
            <div className="theme-section-head">
              <h3 id={`theme-heading-${c.id}`}>{c.label}</h3>
              {category === "all" && <button className="btn small" aria-label={`See all ${items.length} ${c.label} themes`} onClick={() => setCategory(c.id)}>See all ({items.length})</button>}
            </div>
            <div className="theme-grid">
              {(isExpanded ? items : items.slice(0, 3)).map((t) => <button key={t.id} className="theme-tile" aria-pressed={selected("library", t.id)} disabled={!ready || busy} onClick={() => pick({ kind: "library", id: t.id })}>
                <span className="theme-thumb" style={{ background: t.background.replace("w=2400", "w=480"), backgroundSize: "cover", backgroundPosition: "center" }} />
                <span className="theme-name">{t.name}{t.animated && <span className="theme-motion-label">Animated</span>}</span>
                {t.credit && <span className="theme-credit">Photo: {t.credit} / Unsplash</span>}
              </button>)}
            </div>
          </section>;
        })}
      </section>
    </div>
  );
}
