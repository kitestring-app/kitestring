import { EndSessionHost, requestEndSession } from "./ui/timer/EndSession";
import { InterruptionCapture } from "./ui/ParkCapture";
import { Credits } from "./ui/Credits";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { syncStatus } from "./lib/sync";
import { persistStatus, useStore } from "./lib/store";
import { settings, settingsUpdate, type DashMode, type SettingsTab } from "./state/settings";
import { startTicker, timer, timerActions } from "./state/timer";
import { Background } from "./ui/Background";
import { FocusView } from "./ui/FocusView";
import { ClockView, DashboardStreak } from "./ui/ClockView";
import { Icon } from "./ui/icons";
import { TasksPanel } from "./ui/panels/TasksPanel";
import { SoundsPanel } from "./ui/panels/SoundsPanel";
import { NotepadPanel } from "./ui/panels/NotepadPanel";
import { SettingsDrawer } from "./ui/settings/SettingsDrawer";
import { useExtras } from "./ui/useExtras";
import { InkFilters, useLook } from "./ui/Look";
import { TitleSync } from "./ui/TitleSync";
import { AlarmToast } from "./ui/AlarmToast";
import { boundaryAlert } from "./audio/boundaryAlert";
import { TransitionScreen } from "./ui/timer/TransitionScreen";
import { alertTypingGuard } from "./lib/alertTypingGuard";

import { interruptionPrompt, parked } from "./state/parked";
import { tasks } from "./state/tasks";
import { saveThought } from "./ui/ParkCapture";

type PanelId = "tasks" | "sounds" | "notes" | null;

