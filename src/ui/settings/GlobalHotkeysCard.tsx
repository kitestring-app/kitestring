import { useEffect, useRef, useState } from "react";
import { useStore } from "../../lib/store";
import { formatHotkey, globalHotkeys, HOTKEY_ACTIONS, HOTKEY_LABELS, hotkeyStatus, recordHotkey, type GlobalHotkeyStatus, type HotkeyAction } from "../../state/globalHotkeys";
import "./GlobalHotkeysCard.css";

const STATUS_TEXT: Record<Exclude<GlobalHotkeyStatus[HotkeyAction], "off" | "ok">, string> = {
  invalid: "That shortcut can’t be used. Pick another.",
  reserved: "Kitestring or macOS already uses that shortcut. Pick another.",
  duplicate: "Another action already uses that shortcut.",
  taken: "Another app is using that shortcut. Pick another.",
};

/** Mac only. Every action starts off; nothing is registered until you record a shortcut. */
export function GlobalHotkeysCard() {
  const saved = useStore(globalHotkeys);
  const [status, setStatus] = useState(hotkeyStatus.get());
  useEffect(() => hotkeyStatus.subscribe(setStatus), []);
  const [recording, setRecording] = useState<HotkeyAction | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const buttons = useRef<Partial<Record<HotkeyAction, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!recording) return;
    // Window capture runs before the settings dialog and the dashboard shortcuts.
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      const result = recordHotkey(event, recording, saved);
      if (result.kind === "wait") return;
      if (result.kind === "hint") { setHint(result.hint); return; }
      if (result.kind === "set") globalHotkeys.set(current => ({ ...current, [recording]: result.accelerator }));
      setRecording(null); setHint(null);
    };
    const swallow = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", swallow, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("keyup", swallow, true); };
  }, [recording, saved]);

  const stopRecording = () => { setRecording(null); setHint(null); };
  const clear = (action: HotkeyAction) => {
    globalHotkeys.set(current => ({ ...current, [action]: null }));
    stopRecording();
    buttons.current[action]?.focus();
  };

  return (
    <div className="card global-hotkeys">
      <h3>Global shortcuts</h3>
      <p className="help">Optional. Control the timer while another app is in front. Each one stays off until you set it, and stays on this Mac. Timer shortcuts follow Hard mode.</p>
      {HOTKEY_ACTIONS.map(action => {
        const value = saved[action];
        const state = status?.[action];
        const problem = value && state && state !== "ok" && state !== "off" ? STATUS_TEXT[state] : null;
        const isRecording = recording === action;
        return (
          <div className="opt hotkey-row" key={action}>
            <span className="hotkey-text">
              <b id={`hotkey-${action}`}>{HOTKEY_LABELS[action]}</b>
              <span role={isRecording || problem ? "status" : undefined}>
                {isRecording ? hint ?? "Press the new shortcut. Escape cancels." : problem ?? (value ? "Works from any app." : "Off")}
              </span>
            </span>
            <button
              ref={el => { buttons.current[action] = el; }}
              type="button"
              className={`btn small hotkey-key${isRecording ? " recording" : ""}`}
              aria-describedby={`hotkey-${action}`}
              aria-pressed={isRecording}
              onClick={() => { if (isRecording) stopRecording(); else { setHint(null); setRecording(action); } }}
              onBlur={() => { if (isRecording) stopRecording(); }}
            >
              {isRecording ? "Recording…" : value ? <kbd>{formatHotkey(value)}</kbd> : "Set shortcut"}
            </button>
            {value && <button type="button" className="btn small" aria-label={`Clear ${HOTKEY_LABELS[action]} shortcut`} onClick={() => clear(action)}>Clear</button>}
          </div>
        );
      })}
    </div>
  );
}
