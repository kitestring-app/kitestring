import { useRef, useState, useSyncExternalStore } from "react";
import { chooseInitialData, openPasswordReset, signIn, signOut, metaAfterImport, syncNow, syncStatus } from "../../lib/sync";
import { BACKUP_SECTIONS, createBackup, MAX_BACKUP_BYTES, parseBackup, restoreBackup } from "../../lib/backup";
import type { BackupSection } from "../../lib/backup";
import { Icon } from "../icons";
import { Toggle } from "./SettingsControls";
import { availableImportSections, BackupSections } from "./BackupSections";
import "./DataTab.css";
import { hardModeLocked, requestProfileReset } from "../../state/timer";

import { downloadFile } from "../stats/csv";

export function DataTab() {
  const file = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSections, setExportSections] = useState<BackupSection[]>(["settings"]);
  const [includeName, setIncludeName] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof parseBackup> | null>(null);
  const [importSections, setImportSections] = useState<BackupSection[]>([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const run = async (job: () => Promise<void>) => {
    setBusy(true); setAuthError("");
    try { await job(); } catch (e) { setAuthError((e as Error).message); }
    finally { setBusy(false); }
  };
  const sync = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);

  const exportAll = async () => {
    setBackupBusy(true); setMsg("");
    try {
      const text = await createBackup({ sections: exportSections, includeName });
      downloadFile(new Blob([text], { type: "application/json" }), `kitestring-settings-${new Date().toISOString().slice(0, 10)}.json`);
      setMsg("Exported your selected sections.");
    } catch (e) { setMsg(`Export failed: ${(e as Error).message}`); }
    finally { setBackupBusy(false); }
  };

  const importAll = async (f: File) => {
    setBackupBusy(true); setMsg(""); setPreview(null); setImportSections([]);
    try {
      if (f.size > MAX_BACKUP_BYTES) throw new Error("File is too large to be a backup.");
      const backup = parseBackup(await f.text()); // validates everything before touching storage
      setPreview(backup);
      setImportSections(availableImportSections(backup));
      setExportOpen(false);
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message} Nothing was changed.`);
    } finally {
      setBackupBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  const applyImport = async () => {
    if (!preview || !importSections.length) return;
    setBackupBusy(true); setMsg("");
    try {
      const keptTimer = await restoreBackup(preview, metaAfterImport, importSections);
      setPreview(null);
      setMsg(keptTimer ? "Imported. Your current timer block was kept. Reloading…" : "Imported. Reloading…");
      setTimeout(() => location.reload(), 600);
    } catch (e) { setMsg(`Import failed: ${(e as Error).message} Nothing was changed.`); }
    finally { setBackupBusy(false); }
  };

  const wipe = async () => {
    if (hardModeLocked()) { setMsg("End the Hard mode session first before deleting all data."); return; }
    if (!confirm("Delete all tasks, stats, notes, settings and uploaded backgrounds in this browser? This cannot be undone.")) return;
    try {
      if (!await requestProfileReset()) { setMsg("The active timer changed. End any Hard mode block, then try again."); return; }
      location.reload();
    } catch (error) { setMsg((error as Error).message); }
  };

  return (
    <>
      <h1>Your data</h1>
      <p className="lede">Your data stays on this device until you sign in to sync. No ads, no tracking.</p>
      <div className="card">
        <h3>Cloud sync</h3>
        {sync.state === "off" ? <p className="help">The localhost companion keeps data on this device. Sign in on the hosted site or in the Mac app to sync.</p> : !sync.email ? (
          <form method="post" onSubmit={(e) => { e.preventDefault(); const secret = password; setPassword(""); void run(() => signIn(email, secret)); }}>
            <label className="opt">Email<input className="input" type="email" autoComplete="username" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></label>
            <label className="opt">Password<input className="input" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} /></label>
            <div className="row"><button className="btn primary" disabled={busy}>Sign in</button><a href="https://kitestring.custom-pomodoro.workers.dev/account/reset/" target="_blank" rel="noreferrer" onClick={e => { if (window.desktop?.cloud) { e.preventDefault(); void run(openPasswordReset); } }}>Forgot password?</a></div>
          </form>
        ) : sync.state === "choice" ? (
          <>
            <p>Keep this device's data or replace it with the account's data?</p>
            <p className="help">Keep uploads this device's tasks, notes, stats and settings to the account. Replace downloads the account's copy, including clearing values missing there. Export a backup first if you want both copies.</p>
            <div className="row"><button className="btn" disabled={busy} onClick={() => void run(() => chooseInitialData("keep"))}>Keep this device's data</button><button className="btn" disabled={busy} onClick={() => void run(() => chooseInitialData("replace"))}>Replace with account's data</button><button className="btn" disabled={busy} onClick={() => void run(signOut)}>Sign out</button></div>
          </>
        ) : (
          <>
            <p className="help">Synced to {sync.email}{sync.at ? ` · last sync ${new Date(sync.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}{sync.state === "syncing" ? " · Syncing…" : ""}</p>
            <p className="help">Tasks, stats, notes, settings, saved mixes and radio favourites follow you across devices. Uploaded backgrounds and the running timer stay on each device.</p>
            <div className="row"><button className="btn" disabled={busy || sync.state === "syncing"} onClick={() => void run(syncNow)}>Sync now</button><button className="btn" disabled={busy} onClick={() => void run(signOut)}>Sign out</button></div>
          </>
        )}
        {Object.entries(sync.warnings ?? {}).map(([key, warning]) => <p key={key} className="help" role="alert">{warning}</p>)}
        {(authError || sync.error) && <p className="help" role="alert">{authError || sync.error}</p>}
      </div>
      <div className="card">
        <h3>Settings file</h3>
        <p className="help">Share your setup or move it to another device. Add your sounds, device options and focus data for a full backup. Images are optional. Timer snapshots restore only when this device’s timer is idle; running and paused blocks keep their recorded time.</p>
        <div className="row data-file-actions">
          <button className="btn primary" disabled={backupBusy} aria-expanded={exportOpen} aria-controls="settings-export" onClick={() => { setExportOpen(!exportOpen); setPreview(null); setMsg(""); }}><Icon.down />Export settings…</button>
          <button className="btn" disabled={backupBusy} onClick={() => file.current?.click()}><Icon.up />Import settings…</button>
          <input ref={file} aria-label="Choose settings file" type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void importAll(e.target.files[0])} />
        </div>
        {exportOpen && <section className="data-file-panel" id="settings-export" aria-labelledby="settings-export-heading">
          <h4 id="settings-export-heading">Export settings</h4>
          <BackupSections available={BACKUP_SECTIONS} selected={exportSections} onChange={setExportSections} busy={backupBusy} exporting />
          <Toggle title="Include my name" checked={includeName} disabled={backupBusy} onChange={setIncludeName} />
          <p className="help">Your display name is left out unless you include it. Focus data and saved mixes can contain personal text. Images allow 5 MB each, 10 MB total. Files can be up to 20 MB.</p>
          <div className="row"><button className="btn primary" disabled={backupBusy} onClick={() => void exportAll()}>Download settings file</button><button className="btn" disabled={backupBusy} onClick={() => setExportOpen(false)}>Cancel export</button></div>
        </section>}
        {preview && <section className="data-file-panel" aria-labelledby="settings-import-heading">
          <h4 id="settings-import-heading">Import preview</h4>
          <p className="help">Version {preview.version} · {preview.exportedAt ? `Exported ${new Date(preview.exportedAt).toLocaleString()}` : "Export date not recorded"}</p>
          <BackupSections available={availableImportSections(preview)} selected={importSections} onChange={setImportSections} busy={backupBusy} backup={preview} />
          <p className="help">Only ticked sections replace their saved values. Unticked sections stay as they are. A running Hard mode block is kept. Images merge with your saved backgrounds.</p>
          <div className="row"><button className="btn primary" disabled={backupBusy || !importSections.length} onClick={() => void applyImport()}>Import selected sections</button><button className="btn" disabled={backupBusy} onClick={() => setPreview(null)}>Cancel import</button></div>
        </section>}
        {msg && <p className="muted small" role="status" style={{ marginTop: 12 }}>{msg}</p>}
      </div>
      <div className="card">
        <h3>Reset</h3>
        <p className="help">Start over from scratch.</p>
        <button className="btn" style={{ color: "var(--danger)" }} onClick={() => void wipe()}>Delete all data</button>
      </div>
    </>
  );
}