export default function App() {
  const interruption = useSyncExternalStore(interruptionPrompt.subscribe, interruptionPrompt.get);
  const dash = useStore(settings, (s) => s.dash);
  const [parking, setParking] = useState(false);
  const parkingFocus = useRef<HTMLElement | null>(null);
  const openParking = () => {
    parkingFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    settingsUpdate("dash", "focus");
    setPanel(null);
    setParking(true);
  };
  const closeParking = () => { setParking(false); parkingFocus.current?.focus(); };
  const [panel, setPanel] = useState<PanelId>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openSync, setOpenSync] = useState(false);
  const [menuSettingsTab, setMenuSettingsTab] = useState<SettingsTab>();
  const [settingsRequest, setSettingsRequest] = useState(0);
  const idle = useExtras();
  useLook();
  const sync = useSyncExternalStore(syncStatus.subscribe, syncStatus.get);
  const saved = useSyncExternalStore(persistStatus.subscribe, persistStatus.get);
  const dockRef = useRef<HTMLElement>(null);
  const lastPanel = useRef<PanelId>(null);
  // closing a panel puts focus back on the dock button that opened it
  useEffect(() => {
    if (!parking && panel === null && lastPanel.current) dockRef.current?.querySelector<HTMLElement>(`[data-panel="${lastPanel.current}"]`)?.focus();
    lastPanel.current = panel;
  }, [panel, parking]);

  useEffect(() => { startTicker(); }, []);
  useEffect(() => window.desktop?.onParked?.((text) => {
    void Promise.all([parked.ready, timer.ready, tasks.ready]).then(() => saveThought(text));
  }), []);

  useEffect(() => window.desktop?.onMenuCommand?.(command => {
    if (command === "endSession") { setSettingsOpen(false); settingsUpdate("dash", "focus"); requestEndSession(); }
    else if (command === "settings" || command === "shortcuts") {
      setMenuSettingsTab(command === "shortcuts" ? "about" : undefined);
      setOpenSync(false);
      setSettingsRequest(value => value + 1);
      setSettingsOpen(true);
    } else if (command === "home" || command === "focus" || command === "ambient") {
      setSettingsOpen(false); settingsUpdate("dash", command);
    } else if (command === "tasks" || command === "sounds" || command === "notes") {
      setSettingsOpen(false); setPanel(command);
    } else if (command === "stopSound" || command === "stopAndPause" || command === "stop") void timerActions[command]();
    else if (command === "toggle" || command === "reset") timerActions[command]();
    else if (command === "skip") {
      const current = timer.get();
      if (current.segment === "short" || current.segment === "long" || current.startedAt !== null || current.elapsedBefore > 0) timerActions.skip();
    }
  }), []);

  // clear mode: invisible controls must also leave the tab order and the accessibility tree
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".chrome").forEach((el) => (el.inert = idle));
  }, [idle, dash]);

  // keyboard shortcuts (ignored while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (alertTypingGuard.keydown(e)) return;
      const el = e.target as HTMLElement;
      if (e.metaKey && e.key === "." && boundaryAlert.get().ringing) { e.preventDefault(); void timerActions.stopSound(); return; }
      if (e.key === "Escape") { setPanel(null); return; } // the settings dialog handles its own Escape
      if (e.defaultPrevented || el.closest("input, textarea, select, [contenteditable], [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      // Space on a focused button presses that button; only a page-level Space toggles the timer
      if (e.code === "Space") { if (el.closest("button, a, summary, [role=button]")) return; e.preventDefault(); timerActions.toggle(); }
      else if (k === "r") timerActions.reset();
      else if (k === "n") timerActions.skip();
      else if (k === "t") setPanel((p) => (p === "tasks" ? null : "tasks"));
      else if (k === "m") setPanel((p) => (p === "sounds" ? null : "sounds"));
      else if (k === "p") { e.preventDefault(); openParking(); }
      else if (k === "s") setSettingsOpen((o) => !o);
      else if (k === "f") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    // Capture prevents native button activation and handlers inside cards/forms too.
    const capture = (e: KeyboardEvent) => { alertTypingGuard.keydown(e); };
    const release = (e: KeyboardEvent) => { alertTypingGuard.keyup(e); };
    window.addEventListener("keydown", capture, true);
    window.addEventListener("keyup", release, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", capture, true);
      window.removeEventListener("keyup", release, true);
    };
  }, []);

  const dock: { id: Exclude<PanelId, null>; icon: keyof typeof Icon; label: string }[] = [
    { id: "tasks", icon: "tasks", label: "Tasks (T)" },
    { id: "sounds", icon: "music", label: "Sounds & music (M)" },
    { id: "notes", icon: "note", label: "Notepad" },
  ];

  return (
    <>
      <InkFilters />
      <Background />
      <TitleSync />
      <EndSessionHost />
      <div className={`app ${idle ? "idle" : ""}`} inert={settingsOpen || undefined}>
        <header className="topbar chrome">
          <div className="seg" role="group" aria-label="Dashboard">
            {(["home", "focus", "ambient"] as DashMode[]).map((m) => (
              <button key={m} aria-pressed={dash === m} onClick={() => settingsUpdate("dash", m)}>
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <div className="row">
            {sync.state !== "off" && !sync.email && <button className="btn small" onClick={() => { setOpenSync(true); setSettingsOpen(true); }}>Sign in to sync</button>}
            <button className="iconbtn" onClick={toggleFullscreen} aria-label="Fullscreen (F)" title="Fullscreen"><Icon.full /></button>
            <button className="iconbtn" onClick={() => setSettingsOpen(true)} aria-label="Settings (S)" title="Settings"><Icon.gear /></button>
          </div>
        </header>

        {dash === "focus" ? <FocusView captureOpen={parking} onPark={openParking} onCaptureClose={closeParking} onChooseTask={() => setPanel("tasks")} /> : <ClockView ambient={dash === "ambient"} />}

        <DashboardStreak />
        <footer className="bottombar chrome">
          <nav className="dock" aria-label="Panels" ref={dockRef}>
            {dock.map((d) => {
              const I = Icon[d.icon];
              return (
                <button key={d.id} data-panel={d.id} className="iconbtn" aria-pressed={panel === d.id} aria-label={d.label} title={d.label} onClick={() => setPanel((p) => (p === d.id ? null : d.id))}>
                  <I />
                </button>
              );
            })}
          </nav>
          <Credits />
        </footer>
      </div>

      {(!saved.ok || saved.volatile) && (
        <div className="save-banner" role="alert">
          {saved.ok ? "This browser isn't letting the app store data, so changes last only until you close the tab." : `${saved.error} Your last changes may not be saved.`}
        </div>
      )}
      {panel === "tasks" && <TasksPanel onClose={() => setPanel(null)} />}
      {/* Sounds stay mounted so audio keeps playing when the panel is closed */}
      <SoundsPanel open={panel === "sounds"} onClose={() => setPanel(null)} />
      {panel === "notes" && <NotepadPanel onClose={() => setPanel(null)} />}
      {settingsOpen && <SettingsDrawer key={settingsRequest} initialTab={openSync ? "data" : menuSettingsTab} onClose={() => { setSettingsOpen(false); setOpenSync(false); setMenuSettingsTab(undefined); }} />}
      <AlarmToast />
      {!interruption && <TransitionScreen />}
      <InterruptionCapture />
    </>
  );
}

function toggleFullscreen() {
  // Mac app: native full-screen Space. Web: the browser's Fullscreen API.
  if (window.desktop?.toggleFullScreen) { void window.desktop.toggleFullScreen(); return; }
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.();
}
