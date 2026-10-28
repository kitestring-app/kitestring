import { SUPPORT_LINKS } from "../Credits";
import { EvidenceLink } from "../EvidenceLink";
export function AboutTab() {
  return (
    <>
      <h1>About</h1>
      <p><EvidenceLink /></p>
      <div className="card">
        <h3>Made with care by Prax</h3>
        <p className="help">Kitestring is free. If it helps you focus, you can say thanks here.</p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {SUPPORT_LINKS.map((l) => <a key={l.label} className="btn small" href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>)}
        </div>
      </div>
      <p className="lede">A free, local-first focus dashboard. Your timer, tasks, notes and stats are stored on this device, and the core tools work offline once the app has loaded. Optional account sync sends your saved data to your account. Internet radio, music embeds and photo themes use the network and connect to their providers when you use them.</p>
      <div className="card">
        <h3>Keyboard shortcuts</h3>
        <table className="muted" style={{ borderSpacing: "18px 6px", marginLeft: -18 }}>
          <tbody>
            {[["⌘.", "Stop Sound"], ["Space", "Start / pause"], ["R", "Reset segment"], ["N", "Skip / finish"], ["T", "Tasks"], ["M", "Sounds & music"], ["P", "Park a thought"], ["S", "Settings"], ["F", "Fullscreen"], ["Esc", "Close panels"]].map(([k, v]) => (
              <tr key={k}><td><kbd className="btn small">{k}</kbd></td><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {window.desktop && <div className="card">
        <h3>Mac menu shortcuts</h3>
        <table className="muted" style={{ borderSpacing: "18px 6px", marginLeft: -18 }}>
          <tbody>{[
            ["⌘,", "Settings"], ["⌃⌘F", "Toggle Full Screen"], ["⌘1 / ⌘2 / ⌘3", "Home / Focus / Ambient"],
            ["⇧⌘T", "Tasks"], ["⇧⌘M", "Sounds & music"], ["⇧⌘N", "Notepad"],
            ["⌘Return", "Start / pause"], ["⌘]", "Skip"], ["⇧⌘R", "Reset"], ["⇧⌘F", "Floating timer"],
            ["⌥⌘P", "Park a thought (global)"], ["⌘M", "Minimize"], ["⌘W", "Close window"],
            ["⌘H", "Hide"], ["⌥⌘H", "Hide others"], ["⌘Q", "Quit"],
            ["⌘Z / ⇧⌘Z", "Undo / redo"], ["⌘X / ⌘C / ⌘V / ⌘A", "Cut / copy / paste / select all"],
          ].map(([key, label]) => <tr key={key}><td><kbd className="btn small">{key}</kbd></td><td>{label}</td></tr>)}</tbody>
        </table>
      </div>}
      {window.desktop?.parkingStatus && <p className="help">⌥⌘P parks a thought from any app on your Mac.</p>}
      <div className="card">
        <h3>Credits</h3>
        <p className="help">Inspired by Flocus. Sounds are generated in your browser or come from CC0 recordings; photo themes are hot-linked from Unsplash under the Unsplash License. Live stations are the creators' official YouTube streams.</p>
      </div>
    </>
  );
}
