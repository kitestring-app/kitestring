import { useState } from "react";
import { useStore } from "../lib/store";
import { recoveryCommand, requestLongerOffer, requestTinyBlock, useTimerView } from "../state/timer";
import { longerOfferAvailable, tinyStarts } from "../state/tinyStarts";
import { useRecoveryOffer } from "./RecoveryCard";
import { FocusCard } from "./FocusCard";
import { Icon } from "./icons";
import "./StartSupport.css";

export function StartSupport() {
  const view = useTimerView(), recovery = useRecoveryOffer();
  const [choice, setChoice] = useState("5"), [custom, setCustom] = useState("5");
  const [menu, setMenu] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const idle = !view.running && view.state.segment === "focus" && view.elapsed === 0 && !recovery;
  if (!idle) return null;
  const command = recoveryCommand();
  const minutes = Number(choice === "custom" ? custom : choice);
  return <div className="start-support chrome">
    <div className="tiny-start">
      <div className="tiny-chip">
        <button className="btn small" disabled={busy} onClick={async () => {
          setBusy(true);
          try { setError(await requestTinyBlock(command, minutes) ? "" : "Choose 1 to 1440 minutes, then start from the current idle block."); }
          catch (cause) { setError((cause as Error).message); }
          finally { setBusy(false); }
        }}>Start with {choice === "custom" && !custom ? "custom" : minutes} min</button>
        <button className="btn small tiny-menu-toggle" aria-label="Tiny block length" aria-expanded={menu} aria-controls="tiny-length-menu" onClick={() => setMenu(value => !value)}><Icon.chevronDown /></button>
      </div>
      {menu && <div className="tiny-options" id="tiny-length-menu" role="group" aria-label="Tiny block length choices">
        {["5", "10", "custom"].map(value => <button className="btn small" key={value} aria-pressed={choice === value} onClick={() => { setChoice(value); setMenu(false); }}>{value === "custom" ? "Custom" : `${value} min`}</button>)}
      </div>}
      {choice === "custom" && <label className="tiny-custom small">Minutes<input className="input" type="number" min="1" max="1440" step="1" aria-label="Custom tiny block minutes" value={custom} onChange={e => setCustom(e.target.value)} /></label>}
    </div>
    {error && <p className="small" role="alert">{error}</p>}
  </div>;
}

export function LongerOfferCard() {
  const progression = useStore(tinyStarts);
  const view = useTimerView();
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  if (view.running || view.state.segment !== "focus" || view.elapsed > 0 || !longerOfferAvailable()) return null;
  const expected = recoveryCommand();
  const answer = async (choice: "accepted" | "dismissed") => {
    setBusy(true);
    try { setError(await requestLongerOffer(expected, choice, progression.finished) ? "" : "The active block changed. Try again."); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <FocusCard title="Try your usual length?" icon="clock" label="Usual length offer" note="You finished two tiny blocks." onClose={() => { if (!busy) void answer("dismissed"); }} actions={
    <div className="recovery-buttons">
      <button className="btn primary" disabled={busy} onClick={() => void answer("accepted")}>Start usual length</button>
      <button className="btn" disabled={busy} onClick={() => void answer("dismissed")}>Keep tiny blocks</button>
      {error && <p role="alert">{error}</p>}
    </div>} />;
}
